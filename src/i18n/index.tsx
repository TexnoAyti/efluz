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
