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
  Layers,
  Sparkles,
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
    broadcast: 'EFL UZ MATCH CENTRE',
    greeting: 'Salom',
    season: '2026/27 mavsumi',
    activeMatchday: 'Tur davom etmoqda',
    nextMatch: 'ASOSIY O‘YIN',
    recentResult: 'SO‘NGGI NATIJA',
    submitResult: 'Hisobni kiritish',
    matchCenter: 'O‘yin markazi',
    chatWithOpponent: 'Raqibga yozish',
    locked: 'Tur ochilmagan',
    pending: 'Tasdiq kutilmoqda',
    disputed: 'Nizo mavjud',
    ready: 'O‘yinga tayyor',
    confirmed: 'Tasdiqlangan',
    matchday: 'tur',
    position: 'O‘rin',
    points: 'Ochko',
    played: 'O‘yin',
    form: 'G‘–D–M',
    gd: 'TF',
    noFixture: 'Hozircha rejalashtirilgan o‘yin yo‘q',
    noFixtureDesc: 'Klubingiz uchun yangi turlar ochilganda shu yerda paydo bo‘ladi.',
    browseLeagues: 'Turnirlar jadvalini ko‘rish',
    upcoming: 'Kelgusi o‘yinlar',
    results: 'Natijalar',
    noResultsYet: 'Hali yakunlangan o‘yinlar yo‘q',
    noUpcomingYet: 'Boshqa kelgusi o‘yin yo‘q',
    viewAll: 'Barchasi',
    competitionHub: 'Turnirlar',
    leagueSnapshot: 'Liga holati',
    domesticLeague: 'Milliy chempionat',
    domesticLeagueSub: 'Turnir jadvali va taqvim',
    domesticCup: 'Milliy kubok',
    domesticCupSub: 'Pley-off va saralash bosqichi',
    europeanCup: 'UEFA Chempionlar Ligasi',
    europeanCupSub: 'Yevrokuboklar va guruhlar',
    actionRequired: 'DIQQAT TALAB ETILADI',
    disputeAlert: 'Nizo tekshirilmoqda. Tez orada admin qarori chiqariladi.',
    pendingAlert: 'O‘yin hisobi yuborilgan, raqib tasdig‘i kutilmoqda.',
    readyAlert: 'Navbatdagi o‘yin hisobini kiritish imkoniyati mavjud.',
    retry: 'Qayta urinish',
    error: 'Ma’lumot yuklanmadi',
  },
  ru: {
    broadcast: 'EFL UZ MATCH CENTRE',
    greeting: 'Привет',
    season: 'Сезон 2026/27',
    activeMatchday: 'Тур активен',
    nextMatch: 'ГЛАВНЫЙ МАТЧ',
    recentResult: 'ПОСЛЕДНИЙ РЕЗУЛЬТАТ',
    submitResult: 'Ввести счёт',
    matchCenter: 'Центр матча',
    chatWithOpponent: 'Написать сопернику',
    locked: 'Тур закрыт',
    pending: 'Ожидает подтверждения',
    disputed: 'Спорный матч',
    ready: 'Готов к игре',
    confirmed: 'Подтверждён',
    matchday: 'тур',
    position: 'Место',
    points: 'Очки',
    played: 'Матчи',
    form: 'В–Н–П',
    gd: 'РГ',
    noFixture: 'Матч пока не назначен',
    noFixtureDesc: 'Матчи появятся здесь после открытия очередного тура.',
    browseLeagues: 'Открыть лиги и расписание',
    upcoming: 'Предстоящие',
    results: 'Результаты',
    noResultsYet: 'Завершенных матчей пока нет',
    noUpcomingYet: 'Других предстоящих матчей нет',
    viewAll: 'Все матчи',
    competitionHub: 'Турниры',
    leagueSnapshot: 'Положение в лиге',
    domesticLeague: 'Чемпионат лиги',
    domesticLeagueSub: 'Таблица и календарь',
    domesticCup: 'Национальный кубок',
    domesticCupSub: 'Сетка плей-офф',
    europeanCup: 'Лига Чемпионов UEFA',
    europeanCupSub: 'Еврокубки и стадии',
    actionRequired: 'ТРЕБУЕТ ВНИМАНИЯ',
    disputeAlert: 'Спорный результат на рассмотрении у администратора.',
    pendingAlert: 'Результат отправлен, ожидается подтверждение соперника.',
    readyAlert: 'Доступен ввод результата очередного тура.',
    retry: 'Повторить',
    error: 'Ошибка загрузки',
  },
  en: {
    broadcast: 'EFL UZ MATCH CENTRE',
    greeting: 'Hello',
    season: 'Season 2026/27',
    activeMatchday: 'Matchday Active',
    nextMatch: 'HERO MATCH',
    recentResult: 'LATEST RESULT',
    submitResult: 'Submit Result',
    matchCenter: 'Match Center',
    chatWithOpponent: 'Chat with Opponent',
    locked: 'Matchday Locked',
    pending: 'Awaiting Confirm',
    disputed: 'Disputed',
    ready: 'Ready to Play',
    confirmed: 'Confirmed',
    matchday: 'Round',
    position: 'Pos',
    points: 'Pts',
    played: 'Played',
    form: 'W–D–L',
    gd: 'GD',
    noFixture: 'No Match Scheduled Yet',
    noFixtureDesc: 'Upcoming fixtures will appear here once published by the league.',
    browseLeagues: 'Browse Competitions',
    upcoming: 'Upcoming',
    results: 'Results',
    noResultsYet: 'No completed matches yet',
    noUpcomingYet: 'No other upcoming matches',
    viewAll: 'View All',
    competitionHub: 'Competitions',
    leagueSnapshot: 'League Snapshot',
    domesticLeague: 'Domestic League',
    domesticLeagueSub: 'Standings & Fixtures',
    domesticCup: 'Domestic Cup',
    domesticCupSub: 'Knockout Bracket',
    europeanCup: 'UEFA Champions League',
    europeanCupSub: 'European Tournament',
    actionRequired: 'ACTION REQUIRED',
    disputeAlert: 'Match is disputed and currently under administrator review.',
    pendingAlert: 'Result submitted and awaiting opponent confirmation.',
    readyAlert: 'Match is active and ready for result submission.',
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
  };
}

