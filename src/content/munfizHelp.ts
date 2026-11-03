export const munfizCopy = {
 uz:{explain:'Bu sahifa nima uchun?',tour:'Birma-bir ko‘rsat',questions:'Savolim bor',hide:'Yig‘ib qo‘yish',open:'Munfiz yordamini ochish',close:'Yopish',empty:'Shu bo‘limda ko‘rsatish uchun mavjud amal topilmadi. Yuqoridagi izohni o‘qing yoki savol-javobni oching.',seen:'Bu sahifa yo‘riqnomasini ko‘rgansiz. Istasangiz takrorlang.',intro:'Men Munfizman. Shu sahifada yordam beraman.'},
 ru:{explain:'Для чего эта страница?',tour:'Показать по шагам',questions:'У меня вопрос',hide:'Свернуть',open:'Открыть помощь Мунфиза',close:'Закрыть',empty:'В этом разделе не найдено доступных действий для показа. Прочтите пояснение или откройте вопросы.',seen:'Вы уже смотрели это знакомство. Его можно повторить.',intro:'Я Мунфиз. Помогу на этой странице.'},
 en:{explain:'What is this page for?',tour:'Show me step by step',questions:'I have a question',hide:'Minimize',open:'Open Munfiz help',close:'Close',empty:'There are no available actions to highlight in this section. Read its explanation or open the questions.',seen:'You have seen this tour. You can repeat it.',intro:'I’m Munfiz. I can help with this page.'},
};
const pages:Record<string,[string,string,string]>={
 dashboard:['Bosh sahifada navbatdagi o‘yin va so‘nggi natijalarni topasiz. Klubingiz bo‘lmasa, “Turnirlar”dan boshlang.','На главной — ближайшие матчи и результаты. Если клуба ещё нет, начните с турниров.','Home shows upcoming matches and recent results. Start with Competitions if you do not have a club.'],
 'my-club':['Bu yerda klubingiz, o‘yinlaringiz va statistikangiz bor. O‘yinni ochib raqibni toping va ekrandagi tartib bo‘yicha natija yuboring.','Здесь ваш клуб, матчи и статистика. Откройте матч, найдите соперника и следуйте инструкциям для отправки результата.','Find your club, matches and statistics here. Open a match to contact your opponent and follow its result instructions.'],
 club:['Klub sahifasida uning o‘yinlari va natijalarini ko‘rasiz. Hisob kiritish faqat tegishli o‘yinchi yoki vakolatli adminga ochiladi.','На странице клуба — его матчи и результаты. Ввод счёта доступен участникам матча и уполномоченным администраторам.','This club page shows its matches and results. Score entry is available to the players involved and authorized administrators.'],
 leagues:['Liga ichidan klublar, o‘yinlar va jadvalni oching. Klub tanlash qabul holati va sizga berilgan ruxsatga bog‘liq.','Откройте лигу, чтобы увидеть клубы, матчи и таблицу. Выбор клуба зависит от приёма и допуска.','Open a league for clubs, fixtures and standings. Club selection depends on admission and your access.'],
 cups:['Kubok bosqichlari va juftliklarini shu yerda ko‘rasiz. Raqib hali noma’lum bo‘lsa, oldingi bosqich natijasi kutilayotgan bo‘lishi mumkin.','Здесь стадии и пары кубка. Неизвестный соперник может означать ожидание результата предыдущего этапа.','Find cup stages and pairings here. An unknown opponent may mean an earlier stage has not finished.'],
 european:['Yevrokubok o‘yinlari, bosqichlar va natijalar shu yerda. Tegishli musobaqani tanlang.','Здесь матчи, этапы и результаты еврокубков. Выберите нужное соревнование.','Find European competition fixtures, stages and results here. Choose your competition.'],
 uzeflife:['UZEFLIFE ichidan o‘yinlar, ishtirokchilar va turnir holatini ko‘rasiz. Hisob yuborish tartibini o‘z o‘yiningizdan tekshiring.','В UZEFLIFE доступны матчи, участники и состояние турнира. Правила отправки счёта смотрите в своём матче.','UZEFLIFE shows matches, participants and tournament status. Check your match for score submission instructions.'],
 custom:['TEAMS — jamoalar o‘rtasidagi musobaqalar. Turnirni ochib, o‘yinlar, jadval va tarkiblarni ko‘ring.','TEAMS — соревнования команд. Откройте турнир для матчей, таблицы и составов.','TEAMS hosts team competitions. Open a tournament to see fixtures, standings and rosters.'],
 team:['Team sahifasida tarkib va jamoa ma’lumotlari bor. Boshqaruv amallari sizning jamoadagi vakolatingizga bog‘liq.','На странице команды — состав и сведения. Управление зависит от вашей роли.','This team page shows its roster and information. Management controls depend on your role.'],
 notifications:['Uchrashuvlar va natijaga oid xabarlarni shu yerda ko‘rasiz. Kerakli xabarni ochib keyingi amalni bajaring.','Здесь уведомления о матчах и результатах. Откройте сообщение для следующего действия.','Find match and result notifications here. Open a message to see the next action.'],
 admin:['Bu boshqaruv sahifasi. Faqat o‘zingizga berilgan vakolat doirasidagi amallardan foydalaning.','Это страница управления. Используйте действия в пределах своих полномочий.','This is the management page. Use the controls available to your role.'],
};
export function munfizPageDescription(page:string,language:string){return (pages[page]||pages[page==='profile'||page==='my-matches'?'my-club':page]||['Bu sahifada mavjud ma’lumot va amallarni ko‘rib chiqing. Munfiz ekranda bor tugmalarni tushuntiradi.','Просмотрите данные и доступные действия. Мунфиз объясняет кнопки на экране.','Review this page’s information and available actions. Munfiz explains controls that are present on screen.'])[language==='ru'?1:language==='en'?2:0];}
export const stepCopy:Record<string,[string,string,string]>={
 'nav-dashboard':['Bosh sahifaga shu tugma orqali qaytasiz.','Эта кнопка открывает главную.','Return to Home using this button.'],
 'nav-leagues':['Turnirlarni shu yerdan ochasiz.','Здесь открываются турниры.','Open Competitions here.'],
 'nav-my-club':['Klubingiz va o‘yinlaringizni shu yerdan ochasiz.','Здесь ваш клуб и матчи.','Open your club and matches here.'],
 'score-entry':['O‘yin tugagach, hisobni shu yerdan yuborasiz. Ekrandagi tomonlarni adashtirmang.','После игры отправьте счёт здесь. Не перепутайте стороны.','Submit the final score here. Check which side belongs to you.'],
 'standings-entry':['O‘rinlar, ochkolar va natijalarni shu bo‘limdan ko‘rasiz.','Здесь места, очки и результаты.','View positions, points and results here.'],
 'opponent-chat':['Shu tugmadan raqibga yozib, o‘yin vaqtini kelishasiz.','Напишите сопернику и договоритесь о времени.','Contact your opponent here to agree on a time.'],
 'btn-global-search':['Klub, turnir yoki o‘yinchini shu yerdan qidiring.','Здесь поиск клуба, турнира или игрока.','Search for clubs, tournaments or players here.'],
 'btn-notifications':['O‘yin va natijalarga oid xabarlar shu yerda.','Здесь уведомления о матчах и результатах.','Open match and result notifications here.'],
};

