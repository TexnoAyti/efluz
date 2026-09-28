import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'uz' | 'ru' | 'en';

export interface Translations {
  // Navigation
  navHome: string;
  navMyClub: string;
  navMyMatches: string;
  navLeagues: string;
  navCups: string;
  navChampionsLeague: string;
  navStandings: string;
  navNotifications: string;
  navProfile: string;
  navAdmin: string;

  // Header & General
  season: string;
  selectLanguage: string;
  loading: string;
  error: string;
  save: string;
  cancel: string;
  close: string;
  confirm: string;
  dispute: string;
  status: string;
  actions: string;
  search: string;
  filterAll: string;
  refresh: string;
  back: string;

  // Dashboard / Home
  managerHub: string;
  myClub: string;
  noClubSelected: string;
  selectYourClub: string;
  currentPosition: string;
  points: string;
  pointsAbbr: string;
  played: string;
  won: string;
  drawn: string;
  lost: string;
  goalsFor: string;
  goalsAgainst: string;
  goalDifference: string;
  recentForm: string;
  nextMatch: string;
  latestResult: string;
  noUpcomingMatches: string;
  openMatchCenter: string;
  quickFixtures: string;
  upcomingCompetitions: string;
  rank: string;

  // Club Selection & Profile
  topLeagues: string;
  allClubs: string;
  available: string;
  claimed: string;
  claimedBy: string;
  claimClub: string;
  clubLocked: string;
  alreadyHaveClubMessage: string;
  claimConfirmationTitle: string;
  claimConfirmationDesc: string;
  claimSuccess: string;
  clubOverview: string;
  stadium: string;
  city: string;
  tier: string;
  manager: string;
  competitionsParticipating: string;
  domesticTitle: string;
  cupTitle: string;
  europeanTitle: string;

  // Matches & Match Center
  matchCenter: string;
  matchday: string;
  round: string;
  deadline: string;
  instructions: string;
  instructionsText: string;
  submitResult: string;
  submitScoreTitle: string;
  homeScore: string;
  awayScore: string;
  screenshotProof: string;
  screenshotOptional: string;
  submissionSuccess: string;
  pendingConfirmation: string;
  opponentSubmitted: string;
  confirmOpponentScore: string;
  reportDispute: string;
  matchStatusUpcoming: string;
  matchStatusPending: string;
  matchStatusConfirmed: string;
  matchStatusDisputed: string;
  matchStatusCancelled: string;

  // Standings
  leagueStandings: string;
  pos: string;
  club: string;
  p: string;
  w: string;
  d: string;
  l: string;
  gf: string;
  ga: string;
  gd: string;
  pts: string;
  form: string;
  uclZone: string;
  uelZone: string;
  ueclZone: string;
  relegationZone: string;

  // Cups & UEFA
  knockoutBracket: string;
  roundOf32: string;
  roundOf16: string;
  quarterFinals: string;
  semiFinals: string;
  final: string;
  winner: string;
  advanceWinner: string;
  uefaChampionsLeague: string;
  uefaEuropaLeague: string;
  uefaConferenceLeague: string;
  leaguePhase: string;
  superCup: string;
  superCupTitle: string;

  // Notifications
  notificationsTitle: string;
  noNotifications: string;
  markAllRead: string;
  newFixture: string;
  resultConfirmed: string;
  resultDisputed: string;
  disputeResolved: string;

  // Profile
  profileTitle: string;
  telegramAccount: string;
  managerRole: string;
  memberSince: string;
  careerStats: string;
  changeLanguage: string;
  sandboxSwitcher: string;
  switchProfile: string;

  // Admin
  adminPanel: string;
  totalUsers: string;
  activeClubs: string;
  pendingDisputes: string;
  scheduledMatches: string;
  disputeResolutionCenter: string;
  evidenceComparison: string;
  acceptHome: string;
  acceptAway: string;
  customScore: string;
  voidMatch: string;
  fixtureManagement: string;
  generateSchedule: string;
  evaluateQualifications: string;
  auditLogs: string;
  adminAuthorizationRequired: string;
  adminDashboardTitle: string;
  adminOfficer: string;
  adminRefreshCenter: string;
  adminOverview: string;
  adminResultsReview: string;
  adminCompetitions: string;
  adminDomesticCups: string;
  adminEuropeanCompetitions: string;
  adminTelegramBot: string;
  adminPlayers: string;
  adminSystemDiagnostics: string;
  adminResetResult: string;
  adminResetResultHint: string;
  adminCurrentScore: string;
  adminDeleteSubmissionsHint: string;
  adminReasonNotes: string;
  adminResetReasonExample: string;
  adminStandingsRecalculated: string;
  adminDeleteFixture: string;
  adminDangerousAction: string;
  adminDeleteFixtureReason: string;
  adminDeleteFixtureExample: string;
  adminTypeToConfirm: string;
  adminDeleteFixtureForever: string;
  adminUserInspection: string;
  adminLoadingUserHistory: string;
  adminDeleteUser: string;
  adminDeleteUserHint: string;
  adminSafeDeletion: string;
  adminReleaseClubsHint: string;
  adminPreserveMatchesHint: string;
  adminLastAdminHint: string;
  adminOptionalReason: string;
  adminPromote: string;
  adminDemote: string;
  adminGrantAccessHint: string;
  adminRevokeAccessHint: string;
  adminAccessControl: string;
  adminSuspend: string;
  adminLiftSuspension: string;
  adminSuspensionHint: string;
  adminSuspendReason: string;
  adminSuspendExample: string;
  adminConfirmPromotion: string;
  adminConfirmDemotion: string;
  adminConfirmSuspension: string;
  roadmapLeague19: string;
  roadmapLeague19Desc: string;
  roadmapDomesticCupsDesc: string;
  roadmapLeague1019: string;
  roadmapLeague1019Desc: string;
  roadmapEurope: string;
  roadmapEuropeDesc: string;

