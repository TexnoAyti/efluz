# EFL 2-mavsum tayyorgarligi

1-mavsum (`season-2026-27`) davom etadi. 2-mavsum katalogi `season-2027-28` uchun tayyorlangan; bu boshlanish sanasini bildirmaydi.

Yevropa: Premier League, La Liga, Serie A, Bundesliga, qayta ochiladigan Ligue 1.
Osiyo: O‘zbekiston Superligasi, Saudi Pro League, J1 League, Süper Lig. Turkiya tashkilotchi tanlagan EFL Osiyo bo‘limiga joylashtirilgan.

`src/lib/seasonPreparation.ts` brauzer va serverning yagona reja manbasi. Reja Welcome, ligalar sahifasi va Season Hubda mavjud; kichik kartalarda tafsilotlar talab bo‘yicha ochiladi. Uch tilda tayyorgarlik va qabul hali ochilmagani ko‘rsatiladi.

`GET /api/seasons/preparation` joriy mavsum uchun katalogni bazaga murojaatsiz qaytaradi. `sourceSeasonId` boshqa bo‘lsa `preparation: null`. Bu `/api/seasons/active` javobini almashtirmaydi. Rollover preview ham shu rejani qaytaradi; mavjud himoyalangan shell yaratish jarayoni uni metadata sifatida saqlaydi.

Reja seed, klub egaligi, natija, turnir jadvali yoki mavsum holatini o‘zgartirmaydi. Ligue 1 uchun 1-mavsum cheklovi saqlanadi. Qabul, o‘yin yaratish va yangi mavsumni yoqish bajarilmaydi. Jamoa soni, klub ro‘yxati, format, xalqaro saralash va boshlanish sanasi hali belgilanmagan. Keyingi bosqichda aynan shu qarorlar va alohida mavsumga tegishli klub/turnir yozuvlari tayyorlanishi kerak; eski klublar egaligini ko‘chirish avtomatik emas.

Tekshiruv: `node scripts/run-isolated-test.mjs src/server/tests/seasonPreparationRegressionTest.ts`, `npm run lint`, `npm run build`.
