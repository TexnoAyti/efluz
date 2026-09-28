import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  LockKeyhole,
  RefreshCw,
  Search,
  Swords,
  Trophy,
  CheckCircle2,
  AlertTriangle,
  Flame,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Fixture } from '../types';
import { ClubCrest } from './ClubCrest';

interface Props {
  onNavigateTab: (tab: any) => void;
  onSelectFixtureForMatchCenter?: (fixture: Fixture) => void;
  onOpenSearch?: () => void;
}

const copy = {
  uz: {
    broadcast: 'EFL UZ MATCH CENTRE',
    greeting: 'Salom',
    activeClubContext: 'Klub holati',
    nextMatch: 'KEYINGI O‘YIN',
    recentResult: 'SO‘NGGI NATIJA',
    allMatches: 'O‘yinlar',
    submitResult: 'Hisobni kiritish',
    matchCenter: 'O‘yin markazi',
    locked: 'Tur ochilmagan',
    pending: 'Tasdiq kutilmoqda',
    disputed: 'Nizo',
    ready: 'O‘ynashga tayyor',
    confirmed: 'Tasdiqlangan',
    matchday: 'tur',
    position: 'O‘rin',
    points: 'Ochko',
    played: 'O‘yin',
    form: 'G‘–D–M',
    noFixture: 'Hozircha rejalashtirilgan o‘yin yo‘q',
    noFixtureDesc: 'Klubingiz uchun yangi turlar ochilganda shu yerda paydo bo‘ladi.',
    browseLeagues: 'Turnirlar jadvalini ko‘rish',
    upcoming: 'Kelgusi',
    results: 'Natijalar',
    noResultsYet: 'Hali natijalar yo‘q',
    noUpcomingYet: 'Boshqa kelgusi o‘yin yo‘q',
    viewAll: 'Barchasi',
    competitionHub: 'Turnirlar markazi',
    leagueSnapshot: 'Mavsum holati',
    retry: 'Qayta urinish',
    error: 'Ma’lumot yuklanmadi',
  },
  ru: {
    broadcast: 'EFL UZ MATCH CENTRE',
    greeting: 'Привет',
    activeClubContext: 'Клуб',
    nextMatch: 'СЛЕДУЮЩИЙ МАТЧ',
    recentResult: 'ПОСЛЕДНИЙ РЕЗУЛЬТАТ',
    allMatches: 'Матчи',
    submitResult: 'Ввести счёт',
    matchCenter: 'Центр матча',
    locked: 'Тур закрыт',
    pending: 'Ожидает подтверждения',
    disputed: 'Спор',
    ready: 'Готов к игре',
    confirmed: 'Подтверждён',
    matchday: 'тур',
    position: 'Место',
    points: 'Очки',
    played: 'Матчи',
    form: 'В–Н–П',
    noFixture: 'Матч пока не назначен',
    noFixtureDesc: 'Матчи появятся здесь после открытия очередного тура.',
    browseLeagues: 'Открыть лиги и расписание',
    upcoming: 'Предстоящие',
    results: 'Результаты',
    noResultsYet: 'Результатов пока нет',
    noUpcomingYet: 'Других предстоящих матчей нет',
    viewAll: 'Все',
    competitionHub: 'Турниры',
    leagueSnapshot: 'Положение в лиге',
    retry: 'Повторить',
    error: 'Ошибка загрузки',
  },
  en: {
    broadcast: 'EFL UZ MATCH CENTRE',
    greeting: 'Hello',
    activeClubContext: 'Club Context',
    nextMatch: 'NEXT MATCH',
    recentResult: 'LATEST RESULT',
    allMatches: 'Matches',
    submitResult: 'Submit Result',
    matchCenter: 'Match Center',
    locked: 'Matchday Locked',
    pending: 'Awaiting Confirm',
    disputed: 'Disputed',
    ready: 'Ready to Play',
    confirmed: 'Confirmed',
    matchday: 'Round',
    position: 'Position',
    points: 'Points',
    played: 'Played',
    form: 'W–D–L',
    noFixture: 'No Match Scheduled Yet',
    noFixtureDesc: 'Upcoming fixtures will appear here once published by the league.',
    browseLeagues: 'Browse Competitions',
    upcoming: 'Upcoming',
    results: 'Results',
    noResultsYet: 'No confirmed results yet',
    noUpcomingYet: 'No other upcoming matches',
    viewAll: 'View All',
    competitionHub: 'Competitions',
    leagueSnapshot: 'League Snapshot',
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
  onOpenSearch,
}) => {
  const { user, currentClub, ownedClubs, activeSeasonId, userStats } = useAuth();
  const { language } = useI18n();
  const c = copy[language] || copy.uz;

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [matchTab, setMatchTab] = useState<'upcoming' | 'results'>('upcoming');

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

  // Priority: 1. Disputed / Pending action fixture, 2. Next playable scheduled fixture, 3. Any pending fixture, 4. Most recent finished fixture
  const pendingFixtures = useMemo(
    () => fixtures.filter((f) => f.status !== 'CONFIRMED' && f.status !== 'CANCELLED'),
    [fixtures]
  );

  const confirmedFixtures = useMemo(
    () => [...fixtures].filter((f) => f.status === 'CONFIRMED').reverse(),
    [fixtures]
  );

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
    () => pendingFixtures.filter((f) => f.id !== heroMatch?.id).slice(0, 3),
    [pendingFixtures, heroMatch]
  );

  const otherResults = useMemo(
    () => confirmedFixtures.filter((f) => f.id !== heroMatch?.id).slice(0, 3),
    [confirmedFixtures, heroMatch]
  );

  const displayedList = matchTab === 'upcoming' ? otherUpcoming : otherResults;

  const handleOpenMatch = (fixture: Fixture) => {
    if (onSelectFixtureForMatchCenter) {
      onSelectFixtureForMatchCenter(fixture);
    }
    onNavigateTab('my-club');
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

  return (
    <div className="space-y-5 pb-24 animate-in fade-in duration-200">
      {/* 1. Compact Contextual Header */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
              {c.broadcast}
            </span>
            <span className="text-slate-300 dark:text-slate-700">•</span>
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate">
              Season 2026/27
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-0.5 truncate">
            {c.greeting}, {user?.firstName || user?.username || 'Player'}
          </h1>
        </div>

        {/* Active Club Mini Context Badge */}
        {activeClub && (
          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-sm hover:border-blue-500 transition-all shrink-0 max-w-[170px]"
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

      {error && (
        <div className="preview-surface flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold">
          <span>{c.error}</span>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1 font-bold text-blue-600 dark:text-blue-400"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {c.retry}
          </button>
        </div>
      )}

      {/* 2. Hero Next Match Card (Apple Sports / Broadcast Centerpiece) */}
      <section aria-label={c.nextMatch}>
        {loading && fixtures.length === 0 ? (
          <div className="preview-surface p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm animate-pulse space-y-4">
            <div className="h-4 w-32 bg-slate-200 dark:bg-white/10 rounded-full mx-auto" />
            <div className="h-16 w-3/4 bg-slate-200 dark:bg-white/10 rounded-2xl mx-auto" />
            <div className="h-10 w-44 bg-slate-200 dark:bg-white/10 rounded-xl mx-auto" />
          </div>
        ) : heroMatch && homeTeam && awayTeam ? (
          <div className="preview-surface p-5 sm:p-7 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-md relative overflow-hidden group">
            {/* Subtle stadium illumination effect */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-32 bg-blue-500/10 dark:bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

            {/* Competition Pill & Status Header */}
            <div className="relative z-10 flex items-center justify-between gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-white/10">
                {heroMatch.competitionName || 'EFL UZ'} · {heroMatch.roundName || `${c.matchday} ${heroMatch.matchday}`}
              </span>

              {/* Status Indicator */}
              <div className="flex items-center gap-1.5">
                {heroMatch.status === 'PENDING_CONFIRMATION' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <Clock3 className="w-3 h-3" />
                    {c.pending}
                  </span>
                ) : heroMatch.status === 'DISPUTED' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                    <AlertTriangle className="w-3 h-3" />
                    {c.disputed}
                  </span>
                ) : isFinished ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    FT · {c.confirmed}
                  </span>
                ) : heroMatch.isPlayable === false ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400">
                    <LockKeyhole className="w-3 h-3" />
                    {c.locked}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    <Swords className="w-3 h-3" />
                    {c.ready}
                  </span>
                )}
              </div>
            </div>

            {/* Broadcast Scoreboard Graphic */}
            <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6 my-4 text-center">
              {/* Home Team */}
              <div className="flex flex-col items-center gap-2 min-w-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 p-2.5 flex items-center justify-center shadow-sm">
                  <ClubCrest
                    clubId={homeTeam.id}
                    logoUrl={homeTeam.logoUrl}
                    name={homeTeam.fullName}
                    shortName={homeTeam.name}
                    size="xl"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="w-full">
                  <span className="block text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                    {homeTeam.name}
                  </span>
                  <span className="hidden sm:block text-[11px] text-slate-400 truncate">
                    {homeTeam.fullName}
                  </span>
                </div>
              </div>

              {/* Center Score / VS Graphic */}
              <div className="flex flex-col items-center justify-center px-2 min-w-[90px] sm:min-w-[120px]">
                {isFinished ? (
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">
                      {heroMatch.homeScore}
                    </span>
                    <span className="text-xl sm:text-2xl font-bold text-slate-400 dark:text-slate-600">—</span>
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
              <div className="flex flex-col items-center gap-2 min-w-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 p-2.5 flex items-center justify-center shadow-sm">
                  <ClubCrest
                    clubId={awayTeam.id}
                    logoUrl={awayTeam.logoUrl}
                    name={awayTeam.fullName}
                    shortName={awayTeam.name}
                    size="xl"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="w-full">
                  <span className="block text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                    {awayTeam.name}
                  </span>
                  <span className="hidden sm:block text-[11px] text-slate-400 truncate">
                    {awayTeam.fullName}
                  </span>
                </div>
              </div>
            </div>

            {/* Match CTA Bottom Bar */}
            <div className="relative z-10 mt-5 pt-4 border-t border-slate-200/80 dark:border-white/10 flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                {isFinished ? c.recentResult : formatFixtureDate(heroMatch)}
              </span>

              <button
                type="button"
                onClick={() => handleOpenMatch(heroMatch)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs shadow-md shadow-blue-500/20 active:scale-95 transition-all"
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
        ) : (
          <div className="preview-surface p-7 rounded-3xl border border-slate-200/80 dark:border-white/10 text-center shadow-sm space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
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
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black shadow-sm"
            >
              <span>{c.browseLeagues}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* 3. Relevant Upcoming & Recent Matches */}
      <section className="preview-surface rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-slate-200/80 dark:border-white/10">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMatchTab('upcoming')}
              className={`text-xs font-black px-3 py-1.5 rounded-xl transition-all ${
                matchTab === 'upcoming'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {c.upcoming}
            </button>
            <button
              type="button"
              onClick={() => setMatchTab('results')}
              className={`text-xs font-black px-3 py-1.5 rounded-xl transition-all ${
                matchTab === 'results'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {c.results}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab('my-club')}
            className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
          >
            <span>{c.viewAll}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-white/5">
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
                  className="w-full flex items-center justify-between p-3.5 px-4 sm:px-5 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex items-center -space-x-1.5 shrink-0">
                      <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-1 flex items-center justify-center shadow-sm">
                        <ClubCrest
                          clubId={home.id}
                          logoUrl={home.logoUrl}
                          name={home.name}
                          size="xs"
                        />
                      </div>
                      <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-1 flex items-center justify-center shadow-sm">
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
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {fixture.competitionName || 'EFL UZ'} · Round {fixture.matchday}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    {isMatchFinished ? (
                      <span className="font-mono text-xs font-black text-slate-900 dark:text-white px-2 py-1 bg-slate-100 dark:bg-white/10 rounded-lg tabular-nums">
                        {fixture.homeScore} : {fixture.awayScore}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
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

      {/* 4. League Position Snapshot */}
      <section className="preview-surface p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              {c.leagueSnapshot}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('leagues')}
            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            <span>{c.competitionHub}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 pt-1">
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 text-center">
            <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {c.position}
            </span>
            <strong className="text-base font-black text-slate-900 dark:text-white tabular-nums">
              {userStats?.leaguePosition ? `#${userStats.leaguePosition}` : '—'}
            </strong>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 text-center">
            <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {c.points}
            </span>
            <strong className="text-base font-black text-blue-600 dark:text-blue-400 tabular-nums">
              {userStats?.points ?? '0'}
            </strong>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 text-center">
            <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {c.played}
            </span>
            <strong className="text-base font-black text-slate-900 dark:text-white tabular-nums">
              {userStats?.matchesPlayed ?? '0'}
            </strong>
          </div>
          <div className="p-2.5 rounded-2xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/5 text-center">
            <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
              {c.form}
            </span>
            <strong className="text-xs font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
              {userStats ? `${userStats.wins}–${userStats.draws}–${userStats.losses}` : '—'}
            </strong>
          </div>
        </div>
      </section>
    </div>
  );
};
