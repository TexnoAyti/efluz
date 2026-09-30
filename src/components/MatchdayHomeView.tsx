import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ChevronRight,
  Clock,
  Lock,
  RefreshCw,
  Swords,
  Trophy,
  CheckCircle2,
  AlertTriangle,
  Send,
  Award,
  Globe2,
  Sparkles,
  Calendar,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { isValidTelegramUsername, openTelegramChat } from '../lib/telegramUtils';
import { ResultSubmissionModal } from './ResultSubmissionModal';

interface Props {
  onNavigateTab: (tab: any) => void;
  onSelectFixtureForMatchCenter?: (fixture: Fixture) => void;
  onOpenSearch?: () => void;
}

const copy = {
  uz: {
    yourClub: 'SIZNING KLUBINGIZ',
    greeting: 'Salom',
    season: '2026/27 mavsumi',
    activeMatchday: 'Tur faol',
    homeTag: 'UYDA',
    awayTag: 'SAFARDA',
    daysLeft: (d: number) => `${d} kundan so‘ng`,
    hoursLeft: (h: number) => `${h} soatdan so‘ng`,
    deadline: 'Muddat',
    matches: 'O‘yinlar',
    upcoming: 'Kelgusi',
    results: 'Natijalar',
    all: 'Hammasi',
    submitResult: 'Hisobni kiritish',
    matchCenter: 'O‘yin markazi',
    chatWithOpponent: 'Raqibga yozish',
    waitingConfirmation: 'Tasdiq kutilmoqda',
    disputeUnderReview: 'Nizo tekshirilmoqda',
    matchdayLocked: 'Tur yopiq',
    readyToPlay: 'O‘yinga tayyor',
    confirmedFT: 'Yakunlangan',
    rankSuffix: '-o‘rin',
    position: 'O‘rin',
    points: 'Ochko',
    played: 'O‘yin',
    form: 'G‘–D–M',
    gd: 'TF',
    noFixture: 'Rejalashtirilgan o‘yin yo‘q',
    noFixtureDesc: 'Klubingiz uchun yangi turlar ochilganda shu yerda ko‘rinadi.',
    browseLeagues: 'Turnir jadvali',
    noResultsYet: 'Yakunlangan o‘yinlar yo‘q',
    noUpcomingYet: 'Boshqa kelgusi o‘yin yo‘q',
    viewAllMatches: 'Barcha o‘yinlarni ko‘rish',
    competitions: 'Turnirlar',
    leagueSnapshot: 'Liga holati',
    domesticLeague: 'Milliy chempionat',
    domesticLeagueSub: 'Turnir jadvali va taqvim',
    domesticCup: 'Milliy kubok',
    domesticCupSub: 'Pley-off bosqichi',
    europeanCup: 'Chempionlar Ligasi',
    europeanCupSub: 'Yevrokuboklar va guruhlar',
    disputeAlert: 'O‘yinda nizo mavjud. Administrator ko‘rib chiqmoqda.',
    pendingAlert: 'Hisob kiritilgan, raqib tasdiqlashi kutilmoqda.',
    readyAlert: 'Navbatdagi tur o‘yini hisobini kiritishingiz mumkin.',
    nextMatch: 'Navbatdagi o‘yin',
    recentResult: 'So‘nggi natija',
    matchday: 'tur',
    retry: 'Qayta urinish',
    error: 'Ma’lumot yuklanmadi',
  },
  ru: {
    yourClub: 'ВАШ КЛУБ',
    greeting: 'Привет',
    season: 'Сезон 2026/27',
    activeMatchday: 'Тур активен',
    homeTag: 'ДОМА',
    awayTag: 'В ГОСТЯХ',
    daysLeft: (d: number) => `через ${d} дн.`,
    hoursLeft: (h: number) => `через ${h} ч.`,
    deadline: 'Срок',
    matches: 'Матчи',
    upcoming: 'Предстоящие',
    results: 'Результаты',
    all: 'Все',
    submitResult: 'Ввести счёт',
    matchCenter: 'Центр матча',
    chatWithOpponent: 'Написать сопернику',
    waitingConfirmation: 'Ожидает подтверждения',
    disputeUnderReview: 'Спорный матч',
    matchdayLocked: 'Тур закрыт',
    readyToPlay: 'Готов к игре',
    confirmedFT: 'Завершён',
    rankSuffix: '-е место',
    position: 'Место',
    points: 'Очки',
    played: 'Матчи',
    form: 'В–Н–П',
    gd: 'РГ',
    noFixture: 'Матч пока не назначен',
    noFixtureDesc: 'Матчи появятся здесь после открытия очередного тура.',
    browseLeagues: 'Таблица лиги',
    noResultsYet: 'Завершенных матчей нет',
    noUpcomingYet: 'Других предстоящих матчей нет',
    viewAllMatches: 'Посмотреть все матчи',
    competitions: 'Турниры',
    leagueSnapshot: 'Положение в лиге',
    domesticLeague: 'Чемпионат',
    domesticLeagueSub: 'Таблица и календарь',
    domesticCup: 'Кубок',
    domesticCupSub: 'Сетка плей-офф',
    europeanCup: 'Лига Чемпионов',
    europeanCupSub: 'Еврокубки',
    disputeAlert: 'Спорный результат на рассмотрении у администратора.',
    pendingAlert: 'Результат отправлен, ожидается подтверждение соперника.',
    readyAlert: 'Доступен ввод счёта очередного тура.',
    nextMatch: 'Следующий матч',
    recentResult: 'Последний результат',
    matchday: 'тур',
    retry: 'Повторить',
    error: 'Ошибка загрузки',
  },
  en: {
    yourClub: 'YOUR CLUB',
    greeting: 'Hello',
    season: 'Season 2026/27',
    activeMatchday: 'Matchday Active',
    homeTag: 'HOME',
    awayTag: 'AWAY',
    daysLeft: (d: number) => `in ${d} days`,
    hoursLeft: (h: number) => `in ${h} hours`,
    deadline: 'Deadline',
    matches: 'Matches',
    upcoming: 'Upcoming',
    results: 'Results',
    all: 'All',
    submitResult: 'Submit Result',
    matchCenter: 'Match Center',
    chatWithOpponent: 'Chat with Opponent',
    waitingConfirmation: 'Awaiting Confirm',
    disputeUnderReview: 'Disputed',
    matchdayLocked: 'Locked',
    readyToPlay: 'Ready to Play',
    confirmedFT: 'Full Time',
    rankSuffix: 'th place',
    position: 'Pos',
    points: 'Pts',
    played: 'Pld',
    form: 'W–D–L',
    gd: 'GD',
    noFixture: 'No Match Scheduled',
    noFixtureDesc: 'Upcoming fixtures will appear here once published.',
    browseLeagues: 'View Table',
    noResultsYet: 'No completed matches yet',
    noUpcomingYet: 'No other upcoming fixtures',
    viewAllMatches: 'View all matches',
    competitions: 'Competitions',
    leagueSnapshot: 'League Snapshot',
    domesticLeague: 'Domestic League',
    domesticLeagueSub: 'Table & Fixtures',
    domesticCup: 'Domestic Cup',
    domesticCupSub: 'Knockout Bracket',
    europeanCup: 'Champions League',
    europeanCupSub: 'UEFA Competition',
    disputeAlert: 'Match is disputed and under review.',
    pendingAlert: 'Result submitted and awaiting opponent confirmation.',
    readyAlert: 'Match is active and ready for result submission.',
    nextMatch: 'Next Match',
    recentResult: 'Latest Result',
    matchday: 'MD',
    retry: 'Retry',
    error: 'Could not load data',
  },
};

