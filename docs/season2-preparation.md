# EFL 2-mavsum tayyorgarligi

1-mavsum (`season-2026-27`) davom etadi. EFL 2-mavsumning ichki IDsi `season-2027-28`; bu haqiqiy futbolning 2027/28 tarkibini anglatmaydi. Tashkilotchi talabi bo‘yicha 2026-11-05 holatidagi amaldagi real mavsum tarkiblari olinadi: O‘zbekiston — 2026, qolganlari — 2026/27.

## Tekshirilgan tarkiblar

`src/content/season2Rosters.ts` eskirgan TOP5 seedidan mustaqil ro‘yxat. Har yozuvda manba, real mavsum, tekshirilgan sana va klub soni bor. Faqat klubning mavjud IDsi qayta ishlatiladi; egasi, ochkosi yoki natijalari ko‘chirilmaydi. Jami 168 klub.

| Liga | Klub | Tur | O‘yin | Rasmiy manba |
| --- | ---: | ---: | ---: | --- |
| Premier League | 20 | 38 | 380 | https://www.premierleague.com/en/news/4365156 |
| La Liga | 20 | 38 | 380 | https://www.laliga.com/en-US/laliga-easports/standing |
| Serie A | 20 | 38 | 380 | https://www.legaseriea.it/serie-a/classifica?lang=en |
| Bundesliga | 18 | 34 | 306 | https://www.bundesliga.com/en/bundesliga/table |
| Ligue 1 | 18 | 34 | 306 | https://www.psg.fr/en/mens-football/standings/season/2026-2027?competition=Ligue_1 |
| O‘zbekiston Superligasi | 16 | 30 | 240 | https://fcneftchi.uz/uz/matches/standings |
| Saudi Pro League | 18 | 34 | 306 | https://www.spl.com.sa/en/news/spl-announces-2026-27-rsl-fixture-schedule |
| J1 League | 20 | 38 | 380 | https://www.jleague.jp/en/j1/club/ |
| Süper Lig | 18 | 34 | 306 | https://www.tff.org/Default.aspx?pageId=198 |

PFL va ayrim liga jadvallari dinamik bo‘lgani uchun Ligue 1 va O‘zbekiston to‘liq jadvali mos ravishda PSG va Neftchining rasmiy saytlaridan tekshirildi. Serie A uchun rasmiy sahifaning qidiruv indeksidagi 2026/27 to‘liq jadvali ham ishlatildi. Eski tarkibni joriy tarkib deb ko‘rsatish mumkin emas.

Muhim tuzatishlar: La Liga — Girona/Las Palmas/Mallorca o‘rniga Elche/Espanyol/Levante; Serie A — Empoli/Verona o‘rniga Como/Sassuolo; Bundesliga — Bochum/Heidenheim/Holstein Kiel/St. Pauli/Wolfsburg o‘rniga Elversberg/Köln/Paderborn/Schalke/Hamburger SV; Ligue 1 — Montpellier/Nantes/Reims o‘rniga Angers/Le Havre/Lorient. J1ning eski 2025 yoki 2026 o‘tish turniri tarkibi o‘rniga 2026/27 ro‘yxati olingan.

## Liga taqvimlari

Har ichki liga uchun uy/safar, ikki davra va 3/1/0 ochko konfiguratsiyasi tayyor. `previewPreparedLeagueSchedule` mavjud round-robin generatori orqali jami 2984 uchrashuvlik **EFL taqvim loyihasini** qaytaradi. Bu haqiqiy ligalarning sanalari yoki real qur’a tartibining nusxasi emas. Boshlanish sanasi berilmagan, o‘yinlar bazaga yozilmaydi. Har juftlik bir marta uyda, bir marta safarda; har klub bir turda bir marta o‘ynaydi.

`GET /api/seasons/preparation` klub tarkiblari va konfiguratsiyani bazaga murojaatsiz beradi. `GET /api/seasons/preparation/:leagueId/fixtures` EFL taqvim loyihasini `persisted:false` bilan beradi; noma’lum liga 404. Bu yo‘llar `/api/seasons/active`ni almashtirmaydi. Himoyalangan rollover shell yaratish jarayoni rejani faqat metadata sifatida saqlaydi.

## Osiyo Chempionlar ligasi

Turkiya tashkilotchi tanlagan EFL Osiyo bo‘limida. ACL saralashi aynan 2-mavsumdagi O‘zbekiston, Saudiya, Yaponiya va Turkiya ligalaridan: har birining 1–8-o‘rinlari, jami 32 klub. Bu tashkilotchi tasdiqlagan EFL qoidasi, OFKning haqiqiy geografik taqsimoti yoki kvotalari nusxasi emas.

Format EFL Yevropa UCL kabi: liga bosqichida har klubga 8 o‘yin; 1–8 to‘g‘ridan-to‘g‘ri 1/8 finalga, 9–24 o‘tish pley-offiga, 25–32 chiqib ketadi. Konfiguratsiya mavjud UCL seediga tengligi testlanadi. Faol ACL yozuvi va o‘yinlari hozircha yaratilmaydi.

## Interfeys va tayyorlik

Welcome, ligalar sahifasi va Season Hub bir xil katalogdan foydalanadi. Har liga ochilganda barcha klublar, real mavsum, tekshirish sanasi, o‘yin/tur soni va rasmiy manba ko‘rinadi. UZ/RU/EN mavjud, ro‘yxat qirqilmaydi.

Tarkiblar, jamoa sonlari, ikki davrali format va ACL rejasi tayyor. **2-mavsum ishga tushirishga hali tayyor emas**: milliy kuboklar, har liganing teng ochko qoidalari, Yevropa saralashi, boshlanish sanasi va mavsumga tegishli haqiqiy yozuvlarni yaratish/yoqish qolgan. Yangi emblemalarni yetkazish ushbu ro‘yxat tekshiruvida bajarilmagan. Reja 1-mavsumning klublari, egalari, natijalari va Ligue 1 cheklovini o‘zgartirmaydi. O‘yin natijalari, ochkolar yoki amaldagi egalik real futbol jadvalidan import qilinmaydi.

Tekshiruvlar: preparation regressioni barcha 168 klub, yangilangan/chiqarilgan klublar, manbalar, 2984 o‘yin uy/safar balansi va 1-mavsum saqlanishini tekshiradi. Welcome renderi ro‘yxatlar, manbalar, sonlar va uch tildagi ACLni tekshiradi. TypeScript, build/self-check va startup budjeti bajariladi. Haqiqiy Telegram qurilmasida tekshirilmadi.