// Each explanation describes a real destination or action, rather than repeating navigation copy.
type Localized = [string,string,string];
const detail:Record<string,Localized>={
 standings:['Jadvalni o‘qish: “O‘” — o‘ynalgan, “G‘” — g‘alaba, “D” — durang, “M” — mag‘lubiyat. GF urilgan, GA o‘tkazilgan gollar, TF ularning farqi. Ochko yoki g‘alaba ustunining nomiga qarang: musobaqaga qarab saralash tartibi farq qiladi.','Таблица: сыгранные матчи, победы, ничьи, поражения; GF — забитые, GA — пропущенные, разница — GF−GA. Смотрите название последнего столбца: турнир может сортироваться по очкам или победам.','Read played, wins, draws and losses; GF is goals scored, GA goals conceded, and difference is GF−GA. Check whether this competition ranks by points or wins.'],
 fixtures:['Avval kerakli turni tanlang. Juftlikda uy va mehmon tomoni, hisob va o‘yin holatini tekshiring. O‘z o‘yiningizni ochib raqibga yozing; o‘ynab bo‘lgach natijani aynan o‘sha o‘yinga yuboring. Boshqa turdagi o‘yinni adashtirib tanlamang.','Выберите тур, проверьте стороны, счёт и статус пары. Откройте свой матч, свяжитесь с соперником и отправьте результат именно этого матча.','Choose a round, check the sides, score and match status. Open your own match, contact your opponent, then submit the result to that exact match.'],
 results:['Bu bo‘limda yakunlangan natijalarni tekshirasiz. Tur va o‘yin tomonlarini solishtiring. Hisob noto‘g‘ri bo‘lsa, uni shunchaki qayta tasdiqlamang — o‘yin skrinshoti bilan turnir adminiga murojaat qiling.','Проверьте завершённые результаты, тур и стороны. Неверный счёт повторно не подтверждайте: отправьте администратору скриншот.','Check completed scores, their rounds and sides. Do not reconfirm an incorrect score; send match evidence to the tournament administrator.'],
 participants:['Qidiruvga ishtirokchining ismi yoki username’ini yozing. Ro‘yxatda borligi va holatini tekshiring. Raqib esa qur’a va tegishli tur ochilgach o‘yin kartasida ko‘rsatiladi.','Найдите участника по имени или username и проверьте статус. Соперник отображается в матче после жеребьёвки и открытия тура.','Search by participant name or username and check their status. Opponents appear in match cards after the draw and round opening.'],
 clubs:['Liga va qabul holatini tekshiring. Klub kartasidan uning egasi bor-yo‘qligini ko‘ring. Band klubni tanlab bo‘lmaydi; tanlash yopiq bo‘lsa, shu liga adminiga murojaat qiling.','Проверьте лигу и приём. В карточке клуба видно, занят ли он. Занятый клуб выбрать нельзя; если приём закрыт, обратитесь к администратору лиги.','Check the league and admission status. Club cards show whether a club has an owner. Taken clubs are unavailable; contact the league administrator if selection is closed.'],
 teams:['Team kartasidan tarkib va sardorni tekshiring. A’zolik yoki taklif tasdiqlanmagan bo‘lsa, sardor bilan bog‘laning. Boshqaruv tugmalari faqat tegishli vakolat egasiga ko‘rinadi.','В карточке команды проверьте состав и капитана. По неподтверждённому приглашению обратитесь к капитану. Управление зависит от роли.','Open a team card to check its roster and captain. Ask the captain about pending membership or invitations. Management controls depend on your role.'],
 bracket:['Setka yoki bosqichni tanlab, o‘zingizning juftligingizni toping. Keyingi katakka g‘olib o‘tadi. Raqib nomi hali yo‘q bo‘lsa, oldingi juftlik natijasi kutilishi mumkin.','Выберите сетку или этап и найдите свою пару. Победитель проходит дальше; пустая позиция может ждать результата предыдущей пары.','Choose a bracket or stage and find your pairing. Winners advance; an empty next opponent may be waiting for an earlier result.'],
 rules:['O‘yindan oldin muddat, o‘yin formati, durang/penalti va kelishmovchilik qoidalarini o‘qing. Boshqa turnirdagi tartibni bu musobaqaga avtomatik qo‘llamang.','Перед игрой прочитайте сроки, формат, правила ничьих/пенальти и споров. Не переносите правила другого турнира автоматически.','Before playing, check deadlines, format, draw/penalty rules and disputes. Do not assume another tournament uses the same rules.'],
 history:['Bu yerda turnirda oldin bajarilgan amallar va o‘zgarishlarni kuzatasiz. Qaysi o‘yin yoki tur o‘zgarganini va vaqtini tekshiring.','Здесь история действий и изменений. Проверьте, какой матч или тур изменён и когда.','Review prior tournament actions and changes here. Check the match or round involved and when it changed.'],
 mine:['Bu sizga tegishli o‘yin. Avval tur va raqibni tekshiring, bog‘lanib o‘ynash vaqtini kelishing. Taklif qilingan hisob bo‘lsa, o‘yin natijasi bilan solishtirib, ekrandagi tartib bo‘yicha javob bering.','Это ваш матч. Проверьте тур и соперника, договоритесь о времени. Предложенный счёт сравните с результатом игры и ответьте по инструкции.','This is your match. Check the round and opponent and agree on a time. Compare any proposed score to your game result before responding.'],
};
const aliases:Record<string,string>={matches:'fixtures',roster:'participants',players:'participants',overview:'mine','my-matches':'fixtures',form:'standings'};
export function normalizedMunfizSection(section:string){const s=section.toLowerCase();return aliases[s]||s;}
export function munfizSectionDescription(page:string,section:string,language:string){const key=normalizedMunfizSection(section);return detail[key]?.[language==='ru'?1:language==='en'?2:0]||munfizPageDescription(page,language);}
export function munfizControlDescription(id:string,language:string):string|null {
 const lang=language==='ru'?1:language==='en'?2:0;
 if(id.startsWith('category-'))return munfizPageDescription(id.slice(9),language);
 if(id.startsWith('section-'))return detail[normalizedMunfizSection(id.slice(8))]?.[lang]||null;
 const specific:Record<string,Localized>={
  'notifications-read':['Bu amal barcha xabarlarni o‘qilgan deb belgilaydi. U o‘yin hisobini tasdiqlamaydi va turnir natijasini o‘zgartirmaydi.','Это отмечает сообщения прочитанными, а не подтверждает счёт и не меняет результаты.','This marks notifications as read; it does not confirm match scores or change results.'],
  'round-picker':['Shu qatordan kerakli turni tanlang. Belgilangan turdagi o‘yinlar pastda ko‘rsatiladi; bu tugma turni admin sifatida ochmaydi.','Здесь выбор тура для просмотра; это не открытие тура администратором.','Choose which round to view here. This does not advance or open a round as an administrator.'],
  'table-columns':detail.standings,
  'table-view':['“Qisqa” asosiy natijalarni, “To‘liq” qo‘shimcha ustunlarni, “Forma” so‘nggi o‘yinlarni ko‘rsatadi. Tor ekranda jadvalni yon tomonga surish mumkin.','Переключайте краткую, полную таблицу и форму. На узком экране таблицу можно прокрутить вбок.','Switch between short, full and form views. On narrow screens, scroll the table sideways.'],
  'local-search':['Bu qidiruv faqat hozir ochiq bo‘limdagi ro‘yxatni filtrlaydi. Natija chiqmasa, yozuvni qisqartiring yoki tozalang.','Этот поиск фильтрует текущий список. Сократите или очистите запрос, если результатов нет.','This search filters the current list. Shorten or clear your query if there are no matches.'],
  'fixture-open':['O‘yin kartasini shu yerdan oching. Ichida tomonlar, natija holati va sizga ruxsat berilgan amallarni ko‘rasiz.','Откройте карточку матча: в ней стороны, статус результата и доступные вам действия.','Open the match card to see both sides, result status and actions available to you.'],
  'result-review':['Raqib yuborgan hisobni o‘yin skrinshoti bilan solishtiring. Mos bo‘lsa ekrandagi tartibda tasdiqlang, mos kelmasa e’tiroz bildiring.','Сравните счёт соперника со скриншотом. Если верно — подтвердите по инструкции; иначе откройте спор.','Compare the proposed score to your screenshot. Confirm it as instructed if correct; otherwise raise a dispute.'],
  'result-confirm':['Faqat tekshirgan to‘g‘ri hisobni tasdiqlang. Tasdiqlash natijani rasmiylashtirishi mumkin, shuning uchun tomonlarni ham tekshiring.','Подтверждайте только проверенный счёт. Это может сделать результат официальным; проверьте стороны.','Confirm only a checked score. Confirmation may finalize it, so check both sides too.'],
  'result-dispute':['Hisobga rozi bo‘lmasangiz shu amalni tanlang. Sabab va o‘yin skrinshotini saqlang; nizoni vakolatli admin ko‘rib chiqadi.','Если счёт неверен, используйте спор. Сохраните причину и скриншот для администратора.','Use this if you disagree with the score. Keep your explanation and screenshot for the administrator.'],
  'match-status':['Kartadagi holatni o‘qing: kutilayotgan, tasdiq kutayotgan yoki yakunlangan o‘yinning keyingi amali har xil bo‘ladi.','Проверьте статус: у ожидающего, неподтверждённого и завершённого матча разные следующие действия.','Read the status: scheduled, pending and completed matches have different next actions.'],
 };
 return specific[id]?.[lang]||stepCopy[id]?.[lang]||null;
}
export function munfizQuestionIndexes(page:string,section:string){
 const s=normalizedMunfizSection(section);
 if(s==='standings'||s==='bracket')return [4,8,9,10];
 if(['fixtures','mine','results'].includes(s))return [3,4,5,6,7,8,9];
 if(['participants','clubs','teams'].includes(s))return [1,3,4,10];
 if(['my-club','club','matches'].includes(page))return [3,4,5,6,7,8,9];
 if(['team','custom','leagues'].includes(page))return [1,3,4,10];
 return [3,4,9,10];
}

