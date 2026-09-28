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
    greeting: 'Salom',
    season: '2026/27 mavsumi',
    activeMatchday: 'Tur faol',
    nextMatch: 'Asosiy o‘yin',
    recentResult: 'So‘nggi natija',
    submitResult: 'Hisobni kiritish',
    matchCenter: 'O‘yin markazi',
    chatWithOpponent: 'Raqibga yozish',
    locked: 'Yopiq',
    pending: 'Tasdiq kutilmoqda',
    disputed: 'Nizo',
    ready: 'O‘yinga tayyor',
    confirmed: 'Tasdiqlangan',
    matchday: 'tur',
    position: 'O‘rin',
    points: 'Ochko',
    played: 'O‘yin',
    form: 'G‘–D–M',
    gd: 'TF',
    noFixture: 'Rejalashtirilgan o‘yin yo‘q',
    noFixtureDesc: 'Klubingiz uchun yangi turlar ochilganda shu yerda ko‘rinadi.',
    browseLeagues: 'Turnir jadvali',
    upcoming: 'Kelgusi',
    results: 'Natijalar',
    noResultsYet: 'Yakunlangan o‘yinlar yo‘q',
    noUpcomingYet: 'Boshqa kelgusi o‘yin yo‘q',
    viewAll: 'Barchasi',
    competitions: 'Turnirlar',
    leagueSnapshot: 'Liga holati',
    domesticLeague: 'Milliy chempionat',
    domesticLeagueSub: 'Jadval va taqvim',
    domesticCup: 'Milliy kubok',
    domesticCupSub: 'Pley-off bosqichi',
    europeanCup: 'Chempionlar Ligasi',
    europeanCupSub: 'Guruh va pley-off',
    disputeAlert: 'O‘yinda nizo mavjud. Administrator tekshiruvi kutilmoqda.',
    pendingAlert: 'Hisob kiritilgan, raqib tasdiqlashi kutilmoqda.',
    readyAlert: 'Navbatdagi tur o‘yini hisobini kiritishingiz mumkin.',
    retry: 'Qayta urinish',
    error: 'Ma’lumot yuklanmadi',
  },
  ru: {
    greeting: 'Привет',
    season: 'Сезон 2026/27',
    activeMatchday: 'Тур активен',
    nextMatch: 'Главный матч',
    recentResult: 'Последний результат',
    submitResult: 'Ввести счёт',
    matchCenter: 'Центр матча',
    chatWithOpponent: 'Написать сопернику',
    locked: 'Закрыт',
    pending: 'Ожидает подтверждения',
    disputed: 'Спор',
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
    browseLeagues: 'Таблица лиги',
    upcoming: 'Предстоящие',
    results: 'Результаты',
    noResultsYet: 'Завершенных матчей нет',
    noUpcomingYet: 'Других предстоящих матчей нет',
    viewAll: 'Все',
    competitions: 'Турниры',
    leagueSnapshot: 'Положение в лиге',
    domesticLeague: 'Чемпионат',
    domesticLeagueSub: 'Таблица и календарь',
    domesticCup: 'Кубок',
    domesticCupSub: 'Сетка плей-офф',
    europeanCup: 'Лига Чемпионов',
    europeanCupSub: 'Еврокубки',
    disputeAlert: 'Спорный результат на проверке у администратора.',
    pendingAlert: 'Результат отправлен, ожидается подтверждение соперника.',
    readyAlert: 'Доступен ввод счёта очередного тура.',
    retry: 'Повторить',
    error: 'Ошибка загрузки',
  },
  en: {
    greeting: 'Hello',
    season: 'Season 2026/27',
    activeMatchday: 'Matchday Active',
    nextMatch: 'Featured Match',
    recentResult: 'Latest Result',
    submitResult: 'Submit Result',
    matchCenter: 'Match Center',
    chatWithOpponent: 'Chat with Opponent',
    locked: 'Locked',
    pending: 'Awaiting Confirm',
    disputed: 'Disputed',
    ready: 'Ready to Play',
    confirmed: 'Confirmed',
    matchday: 'Round',
    position: 'Pos',
    points: 'Pts',
    played: 'Pld',
    form: 'W–D–L',
    gd: 'GD',
    noFixture: 'No Match Scheduled',
    noFixtureDesc: 'Upcoming fixtures will appear here once published.',
    browseLeagues: 'View Table',
    upcoming: 'Upcoming',
    results: 'Results',
    noResultsYet: 'No completed matches yet',
    noUpcomingYet: 'No other upcoming fixtures',
    viewAll: 'View All',
    competitions: 'Competitions',
    leagueSnapshot: 'League Snapshot',
    domesticLeague: 'Domestic League',
    domesticLeagueSub: 'Table & Fixtures',
    domesticCup: 'Domestic Cup',
    domesticCupSub: 'Knockout Bracket',
    europeanCup: 'Champions League',
    europeanCupSub: 'UEFA Competition',
    disputeAlert: 'Match is disputed and under administrator review.',
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

  // Action required operational strip: Dispute > Confirmation > Submit Result
  const actionBanner = useMemo(() => {
    if (!heroMatch) return null;
    if (heroMatch.status === 'DISPUTED') {
      return {
        icon: AlertTriangle,
        bg: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400',
        btnBg: 'bg-rose-600 hover:bg-rose-500 text-white',
        text: c.disputeAlert,
        actionLabel: c.matchCenter,
        onClick: () => handleOpenMatch(heroMatch),
      };
    }
    if (heroMatch.status === 'PENDING_CONFIRMATION') {
      return {
        icon: Clock,
        bg: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
        btnBg: 'bg-amber-600 hover:bg-amber-500 text-white',
        text: c.pendingAlert,
        actionLabel: c.matchCenter,
        onClick: () => handleOpenMatch(heroMatch),
      };
    }
    if (heroMatch.status === 'SCHEDULED' && heroMatch.isPlayable !== false) {
      return {
        icon: Sparkles,
        bg: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400',
        btnBg: 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white',
        text: c.readyAlert,
        actionLabel: c.submitResult,
        onClick: () => handleOpenSubmit(heroMatch),
      };
    }
    return null;
  }, [heroMatch, c]);

  // Goal difference calculation
  const goalDiff = userStats ? (userStats.goalsScored || 0) - (userStats.goalsConceded || 0) : 0;
  const goalDiffDisplay = goalDiff > 0 ? `+${goalDiff}` : `${goalDiff}`;

  return (
    <div className="space-y-3.5 sm:space-y-4 pb-20 animate-in fade-in duration-200">
      {/* 1. TOP CONTEXT: Clean typography, integrated club identity, no pill clutter */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{c.season}</span>
            <span>•</span>
            <span className="text-[#1e3a8a] dark:text-[#3b82f6] font-bold">{c.activeMatchday}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 truncate">
            {c.greeting}, {user?.firstName || user?.username || 'Player'}
          </h1>
        </div>

        {/* Subtly Integrated Active Club Badge */}
        {activeClub && (
          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-xs hover:border-[#2563eb] transition-all shrink-0 max-w-[170px]"
            title="Active Club"
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
            <span className="text-xs font-black text-slate-900 dark:text-white truncate">
              {activeClub.shortName || activeClub.name}
            </span>
          </button>
        )}
      </div>

      {/* Network / Error banner with retry */}
      {error && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-400 text-xs font-semibold">
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

      {/* 2. ACTION REQUIRED: Single compact operational strip */}
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

      {/* 3. HERO MATCH — LEVEL 1 MAJOR BROADCAST MODULE */}
      <section aria-label={c.nextMatch}>
        {loading && fixtures.length === 0 ? (
          <div className="p-6 rounded-2xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-xs animate-pulse space-y-4">
            <div className="h-4 w-32 bg-slate-200 dark:bg-white/10 rounded-full mx-auto" />
            <div className="h-16 w-3/4 bg-slate-200 dark:bg-white/10 rounded-xl mx-auto" />
            <div className="h-9 w-40 bg-slate-200 dark:bg-white/10 rounded-xl mx-auto" />
          </div>
        ) : heroMatch && homeTeam && awayTeam ? (
          <div className="p-4 sm:p-6 rounded-2xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-sm relative overflow-hidden">
            {/* Subtle top specular accent line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#2563eb]/30 to-transparent pointer-events-none" />

            {/* Header: Quiet competition metadata on left, compact status on right */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                {heroMatch.competitionName || 'EFL UZ'} • {heroMatch.roundName || `${c.matchday} ${heroMatch.matchday}`}
              </span>

              {/* Compact Status Indicator */}
              <div className="shrink-0">
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

            {/* Broadcast Scoreboard Layout: Larger crests (56-64px), dominant score/VS */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6 my-2 text-center">
              {/* Home Team */}
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/10 p-2 flex items-center justify-center shadow-xs">
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
                  <span className="block text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                    {homeTeam.name}
                  </span>
                  <span className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {homeTeam.fullName}
                  </span>
                </div>
              </div>

              {/* Centrally Dominant Score / VS */}
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
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-1 whitespace-nowrap">
                      {formatFixtureDate(heroMatch)}
                    </span>
                  </div>
                )}
              </div>

              {/* Away Team */}
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/10 p-2 flex items-center justify-center shadow-xs">
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
                  <span className="block text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                    {awayTeam.name}
                  </span>
                  <span className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {awayTeam.fullName}
                  </span>
                </div>
              </div>
            </div>

            {/* Hero Card Footer / Primary Actions */}
            <div className="mt-4 pt-3.5 border-t border-[#e2e6ec] dark:border-white/10 flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate self-start sm:self-center">
                {isFinished ? c.recentResult : formatFixtureDate(heroMatch)}
              </span>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                {/* One-tap Opponent Chat via Telegram */}
                {opponentTelegram && !isFinished && (
                  <button
                    type="button"
                    onClick={() => openTelegramChat(opponentTelegram)}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/25 text-sky-700 dark:text-sky-400 font-bold text-xs transition-colors min-h-[38px]"
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
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-black text-xs shadow-xs active:scale-95 transition-all min-h-[38px]"
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
          <div className="p-6 rounded-2xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 text-center shadow-xs space-y-3">
            <div className="w-11 h-11 mx-auto rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-[#2563eb] dark:text-[#3b82f6]">
              <Swords className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              {c.noFixture}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {c.noFixtureDesc}
            </p>
            <button
              type="button"
              onClick={() => onNavigateTab('leagues')}
              className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2563eb] text-white text-xs font-black shadow-xs"
            >
              <span>{c.browseLeagues}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* 4. UPCOMING / RESULTS: LEVEL 2 SECTION SURFACE WITH ROW DIVIDERS */}
      <section className="rounded-2xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-xs overflow-hidden">
        <div className="flex items-center justify-between p-3 sm:p-3.5 border-b border-[#e2e6ec] dark:border-white/10">
          <div className="flex items-center gap-1 p-0.5 rounded-xl bg-slate-100 dark:bg-[#171e2c]">
            <button
              type="button"
              onClick={() => setMatchTab('upcoming')}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                matchTab === 'upcoming'
                  ? 'bg-white dark:bg-[#111722] text-slate-900 dark:text-white shadow-xs font-black'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {c.upcoming}
            </button>
            <button
              type="button"
              onClick={() => setMatchTab('results')}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                matchTab === 'results'
                  ? 'bg-white dark:bg-[#111722] text-slate-900 dark:text-white shadow-xs font-black'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {c.results}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563eb] dark:text-[#3b82f6] hover:underline"
          >
            <span>{c.viewAll}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* SofaScore / Apple Sports style clean divided rows */}
        <div className="divide-y divide-[#e2e6ec]/70 dark:divide-white/5">
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
                  className="w-full flex items-center justify-between p-3 px-4 hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors text-left"
                >
                  {/* Teams + Crests */}
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
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {home.name} <span className="text-slate-400 font-normal">vs</span> {away.name}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {fixture.competitionName || 'EFL UZ'} • {fixture.roundName || `Round ${fixture.matchday}`}
                      </div>
                    </div>
                  </div>

                  {/* Score or Fixture Time */}
                  <div className="shrink-0 text-right ml-2">
                    {isMatchFinished ? (
                      <span className="font-mono text-xs font-black text-slate-900 dark:text-white px-2 py-0.5 bg-slate-100 dark:bg-white/10 rounded-md tabular-nums">
                        {fixture.homeScore} : {fixture.awayScore}
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
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

      {/* 5. LEAGUE SNAPSHOT: UNIFIED HORIZONTAL SUMMARY STRIP */}
      <section className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {c.leagueSnapshot}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="text-xs font-semibold text-[#2563eb] dark:text-[#3b82f6] hover:underline inline-flex items-center gap-1"
          >
            <span>{c.browseLeagues}</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {/* Unified 5-column sports statistics bar */}
        <div className="grid grid-cols-5 divide-x divide-[#e2e6ec] dark:divide-white/10 rounded-xl bg-[#eef1f5] dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/5 py-2 text-center">
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

      {/* 6. COMPETITION ACCESS SHORTCUTS: Clean 3-column tiles */}
      <section className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#111722] border border-[#e2e6ec] dark:border-white/10 shadow-xs space-y-2">
        <div className="flex items-center justify-between mb-0.5">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
            {c.competitions}
          </h3>
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="text-xs font-semibold text-[#2563eb] dark:text-[#3b82f6] hover:underline"
          >
            {c.viewAll}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Domestic League shortcut */}
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec]/80 dark:border-white/5 hover:border-[#2563eb] transition-all text-left group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Trophy className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-bold text-slate-900 dark:text-white truncate">
                  {c.domesticLeague}
                </span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {c.domesticLeagueSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* Domestic Cup shortcut */}
          <button
            type="button"
            onClick={() => onNavigateTab('cups')}
            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec]/80 dark:border-white/5 hover:border-[#2563eb] transition-all text-left group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Award className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-bold text-slate-900 dark:text-white truncate">
                  {c.domesticCup}
                </span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {c.domesticCupSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </button>

          {/* European Tournaments shortcut */}
          <button
            type="button"
            onClick={() => onNavigateTab('champions-league')}
            className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-[#171e2c] border border-[#e2e6ec]/80 dark:border-white/5 hover:border-[#2563eb] transition-all text-left group"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                <Globe2 className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <span className="block text-xs font-bold text-slate-900 dark:text-white truncate">
                  {c.europeanCup}
                </span>
                <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {c.europeanCupSub}
                </span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
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