function getClubDisplay(fixture: Fixture, side: 'home' | 'away') {
  const club = side === 'home' ? fixture.homeClub : fixture.awayClub;
  return {
    id: side === 'home' ? fixture.homeClubId : fixture.awayClubId,
    name: club?.shortName || club?.name || (side === 'home' ? fixture.homeClubId : fixture.awayClubId) || 'TBD',
    fullName: club?.name || '',
    logoUrl: club?.logoUrl,
    stadium: club?.stadium || (side === 'home' ? 'Home Ground' : ''),
  };
}

export const MatchdayHomeView: React.FC<Props> = ({
  onNavigateTab,
  onSelectFixtureForMatchCenter,
}) => {
  const { user, currentClub, ownedClubs, activeSeasonId, userStats } = useAuth();
  const { language } = useI18n();
  const resultText = {
    uz: { win: 'G‘alaba', draw: 'Durang', loss: 'Mag‘lubiyat', winShort: 'G‘', drawShort: 'D', lossShort: 'M' },
    ru: { win: 'Победа', draw: 'Ничья', loss: 'Поражение', winShort: 'В', drawShort: 'Н', lossShort: 'П' },
    en: { win: 'Win', draw: 'Draw', loss: 'Loss', winShort: 'W', drawShort: 'D', lossShort: 'L' },
  }[language];

  const c = copy[language] || copy.uz;

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [matchTab, setMatchTab] = useState<'upcoming' | 'results'>('upcoming');
  const [selectedFixtureForSubmit, setSelectedFixtureForSubmit] = useState<Fixture | null>(null);

  const activeClub = currentClub || ownedClubs[0] || null;

  const loadData = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.getMyMatches(activeSeasonId);
      setFixtures(res.fixtures || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [activeSeasonId, user?.id, activeClub?.id]);

  // Fixtures partition
  const pendingFixtures = useMemo(
    () => fixtures.filter((f) => f.status !== 'CONFIRMED' && f.status !== 'CANCELLED'),
    [fixtures]
  );

  const confirmedFixtures = useMemo(
    () => [...fixtures].filter((f) => f.status === 'CONFIRMED').reverse(),
    [fixtures]
  );

  // Hero match selection
  const heroMatch = useMemo(() => {
    const actionRequired = pendingFixtures.find(
      (f) => f.status === 'PENDING_CONFIRMATION' || f.status === 'DISPUTED'
    );
    if (actionRequired) return actionRequired;

    const nextPlayable = pendingFixtures.find(
      (f) => f.isPlayable !== false && f.status === 'SCHEDULED'
    );
    if (nextPlayable) return nextPlayable;

    if (pendingFixtures.length > 0) return pendingFixtures[0];
    if (confirmedFixtures.length > 0) return confirmedFixtures[0];
    return null;
  }, [pendingFixtures, confirmedFixtures]);

  const otherUpcoming = useMemo(
    () => pendingFixtures.filter((f) => f.id !== heroMatch?.id).slice(0, 4),
    [pendingFixtures, heroMatch]
  );

  const otherResults = useMemo(
    () => confirmedFixtures.filter((f) => f.id !== heroMatch?.id).slice(0, 4),
    [confirmedFixtures, heroMatch]
  );

  const displayedList = matchTab === 'upcoming' ? otherUpcoming : otherResults;

  const handleOpenMatch = (fixture: Fixture) => {
    if (onSelectFixtureForMatchCenter) {
      onSelectFixtureForMatchCenter(fixture);
    }
    onNavigateTab('my-club');
  };

  const handleOpenSubmit = (fixture: Fixture) => {
    setSelectedFixtureForSubmit(fixture);
  };

  const isUserHome = heroMatch ? heroMatch.homeOwnerId === user?.id || heroMatch.homeClubId === activeClub?.id : true;

  // Format date and time
  const formatFixtureSchedule = (fixture: Fixture) => {
    if (!fixture.scheduledAt) {
      return {
        dateStr: fixture.roundName || `${fixture.matchday}-${c.matchday}`,
        timeStr: '21:00',
        relativeTime: null,
      };
    }
    const d = new Date(fixture.scheduledAt);
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 2026) {
      return {
        dateStr: fixture.roundName || `${fixture.matchday}-${c.matchday}`,
        timeStr: '21:00',
        relativeTime: null,
      };
    }

    const dayName = new Intl.DateTimeFormat(language === 'uz' ? 'uz-UZ' : language === 'ru' ? 'ru-RU' : 'en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(d).toUpperCase();

    const time = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);

    const diffDays = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    let relative = null;
    if (diffDays > 0) {
      relative = c.daysLeft(diffDays);
    } else if (diffDays === 0) {
      const diffHours = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60));
      relative = diffHours > 0 ? c.hoursLeft(diffHours) : null;
    }

    return {
      dateStr: dayName,
      timeStr: time,
      relativeTime: relative,
    };
  };

  const scheduleInfo = heroMatch ? formatFixtureSchedule(heroMatch) : null;
  const homeTeam = heroMatch ? getClubDisplay(heroMatch, 'home') : null;
  const awayTeam = heroMatch ? getClubDisplay(heroMatch, 'away') : null;
  const isFinished = heroMatch?.status === 'CONFIRMED';

  // Determine opponent Telegram username
  const opponentTelegram = useMemo(() => {
    if (!heroMatch) return null;
    const isHome = heroMatch.homeOwnerId === user?.id || heroMatch.homeClubId === activeClub?.id;
    const oppTg = isHome
      ? heroMatch.awayOwner?.username || heroMatch.awayUser?.username || heroMatch.awayClub?.claimedByUsername
      : heroMatch.homeOwner?.username || heroMatch.homeUser?.username || heroMatch.homeClub?.claimedByUsername;
    return isValidTelegramUsername(oppTg) ? oppTg : null;
  }, [heroMatch, user?.id, activeClub?.id]);

  // Operational strip for dispute or pending confirmation
  const actionBanner = useMemo(() => {
    if (!heroMatch) return null;
    if (heroMatch.status === 'DISPUTED') {
      return {
        icon: AlertTriangle,
        bg: 'bg-rose-500/10 border-rose-500/30 text-rose-700 efl-theme-rose dark:text-rose-400',
        btnBg: 'bg-rose-600 hover:bg-rose-500 text-white',
        text: c.disputeAlert,
        actionLabel: c.matchCenter,
        onClick: () => handleOpenMatch(heroMatch),
      };
    }
    if (heroMatch.status === 'PENDING_CONFIRMATION') {
      return {
        icon: Clock,
        bg: 'bg-amber-500/10 border-amber-500/30 text-amber-700 efl-theme-amber dark:text-amber-400',
        btnBg: 'bg-amber-600 hover:bg-amber-500 text-white',
        text: c.pendingAlert,
        actionLabel: c.matchCenter,
        onClick: () => handleOpenMatch(heroMatch),
      };
    }
    return null;
  }, [heroMatch, c]);

  // Goal difference
  const goalDiff = userStats ? (userStats.goalsScored || 0) - (userStats.goalsConceded || 0) : 0;
  const goalDiffDisplay = goalDiff > 0 ? `+${goalDiff}` : `${goalDiff}`;

  return (
    <div className="space-y-4 pb-20 animate-in fade-in duration-200">
      {/* 1. TOP BAR: "SIZNING KLUBINGIZ" style from reference video */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-[var(--efl-text-2)]">
            <span>{c.yourClub}</span>
            <span>•</span>
            <span className="text-[var(--efl-primary)] truncate">
              {activeClub?.leagueId
                ? activeClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase()
                : 'PREMIER LEAGUE'}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[var(--efl-text)] tracking-tight mt-0.5 truncate">
            {c.greeting}, {user?.firstName || user?.username || 'Player'}
          </h1>
        </div>

        {/* Active Club Crest & Switcher Link */}
        {activeClub && (
          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[var(--efl-surface)] border border-[var(--efl-border)] shadow-xs hover:border-[var(--efl-primary)] transition-all shrink-0 max-w-[170px]"
            title="Active Club Hub"
          >
            <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0">
              <ClubCrest
                clubId={activeClub.id}
                logoUrl={activeClub.logoUrl}
                name={activeClub.name}
                shortName={activeClub.shortName}
                size="xs"
              />
            </div>
            <span className="text-xs font-black text-[var(--efl-text)] truncate">
              {activeClub.shortName || activeClub.name}
            </span>
          </button>
        )}
      </div>

      {/* Network / Error banner */}
      {error && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 efl-theme-rose-soft dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 text-rose-700 efl-theme-rose dark:text-rose-400 text-xs font-semibold">
          <span>{c.error}</span>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1 font-bold text-[var(--efl-primary)]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {c.retry}
          </button>
        </div>
      )}

      {/* 2. OPERATIONAL ACTION REQUIRED STRIP (If dispute or pending confirmation) */}
      {actionBanner && (
        <div className={`flex items-center justify-between gap-2.5 p-2.5 sm:p-3 rounded-2xl border ${actionBanner.bg} transition-all`}>
          <div className="flex items-center gap-2 min-w-0">
            <actionBanner.icon className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold truncate leading-tight">
              {actionBanner.text}
            </span>
          </div>
          <button
            type="button"
            onClick={actionBanner.onClick}
            className={`px-3 py-1 rounded-xl text-[11px] font-black shrink-0 shadow-xs active:scale-95 transition-all ${actionBanner.btnBg}`}
          >
            {actionBanner.actionLabel}
          </button>
        </div>
      )}

      {/* 3. HERO MAIN MATCH CARD (Adapted from reference video with participant actions) */}
      <section aria-label={c.nextMatch}>
        {loading && fixtures.length === 0 ? (
          <div className="p-6 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] shadow-xs animate-pulse space-y-4">
            <div className="h-4 w-32 bg-[var(--efl-surface-2)] rounded-full mx-auto" />
            <div className="h-16 w-3/4 bg-[var(--efl-surface-2)] rounded-xl mx-auto" />
            <div className="h-9 w-40 bg-[var(--efl-surface-2)] rounded-xl mx-auto" />
          </div>
        ) : heroMatch && homeTeam && awayTeam ? (
          <div className="p-4 sm:p-5 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] shadow-xs relative overflow-hidden">
            {/* Top Bar inside Card matching reference video: Matchday Tag on Left, Countdown on Right */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 efl-theme-rose dark:text-rose-400 border border-rose-500/20">
                {heroMatch.roundName || `${heroMatch.matchday}-${c.matchday}`} • {isUserHome ? c.homeTag : c.awayTag}
              </span>

              {scheduleInfo?.relativeTime && !isFinished ? (
                <span className="text-[11px] font-bold text-[var(--efl-text-2)] flex items-center gap-1">
                  <Clock className="w-3 h-3 text-[var(--efl-muted)] efl-theme-meta" />
                  <span>{scheduleInfo.relativeTime}</span>
                </span>
              ) : (
                <span className="text-[11px] font-medium text-[var(--efl-text-2)] truncate">
                  {heroMatch.competitionName || 'EFL UZ'}
                </span>
              )}
            </div>

            {/* Broadcast Layout: Home Team | Center Date+Time | Away Team */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 my-2 text-center">
              {/* Home Team */}
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] p-2 flex items-center justify-center shadow-xs">
                  <ClubCrest
                    clubId={homeTeam.id}
                    logoUrl={homeTeam.logoUrl}
                    name={homeTeam.fullName}
                    shortName={homeTeam.name}
                    size="xl"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="w-full px-1">
                  <span className="block text-sm sm:text-base font-bold text-[var(--efl-text)] truncate">
                    {homeTeam.name}
                  </span>
                  <div className="flex items-center justify-center gap-1 mt-0.5">
                    <span className="text-[10px] font-medium text-[var(--efl-text-2)]">
                      {isUserHome && userStats?.leaguePosition ? `${userStats.leaguePosition}${c.rankSuffix}` : c.homeTag}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center Date + Time / Score Display (from reference video) */}
              <div className="flex flex-col items-center justify-center px-1 sm:px-3 min-w-[95px] sm:min-w-[125px]">
                {isFinished ? (
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-bold text-emerald-600 efl-theme-emerald dark:text-emerald-400 uppercase tracking-wider mb-0.5">
                      {c.confirmedFT}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-3xl sm:text-4xl font-black text-[var(--efl-text)] tabular-nums tracking-tight">
                        {heroMatch.homeScore}
                      </span>
                      <span className="text-lg font-bold text-[var(--efl-muted)] efl-theme-meta">—</span>
                      <span className="text-3xl sm:text-4xl font-black text-[var(--efl-text)] tabular-nums tracking-tight">
                        {heroMatch.awayScore}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] font-bold text-[var(--efl-text-2)] uppercase tracking-wider">
                      {scheduleInfo?.dateStr}
                    </span>
                    <span className="text-2xl sm:text-3xl font-black text-[var(--efl-text)] tabular-nums tracking-tight my-0.5">
                      {scheduleInfo?.timeStr}
                    </span>
                    <span className="text-[10px] text-[var(--efl-muted)] efl-theme-meta truncate max-w-[100px]">
                      {homeTeam.stadium || 'Camp Nou'}
                    </span>
                  </div>
                )}
              </div>

              {/* Away Team */}
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] p-2 flex items-center justify-center shadow-xs">
                  <ClubCrest
                    clubId={awayTeam.id}
                    logoUrl={awayTeam.logoUrl}
                    name={awayTeam.fullName}
                    shortName={awayTeam.name}
                    size="xl"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="w-full px-1">
                  <span className="block text-sm sm:text-base font-bold text-[var(--efl-text)] truncate">
                    {awayTeam.name}
                  </span>
                  <div className="flex items-center justify-center gap-1 mt-0.5">
                    <span className="text-[10px] font-medium text-[var(--efl-text-2)]">
                      {!isUserHome && userStats?.leaguePosition ? `${userStats.leaguePosition}${c.rankSuffix}` : c.awayTag}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Context status caption matching reference video */}
            <div className="text-center mt-2.5 mb-3 text-[11px] text-[var(--efl-text-2)] font-medium">
              {heroMatch.status === 'SCHEDULED' && heroMatch.isPlayable !== false ? (
                <span className="text-[var(--efl-primary)] font-bold">
                  ● {c.readyAlert}
                </span>
              ) : isFinished ? (
                <span>
                  {activeClub?.shortName || activeClub?.name} {userStats?.points || 0} ochko bilan turnir jadvalida
                </span>
              ) : (
                <span>
                  {heroMatch.competitionName} • {heroMatch.roundName || `${heroMatch.matchday}-${c.matchday}`}
                </span>
              )}
            </div>

            {/* Participant Action Footer: Submit Result & Opponent Chat */}
            <div className="pt-3 border-t border-[var(--efl-border)] flex flex-col sm:flex-row items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--efl-text-2)] truncate self-start sm:self-center">
                {isFinished ? c.recentResult : c.nextMatch}
              </span>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {/* 1-tap Telegram opponent chat */}
                {opponentTelegram && !isFinished && (
                  <button
                    type="button"
                    onClick={() => openTelegramChat(opponentTelegram)}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 text-sky-700 efl-theme-sky dark:text-sky-400 font-bold text-xs transition-colors min-h-[38px]"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{c.chatWithOpponent}</span>
                  </button>
                )}

                {/* Primary CTA button */}
                <button
                  type="button"
                  onClick={() => {
                    if (heroMatch.status === 'SCHEDULED' && heroMatch.isPlayable !== false) {
                      handleOpenSubmit(heroMatch);
                    } else {
                      handleOpenMatch(heroMatch);
                    }
                  }}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl btn-glass-primary text-xs shadow-xs active:scale-95 transition-all min-h-[38px]"
                >
                  <span>
                    {heroMatch.status === 'SCHEDULED' && heroMatch.isPlayable !== false
                      ? c.submitResult
                      : c.matchCenter}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] text-center shadow-xs space-y-3">
            <div className="w-11 h-11 mx-auto rounded-xl bg-[var(--efl-primary-soft)] border border-[var(--efl-border)] flex items-center justify-center text-[var(--efl-primary)]">
              <Swords className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-[var(--efl-text)]">
              {c.noFixture}
            </h3>
            <p className="text-xs text-[var(--efl-text-2)] max-w-sm mx-auto">
              {c.noFixtureDesc}
            </p>
            <button
              type="button"
              onClick={() => onNavigateTab('leagues')}
              className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-xl btn-glass-primary text-xs shadow-xs"
            >
              <span>{c.browseLeagues}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* 4. MATCHES LIST ("O'YINLAR" SECTION FROM REFERENCE VIDEO) */}
      <section className="rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] shadow-xs overflow-hidden">
        {/* Header with Title and Segmented Tabs */}
        <div className="flex items-center justify-between p-3 sm:p-3.5 border-b border-[var(--efl-border)]">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-[var(--efl-text)]">
              {c.matches}
            </h3>
          </div>

          <div className="flex items-center gap-1 p-0.5 rounded-xl bg-[var(--efl-surface-2)]">
            <button
              type="button"
              onClick={() => setMatchTab('upcoming')}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                matchTab === 'upcoming'
                  ? 'bg-[var(--efl-surface)] text-[var(--efl-text)] shadow-xs font-black'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
              }`}
            >
              {c.upcoming}
            </button>
            <button
              type="button"
              onClick={() => setMatchTab('results')}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                matchTab === 'results'
                  ? 'bg-[var(--efl-surface)] text-[var(--efl-text)] shadow-xs font-black'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
              }`}
            >
              {c.results}
            </button>
          </div>
        </div>

        {/* Competition Sub-Header matching reference video: Icon + Title + Count link */}
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--efl-surface-2)] border-b border-[var(--efl-border)]">
          <div className="flex items-center gap-2 min-w-0">
            <Trophy className="w-3.5 h-3.5 text-[var(--efl-primary)] shrink-0" />
            <span className="text-xs font-bold text-[var(--efl-text)] truncate">
              {activeClub?.leagueId
                ? activeClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase()
                : 'PREMIER LEAGUE'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="text-[11px] font-semibold text-[var(--efl-text-2)] hover:text-[var(--efl-primary)] flex items-center gap-0.5"
          >
            <span>{displayedList.length} ta o‘yin</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {/* Match Rows matching reference video structure */}
        <div className="divide-y divide-[var(--efl-border)]">
          {displayedList.length > 0 ? (
            displayedList.map((fixture) => {
              const home = getClubDisplay(fixture, 'home');
              const away = getClubDisplay(fixture, 'away');
              const isMatchFinished = fixture.status === 'CONFIRMED';
              const isClubHome = !!activeClub && home.id === activeClub.id;
              const isClubAway = !!activeClub && away.id === activeClub.id;
              const resultOutcome = isMatchFinished && (isClubHome || isClubAway)
                && typeof fixture.homeScore === 'number' && typeof fixture.awayScore === 'number'
                ? fixture.homeScore === fixture.awayScore ? 'draw'
                  : (isClubHome ? fixture.homeScore > fixture.awayScore : fixture.awayScore > fixture.homeScore) ? 'win' : 'loss'
                : null;
              const sched = formatFixtureSchedule(fixture);

              return (
                <button
                  key={fixture.id}
                  type="button"
                  onClick={() => handleOpenMatch(fixture)}
                  className="w-full grid grid-cols-[1fr_auto_1fr] items-center p-3 px-4 hover:bg-[var(--efl-surface-2)] transition-colors text-left"
                >
                  {/* Home Team (Right aligned towards center) */}
                  <div className="flex items-center justify-end gap-2.5 min-w-0 pr-2">
                    <span className="text-xs font-bold text-[var(--efl-text)] truncate text-right">
                      {home.name}
                    </span>
                    <div className="w-6 h-6 rounded-md bg-[var(--efl-surface-2)] border border-[var(--efl-border)] p-0.5 flex items-center justify-center shrink-0">
                      <ClubCrest
                        clubId={home.id}
                        logoUrl={home.logoUrl}
                        name={home.name}
                        size="xs"
                      />
                    </div>
                  </div>

                  {/* Center Time / Score + Status underneath (matching reference video) */}
                  <div className="flex flex-col items-center justify-center min-w-[70px] sm:min-w-[85px] px-1">
                    {isMatchFinished ? (
                      <>
                        <span className={`font-mono text-xs sm:text-sm font-black text-[var(--efl-text)] tabular-nums tracking-tight ${resultOutcome ? `efl-result-${resultOutcome}` : ''}`}>
                          {fixture.homeScore} : {fixture.awayScore}
                        </span>
                        <span className={`text-[9px] font-bold uppercase tracking-wider mt-0.5 ${resultOutcome ? `efl-result-${resultOutcome}` : 'text-[var(--efl-text-2)]'}`}>
                          {resultOutcome ? resultText[resultOutcome] : ({ uz: 'Yakunlangan', ru: 'Завершён', en: 'Finished' }[language])}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-xs sm:text-sm font-black text-[var(--efl-text)] tabular-nums tracking-tight">
                          {sched.timeStr}
                        </span>
                        <span className="text-[9px] font-medium text-[var(--efl-text-2)] uppercase tracking-wider mt-0.5">
                          {fixture.status === 'PENDING_CONFIRMATION'
                            ? 'TASDIQ'
                            : fixture.status === 'DISPUTED'
                            ? 'NIZO'
                            : 'BOSHLANISH'}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Away Team (Left aligned from center) */}
                  <div className="flex items-center justify-start gap-2.5 min-w-0 pl-2">
                    <div className="w-6 h-6 rounded-md bg-[var(--efl-surface-2)] border border-[var(--efl-border)] p-0.5 flex items-center justify-center shrink-0">
                      <ClubCrest
                        clubId={away.id}
                        logoUrl={away.logoUrl}
                        name={away.name}
                        size="xs"
                      />
                    </div>
                    <span className="text-xs font-bold text-[var(--efl-text)] truncate text-left">
                      {away.name}
                    </span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="p-6 text-center text-xs text-[var(--efl-muted)] efl-theme-meta">
              {matchTab === 'upcoming' ? c.noUpcomingYet : c.noResultsYet}
            </div>
          )}
        </div>

        {/* View all matches footer link */}
        <div className="p-2.5 text-center bg-[var(--efl-surface-2)] border-t border-[var(--efl-border)]">
          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="text-xs font-bold text-[var(--efl-primary)] hover:underline inline-flex items-center gap-1"
          >
            <span>{c.viewAllMatches}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* 5. LEAGUE SNAPSHOT: UNIFIED HORIZONTAL SUMMARY STRIP */}
      <section className="p-3.5 sm:p-4 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] shadow-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500 efl-theme-amber shrink-0" />
            <h3 className="text-xs font-black uppercase tracking-wider text-[var(--efl-text)]">
              {c.leagueSnapshot}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="text-xs font-semibold text-[var(--efl-primary)] hover:underline inline-flex items-center gap-1"
          >
            <span>{c.browseLeagues}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-5 divide-x divide-[var(--efl-border)] rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] py-2 text-center">
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-[var(--efl-text-2)]">
              {c.position}
            </span>
            <strong className="text-sm sm:text-base font-black text-amber-600 efl-theme-amber dark:text-amber-400 tabular-nums">
              {userStats?.leaguePosition ? `#${userStats.leaguePosition}` : '—'}
            </strong>
          </div>
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-[var(--efl-text-2)]">
              {c.points}
            </span>
            <strong className="text-sm sm:text-base font-black text-[var(--efl-primary)] tabular-nums">
              {userStats?.points ?? '0'}
            </strong>
          </div>
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-[var(--efl-text-2)]">
              {c.played}
            </span>
            <strong className="text-sm sm:text-base font-black text-[var(--efl-text)] tabular-nums">
              {userStats?.matchesPlayed ?? '0'}
            </strong>
          </div>
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-[var(--efl-text-2)]">
              {c.form}
            </span>
            <strong className="text-xs sm:text-sm font-black text-[var(--efl-text-2)] tabular-nums">
              <span className="efl-result-win" title={resultText.win}>{userStats?.wins ?? 0}</span>–<span className="efl-result-draw" title={resultText.draw}>{userStats?.draws ?? 0}</span>–<span className="efl-result-loss" title={resultText.loss}>{userStats?.losses ?? 0}</span>
            </strong>
          </div>
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-[var(--efl-text-2)]">
              {c.gd}
            </span>
            <strong className="text-xs sm:text-sm font-black text-[var(--efl-text)] tabular-nums">
              {goalDiffDisplay}
            </strong>
          </div>
        </div>
      </section>

      {/* 6. COMPETITION ACCESS SHORTCUTS */}
      <section className="p-3.5 sm:p-4 rounded-2xl bg-[var(--efl-surface)] border border-[var(--efl-border)] shadow-xs space-y-2">
        <div className="flex items-center justify-between mb-0.5">
          <h3 className="text-xs font-black uppercase tracking-wider text-[var(--efl-text)]">
            {c.competitions}
          </h3>
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="text-xs font-semibold text-[var(--efl-primary)] hover:underline"
          >
            Hammasi
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Domestic League */}
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] hover:border-[var(--efl-primary)] transition-all text-left group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 efl-theme-amber dark:text-amber-400 flex items-center justify-center shrink-0">
                <Trophy className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-bold text-[var(--efl-text)] truncate">
                  {c.domesticLeague}
                </span>
                <span className="block text-[10px] text-[var(--efl-text-2)] truncate">
                  {c.domesticLeagueSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[var(--efl-muted)] efl-theme-meta group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* Domestic Cup */}
          <button
            type="button"
            onClick={() => onNavigateTab('cups')}
            className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] hover:border-[var(--efl-primary)] transition-all text-left group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 efl-theme-indigo dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Award className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-bold text-[var(--efl-text)] truncate">
                  {c.domesticCup}
                </span>
                <span className="block text-[10px] text-[var(--efl-text-2)] truncate">
                  {c.domesticCupSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[var(--efl-muted)] efl-theme-meta group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* European Tournaments */}
          <button
            type="button"
            onClick={() => onNavigateTab('champions-league')}
            className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] hover:border-[var(--efl-primary)] transition-all text-left group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-600 efl-theme-sky dark:text-sky-400 flex items-center justify-center shrink-0">
                <Globe2 className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-bold text-[var(--efl-text)] truncate">
                  {c.europeanCup}
                </span>
                <span className="block text-[10px] text-[var(--efl-text-2)] truncate">
                  {c.europeanCupSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[var(--efl-muted)] efl-theme-meta group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        </div>
      </section>

      {/* Result Submission Modal */}
      {selectedFixtureForSubmit && (
        <ResultSubmissionModal
          fixture={selectedFixtureForSubmit}
          isOpen={true}
          onClose={() => setSelectedFixtureForSubmit(null)}
          onSuccess={() => {
            setSelectedFixtureForSubmit(null);
            void loadData();
          }}
        />
      )}
    </div>
  );
};

