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


## 2026-11-05: qoidalar va saqlanadigan tayyorgarlik jarayoni

`src/content/season2Rules.ts` 9 liga uchun alohida teng ochko mezonlarini saqlaydi. Ligue 1ning 2025/26 dan o‘zgargan mezonlari (o‘zaro safar gollari o‘rniga umumiy g‘alabalar/safar g‘alabalari) ishlatilgan. Saudiya 2026/27 Handbook 9-modda mavsum davomidagi va final tartibini ajratadi, mini-jadvaldagi uch mezondan keyingina qolgan teng klublar uchun o‘zaro natijalar qayta ishlanadi. Turkiya FMT 9-modda ko‘p klublik mini-jadvalni qayta boshlamaydi. Qoidalar uchun rasmiy URLlar profilning o‘zida bor.

`rankPreparedLeagueResults` faqat 2-mavsumning shu ligasiga tegishli, tasdiqlangan, takrorlanmagan natijalarni qabul qiluvchi alohida hisoblash sinovi. Manfiy/noto‘g‘ri hisob, begona klub, boshqa mavsum yoki bir uy/safar juftligini takrorlash rad etiladi. Yakuniy jadval uchun to‘liq ikki davra talab qilinadi. Hali tugamagan o‘zaro uchrashuvlar, yetishmayotgan intizom ma’lumoti, teng qolgan mezonlar yoki hal qiluvchi pley-off o‘rniga soxta tartib berilmaydi. Alifbo faqat ko‘rsatish uchun; teng guruh bir xil o‘rin oladi. Bu xizmat hozirgi jonli jadval dvigatelini almashtirmaydi.

Italiyaning 2026/27 hal qiluvchi pley-off istisnolari va O‘zbekiston reglamentining tasdiqlangan yakuniy nusxasi hali tekshirilmoqda. Ular `REVIEW_REQUIRED`; qolgan 7 profilning asosiy mezonlari rasmiy manbalarga tayangan. Unresolved final tie uchun rasmiy qur’a/pley-off/U19/intizom qarorlari alohida kiritilishi kerak; hozir avtomatik yaratilmaydi.

Tashkilotchi Yevropa uchun haqiqiy UEFA tizimini tanladi: UCL/UEL/UECLning har biri 36 klub. UCL va UEL: 8 raqib, 4 uy/4 safar, 144 o‘yin; UECL: 6 raqib, 3 uy/3 safar, 108 o‘yin. 1–8 R16, 9–24 o‘tish pley-offi, 25–36 chiqadi. Potlar, bir assotsiatsiyadan raqib olmaslik va boshqa assotsiatsiyadan ko‘pi bilan ikki raqib kabi qur’a talablari rejada belgilangan. **36 klubni eski 32 klubli generatorga uzatish bajarilmagan**; yangi qur’a/generatsiya integratsiyasi hali qolgan.

Yevropa yo‘llanmalari 5 EFL ligasiga uydirma taqsimlanmaydi. Rasmiy UEFA access list, chempionlik yo‘llari, titul egalari, qo‘shimcha kvotalar, tashqi assotsiatsiyalar vakillari va kirish bosqichlari hali to‘liq kiritilmagan. `qualificationSlots:null` va bo‘sh qatnashchilar bu holatni aniq aks ettiradi. Oldingi mavsumning haqiqiy natijalari EFL yangi mavsum natijalari sifatida ko‘chirilmaydi. Osiyo uchun oldin tasdiqlangan EFL 32 klubli tartib o‘zgartirilmagan.

9 milliy kubok uchun alohida manifest qo‘shildi. Rasmiy manbada tasdiqlangan qatnashchi sonlari: FA Cup 743, Coppa Italia 44, DFB-Pokal 64, Emperor’s Cup 88. Copa del Reyning asosiy bosqichi 116 klub; oldingi hududiy saralash bilan umumiy soni bir xil tushuncha emas. Barcha kuboklarda to‘liq quyi liga ro‘yxatlari yetishmaydi; ular uchun 20/18 klubli yolg‘on to‘liq kubok yaratilmaydi. Noma’lum sonlar `null`; tekshirish tugamagan formatlar `REVIEW_REQUIRED`. Superkuboklar ham alohida kelgusi konfiguratsiyani talab qiladi.

Admin panelining egaga ochiq bo‘limi: **EFL · 2-mavsumni tayyorlash**. Sana ixtiyoriy reja sifatida saqlanadi, yetishmayotgan shartlar ko‘rinadi. Server faqat asosiy adminni qabul qiladi. `GET /api/admin/season-ops/preparation`; `POST /api/admin/season-ops/preparation/draft` faqat `startDate` va `expectedRevision` qabul qiladi. Draft `season_preparation_drafts/season-2027-28`ga tranzaksiya orqali versiyalanadi. Bir xil qayta urinish idempotent, parallel tahrirlashda eskirgan versiya 409. Mijoz `status:active` yoki begona reja yubora olmaydi.

`POST /api/admin/season-ops/preparation/standings-preview` asosiy adminga tasdiqlangan natijalar bilan quruq hisoblash sinovi beradi; hech qanday o‘yin natijasi yozilmaydi. `final:true` to‘liq taqvimni talab qiladi.

**Haqiqiy faollashtirish hali joriy qilinmagan.** Hozirgi `getActiveSeasonFirestore`, liga katalogi va bir qancha turnir yo‘llari seed/32 klubga bog‘langan. Boshlashga tayyorlik tekshiruvi aynan shu sababni ham ko‘rsatadi (`RUNTIME_TRANSITION_REQUIRED`) va `canActivate:false` qaytaradi. Draft saqlash faol mavsumni o‘zgartirmaydi, 1-mavsumni yopmaydi va yangi ligaga qabul ochmaydi. Joriy mavsum arxivi bo‘lmasa bu ham alohida to‘siq. Ishni tayyor deb ko‘rsatish yoki vaqtincha blokni chetlab o‘tish taqiqlanadi.

Yangi regressiya: `node scripts/run-isolated-test.mjs src/server/tests/seasonPreparationRulesRegressionTest.ts`. Ligue 1/J1/La Liga farqlari, Saudiyaning mini-jadvali, haqiqiy o‘yinlar soni, soxta tenglik yechimi yo‘qligi, mavsum izolyatsiyasi, asosiy admin nazorati, sana tekshiruvi, idempotent va parallel draft saqlash, noma’lum aktivatsiya maydonining rad etilishi tekshiriladi.