export const MatchdayHomeView: React.FC<Props> = ({
  onNavigateTab,
  onSelectFixtureForMatchCenter,
}) => {
  const { user, currentClub, ownedClubs, activeSeasonId, userStats } = useAuth();
  const { language } = useI18n();
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

  const formatFixtureDate = (fixture: Fixture) => {
    if (!fixture.scheduledAt) {
      return fixture.roundName || `${c.matchday} ${fixture.matchday}`;
    }
    const d = new Date(fixture.scheduledAt);
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 2026) {
      return fixture.roundName || `${c.matchday} ${fixture.matchday}`;
    }
    return new Intl.DateTimeFormat(language === 'uz' ? 'uz-UZ' : language === 'ru' ? 'ru-RU' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  };

  const homeTeam = heroMatch ? getClubDisplay(heroMatch, 'home') : null;
  const awayTeam = heroMatch ? getClubDisplay(heroMatch, 'away') : null;
  const isFinished = heroMatch?.status === 'CONFIRMED';

  // Determine opponent Telegram username for direct chat
  const opponentTelegram = useMemo(() => {
    if (!heroMatch) return null;
    const isHome = heroMatch.homeOwnerId === user?.id || heroMatch.homeClubId === activeClub?.id;
    const oppTg = isHome
      ? heroMatch.awayOwner?.username || heroMatch.awayUser?.username || heroMatch.awayClub?.claimedByUsername
      : heroMatch.homeOwner?.username || heroMatch.homeUser?.username || heroMatch.homeClub?.claimedByUsername;
    return isValidTelegramUsername(oppTg) ? oppTg : null;
  }, [heroMatch, user?.id, activeClub?.id]);

  // Action required banner helper
  const actionBanner = useMemo(() => {
    if (!heroMatch) return null;
    if (heroMatch.status === 'DISPUTED') {
      return {
        type: 'dispute',
        icon: AlertTriangle,
        bg: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400',
        text: c.disputeAlert,
        actionLabel: c.matchCenter,
        onClick: () => handleOpenMatch(heroMatch),
      };
    }
    if (heroMatch.status === 'PENDING_CONFIRMATION') {
      return {
        type: 'pending',
        icon: Clock,
        bg: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
        text: c.pendingAlert,
        actionLabel: c.matchCenter,
        onClick: () => handleOpenMatch(heroMatch),
      };
    }
    if (heroMatch.status === 'SCHEDULED' && heroMatch.isPlayable !== false) {
      return {
        type: 'ready',
        icon: Sparkles,
        bg: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400',
        text: c.readyAlert,
        actionLabel: c.submitResult,
        onClick: () => handleOpenSubmit(heroMatch),
      };
    }
    return null;
  }, [heroMatch, c]);

  // Calculate goal difference
  const goalDiff = userStats ? (userStats.goalsScored || 0) - (userStats.goalsConceded || 0) : 0;
  const goalDiffDisplay = goalDiff > 0 ? `+${goalDiff}` : `${goalDiff}`;

  return (
    <div className="space-y-3.5 sm:space-y-4 pb-20 animate-in fade-in duration-200">
      {/* 1. TOP CONTEXT: Greeting + Active Club Context + Season pill */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            <span className="uppercase tracking-wider text-[#1e3a8a] dark:text-[#3b82f6] font-black">
              {c.broadcast}
            </span>
            <span>•</span>
            <span className="truncate">{c.season}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 truncate">
            {c.greeting}, {user?.firstName || user?.username || 'Coach'}
          </h1>
        </div>

        {/* Active Club Mini Identity Badge */}
        {activeClub && (
          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-sm hover:border-[#2563eb] transition-all shrink-0 max-w-[170px]"
            title="Open Club Hub"
          >
            <div className="w-5 h-5 rounded-lg flex items-center justify-center shrink-0">
              <ClubCrest
                clubId={activeClub.id}
                logoUrl={activeClub.logoUrl}
                name={activeClub.name}
                shortName={activeClub.shortName}
                size="xs"
              />
            </div>
            <span className="text-xs font-black text-slate-900 dark:text-white truncate">
              {activeClub.shortName || activeClub.name}
            </span>
          </button>
        )}
      </div>

      {/* Error state with retry */}
      {error && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-300 dark:border-rose-900/40 text-rose-700 dark:text-rose-400 text-xs font-semibold">
          <span>{c.error}</span>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1 font-bold text-[#2563eb] dark:text-[#3b82f6]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {c.retry}
          </button>
        </div>
      )}

      {/* 2. ACTION REQUIRED STRIP (Compact operational banner) */}
      {actionBanner && (
        <div className={`flex items-center justify-between gap-2.5 p-3 rounded-2xl border ${actionBanner.bg} transition-all`}>
          <div className="flex items-center gap-2 min-w-0">
            <actionBanner.icon className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold truncate leading-tight">
              {actionBanner.text}
            </span>
          </div>
          <button
            type="button"
            onClick={actionBanner.onClick}
            className="px-3 py-1 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] font-black shrink-0 shadow-sm active:scale-95 transition-transform"
          >
            {actionBanner.actionLabel}
          </button>
        </div>
      )}

      {/* 3. HERO NEXT MATCH CARD (Apple Sports / SofaScore Centerpiece) */}
      <section aria-label={c.nextMatch}>
        {loading && fixtures.length === 0 ? (
          <div className="p-6 rounded-3xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-sm animate-pulse space-y-4">
            <div className="h-4 w-32 bg-slate-200 dark:bg-white/10 rounded-full mx-auto" />
            <div className="h-16 w-3/4 bg-slate-200 dark:bg-white/10 rounded-2xl mx-auto" />
            <div className="h-10 w-44 bg-slate-200 dark:bg-white/10 rounded-xl mx-auto" />
          </div>
        ) : heroMatch && homeTeam && awayTeam ? (
          <div className="p-4 sm:p-6 rounded-3xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-sm relative overflow-hidden">
            {/* Ambient broadcast illumination */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-28 bg-[#2563eb]/5 dark:bg-[#3b82f6]/10 rounded-full blur-3xl pointer-events-none" />

            {/* Competition Pill & Status Header */}
            <div className="relative z-10 flex items-center justify-between gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                {heroMatch.competitionName || 'EFL UZ'} • {heroMatch.roundName || `${c.matchday} ${heroMatch.matchday}`}
              </span>

              {/* Status Indicator */}
              <div className="flex items-center gap-1.5">
                {heroMatch.status === 'PENDING_CONFIRMATION' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                    <Clock className="w-3 h-3" />
                    {c.pending}
                  </span>
                ) : heroMatch.status === 'DISPUTED' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20">
                    <AlertTriangle className="w-3 h-3" />
                    {c.disputed}
                  </span>
                ) : isFinished ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    FT • {c.confirmed}
                  </span>
                ) : heroMatch.isPlayable === false ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-400">
                    <Lock className="w-3 h-3" />
                    {c.locked}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-[#2563eb] dark:text-[#3b82f6] border border-blue-500/20">
                    <Swords className="w-3 h-3" />
                    {c.ready}
                  </span>
                )}
              </div>
            </div>

            {/* Broadcast Scoreboard Graphic */}
            <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6 my-2 text-center">
              {/* Home Team */}
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/10 p-2.5 flex items-center justify-center shadow-sm">
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
                  <span className="block text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                    {homeTeam.name}
                  </span>
                  <span className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {homeTeam.fullName}
                  </span>
                </div>
              </div>

              {/* Center Score / VS Graphic */}
              <div className="flex flex-col items-center justify-center px-1 sm:px-3 min-w-[85px] sm:min-w-[120px]">
                {isFinished ? (
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">
                      {heroMatch.homeScore}
                    </span>
                    <span className="text-lg sm:text-2xl font-bold text-slate-400">—</span>
                    <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">
                      {heroMatch.awayScore}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <span className="text-2xl sm:text-3xl font-black tracking-wider text-slate-900 dark:text-white">
                      VS
                    </span>
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-1 whitespace-nowrap">
                      {formatFixtureDate(heroMatch)}
                    </span>
                  </div>
                )}
              </div>

              {/* Away Team */}
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/10 p-2.5 flex items-center justify-center shadow-sm">
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
                  <span className="block text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                    {awayTeam.name}
                  </span>
                  <span className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {awayTeam.fullName}
                  </span>
                </div>
              </div>
            </div>

            {/* Match CTA Bottom Actions */}
            <div className="relative z-10 mt-4 pt-3.5 border-t border-[#e2e6ec] dark:border-white/10 flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate self-start sm:self-center">
                {isFinished ? c.recentResult : formatFixtureDate(heroMatch)}
              </span>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {/* Direct Telegram Chat with opponent */}
                {opponentTelegram && !isFinished && (
                  <button
                    type="button"
                    onClick={() => openTelegramChat(opponentTelegram)}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 text-sky-700 dark:text-sky-400 font-bold text-xs transition-colors min-h-[38px]"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{c.chatWithOpponent}</span>
                  </button>
                )}

                {/* Primary Action Button */}
                <button
                  type="button"
                  onClick={() => {
                    if (heroMatch.status === 'SCHEDULED' && heroMatch.isPlayable !== false) {
                      handleOpenSubmit(heroMatch);
                    } else {
                      handleOpenMatch(heroMatch);
                    }
                  }}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-black text-xs shadow-sm active:scale-95 transition-all min-h-[38px]"
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
          <div className="p-6 rounded-3xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 text-center shadow-sm space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-[#2563eb] dark:text-[#3b82f6]">
              <Swords className="w-6 h-6" />
            </div>
            <h3 className="text-base font-black text-slate-900 dark:text-white">
              {c.noFixture}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {c.noFixtureDesc}
            </p>
            <button
              type="button"
              onClick={() => onNavigateTab('leagues')}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563eb] text-white text-xs font-black shadow-sm"
            >
              <span>{c.browseLeagues}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* 4. UPCOMING / RESULTS SECTION (Compact Fixtures Rows) */}
      <section className="rounded-3xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-[#e2e6ec] dark:border-white/10">
          <div className="flex items-center gap-1.5 p-0.5 rounded-xl bg-slate-100 dark:bg-[#171e2c]">
            <button
              type="button"
              onClick={() => setMatchTab('upcoming')}
              className={`text-xs font-black px-3 py-1.5 rounded-lg transition-all ${
                matchTab === 'upcoming'
                  ? 'bg-white dark:bg-[#111722] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {c.upcoming}
            </button>
            <button
              type="button"
              onClick={() => setMatchTab('results')}
              className={`text-xs font-black px-3 py-1.5 rounded-lg transition-all ${
                matchTab === 'results'
                  ? 'bg-white dark:bg-[#111722] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {c.results}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="inline-flex items-center gap-1 text-xs font-bold text-[#2563eb] dark:text-[#3b82f6] hover:underline"
          >
            <span>{c.viewAll}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-[#e2e6ec]/60 dark:divide-white/5">
          {displayedList.length > 0 ? (
            displayedList.map((fixture) => {
              const home = getClubDisplay(fixture, 'home');
              const away = getClubDisplay(fixture, 'away');
              const isMatchFinished = fixture.status === 'CONFIRMED';

              return (
                <button
                  key={fixture.id}
                  type="button"
                  onClick={() => handleOpenMatch(fixture)}
                  className="w-full flex items-center justify-between p-3 px-4 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex items-center -space-x-1.5 shrink-0">
                      <div className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/10 p-1 flex items-center justify-center shadow-xs">
                        <ClubCrest
                          clubId={home.id}
                          logoUrl={home.logoUrl}
                          name={home.name}
                          size="xs"
                        />
                      </div>
                      <div className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/10 p-1 flex items-center justify-center shadow-xs">
                        <ClubCrest
                          clubId={away.id}
                          logoUrl={away.logoUrl}
                          name={away.name}
                          size="xs"
                        />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-black text-slate-900 dark:text-white truncate">
                        {home.name} <span className="text-slate-400 font-normal">vs</span> {away.name}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {fixture.competitionName || 'EFL UZ'} • {fixture.roundName || `Round ${fixture.matchday}`}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 text-right ml-2">
                    {isMatchFinished ? (
                      <span className="font-mono text-xs font-black text-slate-900 dark:text-white px-2 py-0.5 bg-slate-100 dark:bg-white/10 rounded-md tabular-nums">
                        {fixture.homeScore} : {fixture.awayScore}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatFixtureDate(fixture)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="p-6 text-center text-xs text-slate-400">
              {matchTab === 'upcoming' ? c.noUpcomingYet : c.noResultsYet}
            </div>
          )}
        </div>
      </section>

      {/* 5. LEAGUE SNAPSHOT: Single Coherent Sports Summary Strip */}
      <section className="p-4 rounded-3xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {c.leagueSnapshot}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="text-xs font-bold text-[#2563eb] dark:text-[#3b82f6] hover:underline inline-flex items-center gap-1"
          >
            <span>{c.browseLeagues}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Unified Horizontal Sports Summary */}
        <div className="grid grid-cols-5 divide-x divide-[#e2e6ec] dark:divide-white/10 rounded-2xl bg-[#eef1f5] dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/5 py-2.5 text-center">
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400">
              {c.position}
            </span>
            <strong className="text-sm sm:text-base font-black text-amber-600 dark:text-amber-400 tabular-nums">
              {userStats?.leaguePosition ? `#${userStats.leaguePosition}` : '—'}
            </strong>
          </div>
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400">
              {c.points}
            </span>
            <strong className="text-sm sm:text-base font-black text-[#2563eb] dark:text-[#3b82f6] tabular-nums">
              {userStats?.points ?? '0'}
            </strong>
          </div>
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400">
              {c.played}
            </span>
            <strong className="text-sm sm:text-base font-black text-slate-900 dark:text-white tabular-nums">
              {userStats?.matchesPlayed ?? '0'}
            </strong>
          </div>
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400">
              {c.form}
            </span>
            <strong className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
              {userStats ? `${userStats.wins}–${userStats.draws}–${userStats.losses}` : '0-0-0'}
            </strong>
          </div>
          <div className="px-1">
            <span className="block text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400">
              {c.gd}
            </span>
            <strong className="text-xs sm:text-sm font-black text-slate-700 dark:text-slate-300 tabular-nums">
              {goalDiffDisplay}
            </strong>
          </div>
        </div>
      </section>

      {/* 6. COMPETITION HUB: Compact Navigation to League, Cup, UCL */}
      <section className="p-4 rounded-3xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-sm space-y-2.5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {c.competitionHub}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="text-xs font-bold text-[#2563eb] dark:text-[#3b82f6] hover:underline"
          >
            {c.viewAll}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Domestic League */}
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec]/80 dark:border-white/5 hover:border-[#2563eb] transition-all text-left group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Trophy className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-black text-slate-900 dark:text-white truncate">
                  {c.domesticLeague}
                </span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {c.domesticLeagueSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* Domestic Cup */}
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec]/80 dark:border-white/5 hover:border-[#2563eb] transition-all text-left group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Award className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-black text-slate-900 dark:text-white truncate">
                  {c.domesticCup}
                </span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {c.domesticCupSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* European Tournaments */}
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec]/80 dark:border-white/5 hover:border-[#2563eb] transition-all text-left group"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                <Globe2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-black text-slate-900 dark:text-white truncate">
                  {c.europeanCup}
                </span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {c.europeanCupSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>
        </div>
      </section>

      {/* Result Submission Modal if active */}
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