export function munfizControlTitle(id:string,fallback:string,language:string){
 const titles:Record<string,Localized>={
  'round-picker':['Ko‘riladigan turni tanlash','Выбор тура для просмотра','Choose a round to view'],
  'table-columns':['Jadval ustunlarini o‘qish','Как читать столбцы','Read the table columns'],
  'table-view':['Jadval ko‘rinishini almashtirish','Вид таблицы','Switch table views'],
  'local-search':['Shu ro‘yxatdan qidirish','Поиск в этом списке','Search this list'],
  'fixture-open':['O‘yinni ochish','Открыть матч','Open the match'],
  'score-entry':['O‘z o‘yiningiz hisobini yuborish','Отправить счёт своего матча','Submit your match score'],
  'opponent-chat':['Raqib bilan bog‘lanish','Связаться с соперником','Contact your opponent'],
  'result-review':['Taklif qilingan hisobni tekshirish','Проверить предложенный счёт','Review the proposed score'],
  'result-confirm':['Tekshirilgan hisobni tasdiqlash','Подтвердить проверенный счёт','Confirm the checked score'],
  'result-dispute':['Natijaga e’tiroz bildirish','Оспорить результат','Dispute the result'],
 };
 return titles[id]?.[language==='ru'?1:language==='en'?2:0]||fallback;
}
export function munfizChecklist(page:string,section:string,language:string):string[]{
 const lang=language==='ru'?1:language==='en'?2:0,s=normalizedMunfizSection(section);
 const lists:Record<string,[string[],string[],string[]]>={
  standings:[['O‘z klubingiz yoki ismingiz turgan qatorni toping.','Ochko/g‘alaba va to‘plar farqini tekshiring.','Ko‘proq ma’lumot uchun “To‘liq” yoki “Forma”ni tanlang.'],['Найдите строку своего клуба или имени.','Проверьте очки/победы и разницу мячей.','Выберите полный вид или форму для деталей.'],['Find your club or name in the table.','Check points/wins and goal difference.','Use Full or Form for more detail.']],
  fixtures:[['Kerakli tur va o‘z juftligingizni tanlang.','Raqib bilan bog‘lanib o‘ynash vaqtini kelishing.','O‘yindan keyin to‘g‘ri juftlikka hisob yuboring va holatini kuzating.'],['Выберите тур и свою пару.','Договоритесь с соперником о времени.','Отправьте счёт в правильный матч и проверьте статус.'],['Choose the round and your pairing.','Agree on a time with your opponent.','Submit the score to the correct match and check its status.']],
  participants:[['Ro‘yxat yoki qidiruvdan o‘z username’ingizni toping.','Ishtirok holatini tekshiring.','Topilmasa turnir adminiga qaysi ro‘yxatda bo‘lishingiz kerakligini ayting.'],['Найдите свой username в списке или поиске.','Проверьте статус участия.','Если вас нет, уточните список у администратора турнира.'],['Find your username in the list or search.','Check your participation status.','If missing, tell the tournament administrator which roster you should be on.']],
  bracket:[['O‘z setkangiz yoki bosqichingizni tanlang.','Username yoki klubingiz bo‘yicha juftlikni toping.','Natijadan keyin keyingi bosqichdagi joyingizni tekshiring.'],['Выберите свою сетку или этап.','Найдите пару по username или клубу.','После результата проверьте следующий этап.'],['Choose your bracket or stage.','Find your pairing by username or club.','Check your next-stage position after the result.']],
  dashboard:[['O‘z klubingiz tanlanganini tekshiring.','Navbatdagi o‘yinni ochib raqib va turga qarang.','Tasdiq kutayotgan natija yoki muhim xabar borligini tekshiring.'],['Проверьте выбранный клуб.','Откройте ближайший матч и проверьте соперника и тур.','Проверьте неподтверждённые результаты и уведомления.'],['Check your selected club.','Open your next match and check the opponent and round.','Check pending results and important notifications.']],
  notifications:[['Kerakli xabarni oching va qaysi o‘yinga tegishli ekanini tekshiring.','Hisob haqida bo‘lsa, natijani o‘yin sahifasida tekshiring.','“O‘qilgan” deb belgilash hisobni tasdiqlamasligini unutmang.'],['Откройте сообщение и проверьте матч.','Счёт проверяйте на странице матча.','Отметка прочитанным не подтверждает результат.'],['Open a message and check the match involved.','Review any score on the match page.','Marking a message read does not confirm a score.']],
 };
 const key=s==='mine'?'fixtures':lists[s]?s:lists[page]?page:page==='my-club'||page==='club'?'fixtures':'';
 return lists[key]?.[lang]||[];
}
