# 1000 foydalanuvchi uchun ishlash sxemasi

Maqsad: kuniga 1000 faol foydalanuvchi. Bunga 96 klub egasi va kuzatuvchilar kiradi; klub uchun bitta egasi bo‘lish qoidasi saqlanadi. Bir vaqtda 1000 odamning barcha yozish va AI amallarini kafolatlash alohida production o‘lchovini talab qiladi.

## So‘rovlar yo‘li

| Amal | Ma’lumot yo‘li | Firestore ishlatilishi |
| --- | --- | --- |
| Sessiya bilan kirish | HMAC tekshiruvi → foydalanuvchi limiti | Token tekshirish uchun 0 |
| Profil va klub | Sessiya → umumiy Redis ownership snapshot → aynan shu foydalanuvchi | Tayyor snapshot bo‘lsa 0 |
| O‘yinlar va jadval | Redis turnir snapshotlari → egasi/turnir bo‘yicha filtrlash | Tayyor snapshot bo‘lsa 0 |
| Match operations | Redis deadline umumiy keshi + foydalanuvchining report keshi | Deadline 1 soatda bir yangilanish; reports 15 daqiqada, tegishli mutationdan keyin invalidation |
| Xabarlar | Foydalanuvchi snapshoti + Redis read-state va moderatsiya | Tayyor snapshot bo‘lsa 0; yangi/eskirgan snapshot uchun chegaralangan query |
| Klub olish / natija yozish | Ruxsat tekshirish → transaction yoki mavjud durable outbox → snapshot yangilash | Authoritative tekshiruvlar saqlanadi |
| Telegram yuborish | Durable navbat → cheklangan worker → delivery holati | Har odam uchun to‘liq baza skani qilinmaydi |
| AI | Ruxsatli topic → grounded Redis faktlari → model / mavjud fallback | Model token, kunlik va topic limitlari API o‘qish sig‘imidan mustaqil |

Umumiy ma’lumotlar server ichida bo‘lishiladi. Shaxsiy javoblar `private, no-store` bo‘lib qoladi; CDN orqali boshqa foydalanuvchiga berilmaydi. Redis LKG bazadagi limit tugaganda oxirgi saqlangan ma’lumotni beradi. Redis — authoritative admin ruxsatlarini cheksiz keshlash uchun ishlatilmaydi.

## Ushbu o‘zgarish

Oldin `/api` limiti auth middleware’dan oldin IP bo‘yicha ishlagan. Bir tarmoqdagi ko‘p haqiqiy foydalanuvchi 300 so‘rov/minut limitini birga ishlatgan. Endi signed session yoki Telegram HMAC bilan tasdiqlangan ID uchun alohida budget ishlatiladi. Tokenni yangilash yoki auth usulini almashtirish budgetni yangilamaydi. Soxta/eskirgan token va oddiy user-ID headerlari IP budgetida qoladi. Bu tekshiruv Firestore o‘qimaydi va ruxsat bermaydi.

Anonim so‘rovlar IP bilan cheklanadi. `x-vercel-forwarded-for` faqat `VERCEL=1` muhitida va to‘g‘ri bitta IP bo‘lganda ishlatiladi. Oddiy hostingda proxy headerlarga ishonilmaydi. Platforma manbasi: https://vercel.com/docs/headers/request-headers

## Read budget

Hisob foydalanuvchi sonidan tashqari ishlash vaqtiga ham bog‘liq:

`kunlik reads = login/renewal account reads + cache refresh document reads + authoritative mutation reads + background/admin reads`.

Masalan, 1000 foydalanuvchi har biri 2 soat faol bo‘lib, taxminan har 10 daqiqada autentifikatsiyani yangilasa, birinchi kirish bilan birga taxminan 13 000 account read bo‘lishi mumkin. Bu faqat rejalash misoli; qolgan querylar, qayta kirishlar va boshqa jarayonlar alohida hisoblanadi. 1000 odam butun kun davomida faol bo‘lsa, shu taxmin keskin oshadi. Tasdiqlangan identity bilan oddiy API o‘qishlari har safar user document o‘qimasligi kerak.

Firestore bepul kvotasi va har loyihadagi boshqa workload ham hisobga olinadi: https://firebase.google.com/docs/firestore/quotas . Redis command/traffic, Vercel invocation/bandwidth va Gemini kvotalari alohida kuzatiladi. Firestore reads kamayishi boshqa providerlarda cheksiz bepul sig‘imni anglatmaydi. Ushbu o‘zgarish pullik xizmat yoki tarif yoqmaydi.

## Avtomatik tekshirish

`npm run test:scaling-1000` mahalliy haqiqiy Redis va loopback HTTP bilan alohida processda bajariladi. Production hisoblar, Telegram, tashqi tarmoq va Firestore yozishlari ishlatilmaydi.

Sinov 1000 signed foydalanuvchini bir IP orqali profil, shaxsiy o‘yinlar, xabarlar, bo‘sh klublar, match operations, liga jadvali va liga o‘yinlari endpointlariga yuboradi: har endpointda 1000 parallel boshlanuvchi so‘rov, jami 7000. Ownership, xabarlar ajratilishi, egallangan klubning bo‘sh deb chiqmasligi va warm Redis bilan Firestore collection chaqiruvi 0 bo‘lishi tekshiriladi. p95 va umumiy vaqt faqat mahalliy sinov natijasidir, production SLA emas. Sessiya/HMAC limit davomiyligi va soxta tokenlar alohida tekshiriladi. CI’da ham shu test ishlaydi.

## Jonli chiqarishda kuzatish

100 → 300 → 500 → 1000 haqiqiy kunlik foydalanuvchi bosqichida 429/5xx, p95, snapshot yoshi, Firestore reads, Redis ishlatilishi va outbox/navbat yoshi kuzatiladi. Authoritative klub olish va natija yuborishning bir vaqtdagi konflikti mavjud durability/transaction testlari bilan tekshiriladi; productionga sun’iy yozuv va xabar yuborib yuklama berilmaydi. Klub/natija, yangi Telegram login va model chaqiruvining 1000 concurrent production sig‘imi ushbu read testi bilan isbotlanmaydi.