  // Additional tournament & UI labels
  domesticLeagues: string;
  nationalCups: string;
  championsLeague: string;
  qualificationRules: string;
  uefaClubCompetitions: string;
  uefaSubtitle: string;
  cupJourney: string;
  cupClubs: string;
  cupMatches: string;
  cupChampion: string;
  adminSectionsHint: string;
  seasonRoadmap: string;
  europeanQualificationHint: string;
  noEuropeanParticipants: string;
  matchesBeingScheduled: string;
  retry: string;
  knockoutPlayoffs: string;
  r16Match: string;
  quarterFinal: string;
  semiFinal: string;
  grandFinal: string;
  uefaFinal: string;
  playoff: string;
  writeToOpponent: string;
  userNeeded: string;
  matchFinished: string;
  matchInProgress: string;
  matchTBD: string;
  viewOpponentProfile: string;
  opponentBadge: string;
  profile: string;
  finalRound: string;
}

export const translations: Record<Language, Translations> = {
  uz: {
    navHome: 'Bosh sahifa',
    navMyClub: 'Mening klubim',
    navMyMatches: 'Mening o‘yinlarim',
    navLeagues: 'Ligalar',
    navCups: 'Kuboklar',
    navChampionsLeague: 'Chempionlar Ligasi',
    navStandings: 'Turnir jadvali',
    navNotifications: 'Xabarlar',
    navProfile: 'Profil',
    navAdmin: 'Admin panel',

    season: 'Mavsum',
    selectLanguage: 'Tilni tanlang',
    loading: 'Yuklanmoqda...',
    error: 'Xatolik yuz berdi',
    save: 'Saqlash',
    cancel: 'Bekor qilish',
    close: 'Yopish',
    confirm: 'Tasdiqlash',
    dispute: 'E’tiroz bildirish',
    status: 'Holat',
    actions: 'Amallar',
    search: 'Qidirish...',
    filterAll: 'Barchasi',
    refresh: 'Yangilash',
    back: 'Orqaga',

    managerHub: 'Menejer markazi',
    myClub: 'Mening klubim',
    noClubSelected: 'Siz hali klub tanlamadingiz',
    selectYourClub: 'Klub tanlash',
    currentPosition: 'O‘rin',
    points: 'Ochko',
    pointsAbbr: 'OCH',
    played: 'O‘yin',
    won: 'G‘alaba',
    drawn: 'Durang',
    lost: 'Mag‘lubiyat',
    goalsFor: 'Urgan gollari',
    goalsAgainst: 'O‘tkazgan gollari',
    goalDifference: 'Gollar farqi',
    recentForm: 'So‘nggi o‘yinlar formasi',
    nextMatch: 'Navbatdagi o‘yin',
    latestResult: 'So‘nggi natija',
    noUpcomingMatches: 'Hozircha rejalashtirilgan o‘yinlar yo‘q',
    openMatchCenter: 'O‘yin markazini ochish',
    quickFixtures: 'Tezkor taqvim',
    upcomingCompetitions: 'Mavsumiy musobaqalar',
    rank: 'O‘rin',

    topLeagues: 'Top 5 Yevropa ligalari',
    allClubs: 'Barcha klublar',
    available: 'Bo‘sh',
    claimed: 'Band qilingan',
    claimedBy: 'Egasi',
    claimClub: 'Klubni tanlash',
    clubLocked: 'Klub tanlovi qulflangan',
    alreadyHaveClubMessage: 'Siz bu mavsum uchun klub tanlagansiz. Mavsum davomida klubni o‘zgartirish taqiqlanadi.',
    claimConfirmationTitle: 'Klubni band qilishni tasdiqlaysizmi?',
    claimConfirmationDesc: 'Ushbu klub butun mavsum davomida faqat sizga tegishli bo‘ladi.',
    claimSuccess: 'Klub muvaffaqiyatli band qilindi!',
    clubOverview: 'Klub ma’lumotlari',
    stadium: 'Stadion',
    city: 'Shahar',
    tier: 'Daraja',
    manager: 'Menejer',
    competitionsParticipating: 'Ishtirok etayotgan musobaqalar',
    domesticTitle: 'Ichki chempionat',
    cupTitle: 'Milliy kubok',
    europeanTitle: 'Yevrokuboklar',

    matchCenter: 'O‘yin markazi',
    matchday: 'Tur',
    round: 'Bosqich',
    deadline: 'Muddat',
    instructions: 'eFootball ko‘rsatmalari',
    instructionsText: 'eFootball o‘yinida o‘zaro do‘stona o‘yin o‘tkazing va yakuniy natijani bu yerga kiriting.',
    submitResult: 'Hisobni kiritish',
    submitScoreTitle: 'O‘yin hisobini yuborish',
    homeScore: 'Uy jamoasi hisobi',
    awayScore: 'Mehmon jamoasi hisobi',
    screenshotProof: 'Skrinshot / Isbot havolasi',
    screenshotOptional: 'Skrinshot URL manzili (ixtiyoriy)',
    submissionSuccess: 'Natija yuborildi!',
    pendingConfirmation: 'Raqib tasdiqlashi kutilmoqda',
    opponentSubmitted: 'Raqib hisobni kiritdi',
    confirmOpponentScore: 'Hisobni tasdiqlash',
    reportDispute: 'Hisobga e’tiroz bildirish',
    matchStatusUpcoming: 'Kutilmoqda',
    matchStatusPending: 'Tasdiqlash kutilmoqda',
    matchStatusConfirmed: 'Tasdiqlandi',
    matchStatusDisputed: 'Bahsli (Dispute)',
    matchStatusCancelled: 'Bekor qilingan',

    leagueStandings: 'Turnir jadvali',
    pos: '№',
    club: 'Klub',
    p: 'O‘',
    w: 'G‘',
    d: 'D',
    l: 'M',
    gf: 'UG',
    ga: 'O‘G',
    gd: 'GF',
    pts: 'OCH',
    form: 'Forma',
    uclZone: 'UEFA Chempionlar Ligasi',
    uelZone: 'UEFA Yevropa Ligasi',
    ueclZone: 'UEFA Konferensiyalar Ligasi',
    relegationZone: 'Quyi ligaga tushish',

    knockoutBracket: 'Pley-off to‘ri',
    roundOf32: '1/16 Final',
    roundOf16: '1/8 Final',
    quarterFinals: 'Chorak final',
    semiFinals: 'Yarim final',
    final: 'Final',
    winner: 'G‘olib',
    advanceWinner: 'G‘olibni oldinga surish',
    uefaChampionsLeague: 'UEFA Chempionlar Ligasi',
    uefaEuropaLeague: 'UEFA Yevropa Ligasi',
    uefaConferenceLeague: 'UEFA Konferensiyalar Ligasi',
    leaguePhase: 'Liga bosqichi',
    superCup: 'Superkubok',
    superCupTitle: 'Milliy Superkubok',

    notificationsTitle: 'Bildirishnomalar',
    noNotifications: 'Hozircha bildirishnomalar mavjud emas',
    markAllRead: 'Barchasini o‘qilgan deb belgilash',
    newFixture: 'Yangi o‘yin rejalashtirildi',
    resultConfirmed: 'Natija tasdiqlandi',
    resultDisputed: 'Bahsli natija qayd etildi',
    disputeResolved: 'Bahs hakam tomonidan hal qilindi',

    profileTitle: 'Menejer profili',
    telegramAccount: 'Telegram akkaunt',
    managerRole: 'Menejerlik unvoni',
    memberSince: 'Ro‘yxatdan o‘tgan vaqti',
    careerStats: 'Karyera statistikasi',
    changeLanguage: 'Ilova tilini o‘zgartirish',
    sandboxSwitcher: 'Test rejimida akkauntni almashtirish',
    switchProfile: 'Profilni tanlash',

    adminPanel: 'Boshqaruv markazi',
    totalUsers: 'Jami foydalanuvchilar',
    activeClubs: 'Band qilingan klublar',
    pendingDisputes: 'Kutilayotgan bahslar',
    scheduledMatches: 'Rejalashtirilgan o‘yinlar',
    disputeResolutionCenter: 'Bahslarni ko‘rib chiqish markazi',
    evidenceComparison: 'Skrinshot va hisoblar taqqoslovi',
    acceptHome: 'Uy jamoasini g‘olib deb topish',
    acceptAway: 'Mehmon jamoasini g‘olib deb topish',
    customScore: 'Qo‘lda hisob belgilash',
    voidMatch: 'O‘yinni bekor qilish',
    fixtureManagement: 'Taqvimni boshqarish',
    generateSchedule: 'Berger round-robin jadvalini yaratish',
    evaluateQualifications: 'Yevrokubok yo‘llanmalarini hisoblash',
    auditLogs: 'Tizim xavfsizlik va audit jurnali',
    adminAuthorizationRequired: 'Administrator huquqi kerak',
    adminDashboardTitle: 'EFL UZ musobaqalarini boshqarish tizimi',
    adminOfficer: 'Mas’ul',
    adminRefreshCenter: 'Markazni yangilash',
    adminOverview: 'Umumiy ko‘rinish',
    adminResultsReview: 'Natijalar va ko‘rib chiqish',
    adminCompetitions: '19 ta musobaqa',
    adminDomesticCups: 'Milliy kuboklar (5)',
    adminEuropeanCompetitions: 'UCL va UEL (32)',
    adminTelegramBot: 'Telegram bot',
    adminPlayers: 'O‘yinchilar',
    adminSystemDiagnostics: 'Tizim diagnostikasi',
    adminResetResult: 'O‘yin natijasini tiklash',
    adminResetResultHint: 'Hisobni tozalab, o‘yinni rejalashtirilgan holatga qaytarish',
    adminCurrentScore: 'Joriy hisob',
    adminDeleteSubmissionsHint: 'Ushbu o‘yinga yuborilgan barcha hisoblarni ham o‘chirish',
    adminReasonNotes: 'Sabab / izoh',
    adminResetReasonExample: 'Masalan: natija xato kiritilgan; o‘yin qayta belgilangan',
    adminStandingsRecalculated: 'Bu o‘yinning ochko va gollari chiqarilib, jadval avtomatik qayta hisoblanadi.',
    adminDeleteFixture: 'Uchrashuvni o‘chirish',
    adminDangerousAction: 'Xavfli administrator amali',
    adminDeleteFixtureReason: 'O‘chirish sababi (majburiy)',
    adminDeleteFixtureExample: 'Masalan: takroriy test uchrashuvi',
    adminTypeToConfirm: 'Tasdiqlash uchun kiriting',
    adminDeleteFixtureForever: 'Uchrashuvni butunlay o‘chirish',
    adminUserInspection: 'Foydalanuvchi profili va hisobi',
    adminLoadingUserHistory: 'Foydalanuvchi profili va tarixi yuklanmoqda...',
    adminDeleteUser: 'Foydalanuvchini o‘chirish',
    adminDeleteUserHint: 'Klublar bo‘shaydi, o‘yin ma’lumotlari saqlanadi',
    adminSafeDeletion: 'O‘chirish kafolatlari',
    adminReleaseClubsHint: 'Band qilingan klublar boshqa o‘yinchilarga ochiladi.',
    adminPreserveMatchesHint: 'Mavjud uchrashuvlar va tasdiqlangan hisoblar saqlanadi.',
    adminLastAdminHint: 'Oxirgi administratorni o‘chirib bo‘lmaydi.',
    adminOptionalReason: 'Sabab (ixtiyoriy)',
    adminPromote: 'Administrator etib tayinlash',
    adminDemote: 'Administrator huquqini olib tashlash',
    adminGrantAccessHint: 'Administrator o‘yinlar, natijalar, jadval, bahslar, klublar va foydalanuvchilarni boshqara oladi.',
    adminRevokeAccessHint: 'Foydalanuvchining admin paneliga kirish huquqi olib tashlanadi. Oxirgi administratorni olib tashlab bo‘lmaydi.',
    adminAccessControl: 'Foydalanuvchi huquqlarini boshqarish',
    adminSuspend: 'Foydalanuvchini cheklash',
    adminLiftSuspension: 'Cheklovni olib tashlash',
    adminSuspensionHint: 'Intizom va kirish huquqini boshqarish',
    adminSuspendReason: 'Cheklash sababi (ixtiyoriy)',
    adminSuspendExample: 'Masalan: sportga zid xatti-harakat yoki o‘yinga kelmaslik',
    adminConfirmPromotion: 'Tayinlashni tasdiqlash',
    adminConfirmDemotion: 'Huquqni olib tashlashni tasdiqlash',
    adminConfirmSuspension: 'Cheklashni tasdiqlash',
    roadmapLeague19: 'Liga 1–9-turlar',
    roadmapLeague19Desc: '1-turdan keyin navbatdagi tur ochiladi; 9-turdan keyin kuboklar.',
    roadmapDomesticCupsDesc: '5 ta milliy kubok bosqichi.',
    roadmapLeague1019: 'Liga 10–19-turlar',
    roadmapLeague1019Desc: 'Bir davrali liga 19-tur bilan yakunlanadi.',
    roadmapEurope: 'UCL / UEL',
    roadmapEuropeDesc: '19-turdan keyin Yevropa ligasi bosqichi navbatma-navbat o‘tkaziladi.',

    domesticLeagues: 'Ichki chempionatlar',
    nationalCups: 'Milliy kuboklar',
    championsLeague: 'Chempionlar Ligasi',
    qualificationRules: 'Saralash qoidalari',
    uefaClubCompetitions: 'UEFA Klub Musobaqalari 2026/27',
    uefaSubtitle: 'Klublar foydalanuvchilar natijalari va ichki liga jadvali orqali saralanadi.',
    cupJourney: '2026/27 kubok yo‘li',
    cupClubs: 'Klublar',
    cupMatches: 'O‘yinlar',
    cupChampion: 'Chempion',
    adminSectionsHint: 'Bo‘limlar uchun yon tomonga suring →',
    seasonRoadmap: 'Mavsum yo‘l xaritasi',
    europeanQualificationHint: 'Klublar ichki liga jadvali va kubok natijalari asosida saralanadi.',
    noEuropeanParticipants: 'Hozircha Yevrokubok ishtirokchilari aniqlanmagan',
    matchesBeingScheduled: 'Saralangan klublar uchun o‘yinlar rejalashtirilmoqda...',
    retry: 'Qayta urinish',
    knockoutPlayoffs: 'O‘tish pley-offi',
    r16Match: 'Nimchorak final',
    quarterFinal: 'Chorak final',
    semiFinal: 'Yarim final',
    grandFinal: 'Grand Final',
    uefaFinal: 'UEFA Final',
    playoff: 'Pley-off',
    writeToOpponent: 'Raqibga yozish',
    userNeeded: 'User kerak',
    matchFinished: 'Tugagan',
    matchInProgress: 'Jarayonda',
    matchTBD: 'Kutilmoqda / TBD',
    viewOpponentProfile: 'Raqib profili',
    opponentBadge: 'Raqib',
    profile: 'Profil',
    finalRound: 'Final',
  },
  ru: {
    navHome: 'Главная',
    navMyClub: 'Мой клуб',
    navMyMatches: 'Мои матчи',
    navLeagues: 'Лиги',
    navCups: 'Кубки',
    navChampionsLeague: 'Лига Чемпионов',
    navStandings: 'Таблица',
    navNotifications: 'Уведомления',
    navProfile: 'Профиль',
    navAdmin: 'Админ панель',

    season: 'Сезон',
    selectLanguage: 'Выберите язык',
    loading: 'Загрузка...',
    error: 'Произошла ошибка',
    save: 'Сохранить',
    cancel: 'Отмена',
    close: 'Закрыть',
    confirm: 'Подтвердить',
    dispute: 'Оспорить',
    status: 'Статус',
    actions: 'Действия',
    search: 'Поиск...',
    filterAll: 'Все',
    refresh: 'Обновить',
    back: 'Назад',

    managerHub: 'Центр управления',
    myClub: 'Мой клуб',
    noClubSelected: 'Вы еще не выбрали клуб',
    selectYourClub: 'Выбрать клуб',
    currentPosition: 'Место',
    points: 'Очки',
    pointsAbbr: 'ОЧК',
    played: 'Игры',
    won: 'Победы',
    drawn: 'Ничьи',
    lost: 'Поражения',
    goalsFor: 'Забито',
    goalsAgainst: 'Пропущено',
    goalDifference: 'Разница',
    recentForm: 'Форма последних матчей',
    nextMatch: 'Следующий матч',
    latestResult: 'Последний результат',
    noUpcomingMatches: 'Пока нет запланированных матчей',
    openMatchCenter: 'Открыть Матч-Центр',
    quickFixtures: 'Быстрый календарь',
    upcomingCompetitions: 'Турниры сезона',
    rank: 'Место',

    topLeagues: 'Топ-5 Лиг Европы',
    allClubs: 'Все клубы',
    available: 'Свободен',
    claimed: 'Занят',
    claimedBy: 'Владелец',
    claimClub: 'Выбрать этот клуб',
    clubLocked: 'Выбор клуба заблокирован',
    alreadyHaveClubMessage: 'Вы уже выбрали клуб на этот сезон. Смена клуба в течение сезона запрещена.',
    claimConfirmationTitle: 'Подтвердить выбор клуба?',
    claimConfirmationDesc: 'Этот клуб будет закреплен за вами на весь текущий сезон.',
    claimSuccess: 'Клуб успешно закреплен!',
    clubOverview: 'Информация о клубе',
    stadium: 'Стадион',
    city: 'Город',
    tier: 'Уровень',
    manager: 'Менеджер',
    competitionsParticipating: 'Участие в турнирах',
    domesticTitle: 'Чемпионат страны',
    cupTitle: 'Национальный кубок',
    europeanTitle: 'Еврокубки',

    matchCenter: 'Матч-Центр',
    matchday: 'Тур',
    round: 'Раунд',
    deadline: 'Дедлайн',
    instructions: 'Инструкция eFootball',
    instructionsText: 'Сыграйте матч в eFootball и внесите итоговый результат сюда.',
    submitResult: 'Ввести счёт',
    submitScoreTitle: 'Отправка счёта матча',
    homeScore: 'Счёт хозяев',
    awayScore: 'Счёт гостей',
    screenshotProof: 'Скриншот / Ссылка на пруф',
    screenshotOptional: 'URL скриншота (опционально)',
    submissionSuccess: 'Счёт успешно отправлен!',
    pendingConfirmation: 'Ожидается подтверждение соперника',
    opponentSubmitted: 'Соперник отправил результат',
    confirmOpponentScore: 'Подтвердить счёт',
    reportDispute: 'Оспорить результат',
    matchStatusUpcoming: 'Предстоит',
    matchStatusPending: 'Ожидает подтверждения',
    matchStatusConfirmed: 'Подтверждён',
    matchStatusDisputed: 'Спорный (Dispute)',
    matchStatusCancelled: 'Отменён',

    leagueStandings: 'Турнирная таблица',
    pos: '№',
    club: 'Клуб',
    p: 'И',
    w: 'В',
    d: 'Н',
    l: 'П',
    gf: 'З',
    ga: 'П',
    gd: 'РГ',
    pts: 'О',
    form: 'Форма',
    uclZone: 'Лига Чемпионов УЕФА',
    uelZone: 'Лига Европы УЕФА',
    ueclZone: 'Лига Конференций УЕФА',
    relegationZone: 'Зона вылета',

    knockoutBracket: 'Сетка плей-офф',
    roundOf32: '1/16 финала',
    roundOf16: '1/8 финала',
    quarterFinals: 'Четвертьфинал',
    semiFinals: 'Полуфинал',
    final: 'Финал',
    winner: 'Победитель',
    advanceWinner: 'Продвинуть победителя',
    uefaChampionsLeague: 'Лига Чемпионов УЕФА',
    uefaEuropaLeague: 'Лига Европы УЕФА',
    uefaConferenceLeague: 'Лига Конференций УЕФА',
    leaguePhase: 'Лиговый этап',
    superCup: 'Суперкубок',
    superCupTitle: 'Национальный Суперкубок',

    notificationsTitle: 'Уведомления',
    noNotifications: 'Нет новых уведомлений',
    markAllRead: 'Прочитать все',
    newFixture: 'Назначен новый матч',
    resultConfirmed: 'Результат подтверждён',
    resultDisputed: 'Зафиксирован спор по счёту',
    disputeResolved: 'Спор решён администратором',

    profileTitle: 'Профиль менеджера',
    telegramAccount: 'Telegram аккаунт',
    managerRole: 'Ранг тренера',
    memberSince: 'Дата регистрации',
    careerStats: 'Статистика карьеры',
    changeLanguage: 'Язык интерфейса',
    sandboxSwitcher: 'Переключение тестового аккаунта',
    switchProfile: 'Сменить профиль',

    adminPanel: 'Панель администратора',
    totalUsers: 'Всего пользователей',
    activeClubs: 'Занятых клубов',
    pendingDisputes: 'Активных споров',
    scheduledMatches: 'Запланировано матчей',
    disputeResolutionCenter: 'Центр разрешения споров',
    evidenceComparison: 'Сравнение счетов и скриншотов',
    acceptHome: 'Присудить победу хозяевам',
    acceptAway: 'Присудить победу гостям',
    customScore: 'Установить точный счёт',
    voidMatch: 'Аннулировать матч',
    fixtureManagement: 'Управление календарём',
    generateSchedule: 'Сгенерировать сетку по системе Бергера',
    evaluateQualifications: 'Рассчитать еврокубковые путевки',
    auditLogs: 'Журнал аудита и безопасности',
    adminAuthorizationRequired: 'Требуются права администратора',
    adminDashboardTitle: 'Система управления соревнованиями EFL UZ',
    adminOfficer: 'Ответственный',
    adminRefreshCenter: 'Обновить центр',
    adminOverview: 'Обзор',
    adminResultsReview: 'Результаты и проверка',
    adminCompetitions: '19 соревнований',
    adminDomesticCups: 'Национальные кубки (5)',
    adminEuropeanCompetitions: 'ЛЧ и ЛЕ (32)',
    adminTelegramBot: 'Telegram-бот',
    adminPlayers: 'Игроки',
    adminSystemDiagnostics: 'Диагностика системы',
    adminResetResult: 'Сбросить результат матча',
    adminResetResultHint: 'Очистить счёт и вернуть матч в запланированное состояние',
    adminCurrentScore: 'Текущий счёт',
    adminDeleteSubmissionsHint: 'Также удалить все отправленные счета этого матча',
    adminReasonNotes: 'Причина / примечание',
    adminResetReasonExample: 'Например: счёт введён ошибочно; матч перенесён',
    adminStandingsRecalculated: 'Очки и голы этого матча будут исключены из таблицы автоматически.',
    adminDeleteFixture: 'Удалить матч',
    adminDangerousAction: 'Опасное действие администратора',
    adminDeleteFixtureReason: 'Причина удаления (обязательно)',
    adminDeleteFixtureExample: 'Например: дублирующий тестовый матч',
    adminTypeToConfirm: 'Для подтверждения введите',
    adminDeleteFixtureForever: 'Удалить матч навсегда',
    adminUserInspection: 'Профиль и учётная запись пользователя',
    adminLoadingUserHistory: 'Загружаются профиль и история пользователя...',
    adminDeleteUser: 'Удалить пользователя',
    adminDeleteUserHint: 'Клубы освобождаются, данные матчей сохраняются',
    adminSafeDeletion: 'Гарантии удаления',
    adminReleaseClubsHint: 'Занятые клубы станут доступны другим игрокам.',
    adminPreserveMatchesHint: 'Существующие матчи и подтверждённые счета сохранятся.',
    adminLastAdminHint: 'Последнего администратора удалить нельзя.',
    adminOptionalReason: 'Причина (необязательно)',
    adminPromote: 'Назначить администратором',
    adminDemote: 'Снять права администратора',
    adminGrantAccessHint: 'Администратор может управлять матчами, результатами, таблицами, спорами, клубами и игроками.',
    adminRevokeAccessHint: 'Доступ к панели администратора будет отозван. Последнего администратора снять нельзя.',
    adminAccessControl: 'Управление правами пользователя',
    adminSuspend: 'Заблокировать пользователя',
    adminLiftSuspension: 'Снять блокировку',
    adminSuspensionHint: 'Дисциплина и управление доступом',
    adminSuspendReason: 'Причина блокировки (необязательно)',
    adminSuspendExample: 'Например: неспортивное поведение или неявка на матчи',
    adminConfirmPromotion: 'Подтвердить назначение',
    adminConfirmDemotion: 'Подтвердить снятие прав',
    adminConfirmSuspension: 'Подтвердить блокировку',
    roadmapLeague19: 'Лига, туры 1–9',
    roadmapLeague19Desc: 'Следующий тур открывается после завершения предыдущего; после 9-го тура — кубки.',
    roadmapDomesticCupsDesc: 'Этап национальных кубков (5 турниров).',
    roadmapLeague1019: 'Лига, туры 10–19',
    roadmapLeague1019Desc: 'Однокруговой чемпионат завершается 19-м туром.',
    roadmapEurope: 'ЛЧ / ЛЕ',
    roadmapEuropeDesc: 'После 19-го тура поэтапно начинаются европейские турниры.',

    domesticLeagues: 'Внутренние чемпионаты',
    nationalCups: 'Национальные кубки',
    championsLeague: 'Лига Чемпионов',
    qualificationRules: 'Правила квалификации',
    uefaClubCompetitions: 'Клубные турниры УЕФА 2026/27',
    uefaSubtitle: 'Клубы отбираются по результатам игроков и таблицам внутренних лиг.',
    cupJourney: 'Кубковый путь 2026/27',
    cupClubs: 'Клубы',
    cupMatches: 'Матчи',
    cupChampion: 'Чемпион',
    adminSectionsHint: 'Листайте вбок для других разделов →',
    seasonRoadmap: 'Этапы сезона',
    europeanQualificationHint: 'Клубы отбираются по таблицам внутренних лиг и результатам кубков.',
    noEuropeanParticipants: 'Участники еврокубков пока не определены',
    matchesBeingScheduled: 'Расписание для квалифицированных клубов формируется...',
    retry: 'Повторить',
    knockoutPlayoffs: 'Стыковые матчи плей-офф',
    r16Match: '1/8 финала',
    quarterFinal: '1/4 финала',
    semiFinal: '1/2 финала',
    grandFinal: 'Гранд-финал',
    uefaFinal: 'Финал УЕФА',
    playoff: 'Плей-офф',
    writeToOpponent: 'Написать сопернику',
    userNeeded: 'Нужен игрок',
    matchFinished: 'Завершён',
    matchInProgress: 'В процессе',
    matchTBD: 'Ожидается / TBD',
    viewOpponentProfile: 'Профиль соперника',
    opponentBadge: 'Соперник',
    profile: 'Профиль',
    finalRound: 'Финал',
  },
  en: {
    navHome: 'Home',
    navMyClub: 'My Club',
    navMyMatches: 'My Matches',
    navLeagues: 'Leagues',
    navCups: 'Cups',
    navChampionsLeague: 'Champions League',
    navStandings: 'Standings',
    navNotifications: 'Notifications',
    navProfile: 'Profile',
    navAdmin: 'Admin',

    season: 'Season',
    selectLanguage: 'Select Language',
    loading: 'Loading...',
    error: 'An error occurred',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    dispute: 'Dispute',
    status: 'Status',
    actions: 'Actions',
    search: 'Search...',
    filterAll: 'All',
    refresh: 'Refresh',
    back: 'Back',

    managerHub: 'Manager Hub',
    myClub: 'My Club',
    noClubSelected: 'No club claimed yet',
    selectYourClub: 'Claim a Club',
    currentPosition: 'Position',
    points: 'Points',
    pointsAbbr: 'PTS',
    played: 'Played',
    won: 'Won',
    drawn: 'Drawn',
    lost: 'Lost',
    goalsFor: 'GF',
    goalsAgainst: 'GA',
    goalDifference: 'GD',
    recentForm: 'Recent Form',
    nextMatch: 'Next Match',
    latestResult: 'Latest Result',
    noUpcomingMatches: 'No scheduled matches currently',
    openMatchCenter: 'Open Match Center',
    quickFixtures: 'Quick Fixtures',
    upcomingCompetitions: 'Season Competitions',
    rank: 'Rank',

    topLeagues: 'Top 5 European Leagues',
    allClubs: 'All Clubs',
    available: 'Available',
    claimed: 'Claimed',
    claimedBy: 'Owner',
    claimClub: 'Claim Club',
    clubLocked: 'Club Selection Locked',
    alreadyHaveClubMessage: 'You already selected a club for this season. Club selection is locked for the entire season.',
    claimConfirmationTitle: 'Confirm Club Claim?',
    claimConfirmationDesc: 'This club will be assigned exclusively to your account for the entire season.',
    claimSuccess: 'Club successfully claimed!',
    clubOverview: 'Club Overview',
    stadium: 'Stadium',
    city: 'City',
    tier: 'Tier',
    manager: 'Manager',
    competitionsParticipating: 'Active Competitions',
    domesticTitle: 'Domestic League',
    cupTitle: 'Domestic Cup',
    europeanTitle: 'European Competitions',

    matchCenter: 'Match Center',
    matchday: 'Matchday',
    round: 'Round',
    deadline: 'Deadline',
    instructions: 'eFootball Instructions',
    instructionsText: 'Play the match in eFootball and submit the final official score here.',
    submitResult: 'Submit Result',
    submitScoreTitle: 'Submit Match Score',
    homeScore: 'Home Score',
    awayScore: 'Away Score',
    screenshotProof: 'Screenshot / Proof Link',
    screenshotOptional: 'Screenshot URL (optional)',
    submissionSuccess: 'Score submitted successfully!',
    pendingConfirmation: 'Pending Opponent Confirmation',
    opponentSubmitted: 'Opponent Submitted Score',
    confirmOpponentScore: 'Confirm Score',
    reportDispute: 'Report Dispute',
    matchStatusUpcoming: 'Upcoming',
    matchStatusPending: 'Pending Confirmation',
    matchStatusConfirmed: 'Confirmed',
    matchStatusDisputed: 'Disputed',
    matchStatusCancelled: 'Cancelled',

    leagueStandings: 'League Standings',
    pos: 'Pos',
    club: 'Club',
    p: 'P',
    w: 'W',
    d: 'D',
    l: 'L',
    gf: 'GF',
    ga: 'GA',
    gd: 'GD',
    pts: 'PTS',
    form: 'Form',
    uclZone: 'UEFA Champions League',
    uelZone: 'UEFA Europa League',
    ueclZone: 'UEFA Conference League',
    relegationZone: 'Relegation Zone',

    knockoutBracket: 'Knockout Bracket',
    roundOf32: 'Round of 32',
    roundOf16: 'Round of 16',
    quarterFinals: 'Quarter-Finals',
    semiFinals: 'Semi-Finals',
    final: 'Final',
    winner: 'Winner',
    advanceWinner: 'Advance Winner',
    uefaChampionsLeague: 'UEFA Champions League',
    uefaEuropaLeague: 'UEFA Europa League',
    uefaConferenceLeague: 'UEFA Conference League',
    leaguePhase: 'League Phase',
    superCup: 'Super Cup',
    superCupTitle: 'Domestic Super Cup',

    notificationsTitle: 'Notifications',
    noNotifications: 'No notifications at this time',
    markAllRead: 'Mark all as read',
    newFixture: 'New fixture scheduled',
    resultConfirmed: 'Result confirmed',
    resultDisputed: 'Result disputed',
    disputeResolved: 'Dispute resolved by admin',

    profileTitle: 'Manager Profile',
    telegramAccount: 'Telegram Account',
    managerRole: 'Manager Rank',
    memberSince: 'Member Since',
    careerStats: 'Career Statistics',
    changeLanguage: 'Interface Language',
    sandboxSwitcher: 'Sandbox Test Account Switcher',
    switchProfile: 'Switch Profile',

    adminPanel: 'Admin Control Center',
    totalUsers: 'Total Users',
    activeClubs: 'Claimed Clubs',
    pendingDisputes: 'Active Disputes',
    scheduledMatches: 'Scheduled Matches',
    disputeResolutionCenter: 'Dispute Resolution Center',
    evidenceComparison: 'Side-by-Side Evidence Comparison',
    acceptHome: 'Rule in favor of Home',
    acceptAway: 'Rule in favor of Away',
    customScore: 'Set Custom Score',
    voidMatch: 'Void / Cancel Match',
    fixtureManagement: 'Fixture Management',
    generateSchedule: 'Generate Berger Round-Robin Schedule',
    evaluateQualifications: 'Calculate European Qualifications',
    auditLogs: 'Audit & Security Logs',
    adminAuthorizationRequired: 'Administrator authorization required',
    adminDashboardTitle: 'EFL UZ Competition Management System',
    adminOfficer: 'Officer',
    adminRefreshCenter: 'Refresh Center',
    adminOverview: 'Overview',
    adminResultsReview: 'Results & Review',
    adminCompetitions: '19 Competitions',
    adminDomesticCups: 'Domestic Cups (5)',
    adminEuropeanCompetitions: 'UCL & UEL (32)',
    adminTelegramBot: 'Telegram Bot',
    adminPlayers: 'Players',
    adminSystemDiagnostics: 'System Diagnostics',
    adminResetResult: 'Reset Match Result',
    adminResetResultHint: 'Clear scores and return the match to scheduled status',
    adminCurrentScore: 'Current Score',
    adminDeleteSubmissionsHint: 'Also delete all submitted scores for this match',
    adminReasonNotes: 'Reason / Notes',
    adminResetReasonExample: 'For example: result entered by mistake; match rescheduled',
    adminStandingsRecalculated: 'Points and goals from this match will be removed from the standings automatically.',
    adminDeleteFixture: 'Delete Match Fixture',
    adminDangerousAction: 'Dangerous administrative action',
    adminDeleteFixtureReason: 'Reason for deletion (required)',
    adminDeleteFixtureExample: 'For example: duplicate test fixture',
    adminTypeToConfirm: 'Type to confirm',
    adminDeleteFixtureForever: 'Permanently Delete Fixture',
    adminUserInspection: 'User Profile & Account Inspection',
    adminLoadingUserHistory: 'Loading user profile and history...',
    adminDeleteUser: 'Delete User',
    adminDeleteUserHint: 'Claimed clubs are released while match data stays intact',
    adminSafeDeletion: 'Safe deletion guarantees',
    adminReleaseClubsHint: 'Claimed clubs become available to other players.',
    adminPreserveMatchesHint: 'Existing fixtures and confirmed scores remain intact.',
    adminLastAdminHint: 'The last administrator cannot be deleted.',
    adminOptionalReason: 'Reason (optional)',
    adminPromote: 'Promote to Administrator',
    adminDemote: 'Demote from Administrator',
    adminGrantAccessHint: 'Administrators can manage matches, results, standings, disputes, clubs, and players.',
    adminRevokeAccessHint: 'Access to the admin console will be revoked. The last administrator cannot be demoted.',
    adminAccessControl: 'Manage user access privileges',
    adminSuspend: 'Suspend User Account',
    adminLiftSuspension: 'Lift Account Suspension',
    adminSuspensionHint: 'Disciplinary and access control',
    adminSuspendReason: 'Reason for suspension (optional)',
    adminSuspendExample: 'For example: unsportsmanlike conduct or repeated no-shows',
    adminConfirmPromotion: 'Confirm Promotion',
    adminConfirmDemotion: 'Confirm Demotion',
    adminConfirmSuspension: 'Confirm Suspension',
    roadmapLeague19: 'League MD 1–9',
    roadmapLeague19Desc: 'The next matchday opens after the previous one; cups begin after MD9.',
    roadmapDomesticCupsDesc: 'Five domestic cup competitions.',
    roadmapLeague1019: 'League MD 10–19',
    roadmapLeague1019Desc: 'The single round-robin league ends at matchday 19.',
    roadmapEurope: 'UCL / UEL',
    roadmapEuropeDesc: 'European competitions progress in stages after matchday 19.',

    domesticLeagues: 'Domestic Leagues',
    nationalCups: 'National Cups',
    championsLeague: 'Champions League',
    qualificationRules: 'Qualification Rules',
    uefaClubCompetitions: 'UEFA Club Competitions 2026/27',
    uefaSubtitle: 'Clubs qualify through player results and domestic league standings.',
    cupJourney: '2026/27 Cup Journey',
    cupClubs: 'Clubs',
    cupMatches: 'Matches',
    cupChampion: 'Champion',
    adminSectionsHint: 'Swipe sideways for more sections →',
    seasonRoadmap: 'Season Roadmap',
    europeanQualificationHint: 'Clubs qualify through domestic league standings and cup results.',
    noEuropeanParticipants: 'No European participants qualified yet',
    matchesBeingScheduled: 'Matches are being scheduled for qualified clubs...',
    retry: 'Retry',
    knockoutPlayoffs: 'Knockout Play-offs',
    r16Match: 'Round of 16',
    quarterFinal: 'Quarter-finals',
    semiFinal: 'Semi-finals',
    grandFinal: 'Grand Final',
    uefaFinal: 'UEFA Final',
    playoff: 'Play-off',
    writeToOpponent: 'Contact Opponent',
    userNeeded: 'Player needed',
    matchFinished: 'Finished',
    matchInProgress: 'In progress',
    matchTBD: 'Pending / TBD',
    viewOpponentProfile: 'Opponent Profile',
    opponentBadge: 'Opponent',
    profile: 'Profile',
    finalRound: 'Final',
  },
};

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('efootball_lang') as Language;
      if (saved && ['uz', 'ru', 'en'].includes(saved)) {
        return saved;
      }
    }
    return 'uz'; // Default language is Uzbek
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('efootball_lang', lang);
    }
  };

  const t = translations[language];

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
