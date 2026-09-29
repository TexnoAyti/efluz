import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n, Language } from '../i18n';
import { api } from '../lib/api';
import { Fixture, Club, Competition, StandingsRow } from '../types';
import { ClubCrest } from './ClubCrest';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import { MatchdayCountdown } from './MatchdayCountdown';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import { openTelegramChat, isValidTelegramUsername } from '../lib/telegramUtils';
import {
  Shield,
  Trophy,
  Globe2,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Send,
  Lock,
  ChevronRight,
  Sun,
  Moon,
  Languages,
  SlidersHorizontal,
  Sparkles,
  MapPin,
  RefreshCw,
  Swords,
  User as UserIcon,
} from 'lucide-react';

interface ClubHubViewProps {
  onNavigateTab: (tab: any) => void;
  onSelectFixtureForMatchCenter?: (fixture: Fixture) => void;
  initialSelectedFixture?: Fixture | null;
  theme?: 'light' | 'dark';
  onThemeChange?: (theme: 'light' | 'dark') => void;
}

export const ClubHubView: React.FC<ClubHubViewProps> = ({
  onNavigateTab,
  onSelectFixtureForMatchCenter,
  initialSelectedFixture,
  theme = 'dark',
  onThemeChange,
}) => {
  const {
    user,
    currentClub,
    ownedClubs,
    selectCurrentClub,
    userStats,
    activeSeasonId,
    isDevMode,
    devProfiles,
    switchDevUser,
    showToast,
  } = useAuth();
  const { language, setLanguage, t } = useI18n();

  // Local copy dictionary for participant-first Club section
  const copy = {
    uz: {
      activeClub: 'Faol klub',
      controlledClub: 'Siz boshqarayotgan klub',
      switchClub: 'Klubni almashtirish',
      otherClub: 'Ikkinchi klub',
      ownershipTag: 'Mening klubim',
      nextMatchAction: 'Keyingi o‘yin / Harakat kerak',
      actionRequired: 'Harakat talab etiladi',
      matches: 'O‘yinlar',
      upcoming: 'Kelgusi',
      results: 'Natijalar',
      noMatches: 'O‘yinlar mavjud emas',
      seasonSnapshot: 'Mavsum statistikasi',
      position: 'O‘rin',
      points: 'Ochko',
      played: 'O‘yin',
      record: 'G‘–D–M',
      goals: 'Gollar',
      difference: 'Farq',
      form: 'So‘nggi forma',
      competitions: 'Musobaqalar holati',
      domesticLeague: 'Milliy liga',
      domesticCup: 'Milliy kubok',
      europeanCup: 'Yevrokubok',
      accountSettings: 'Hisob va Sozlamalar',
      appearance: 'Ko‘rinish mavzusi',
      light: 'Yorug‘',
      dark: 'Qorong‘i',
      adminPanel: 'Turnir Admin Paneli',
      adminDesc: 'Jadvallar, nizolar, match operations va klub boshqaruvi',
      submitResult: 'Hisobni kiritish',
      updateResult: 'Hisobni yangilash',
      confirmOpponent: 'Raqib hisobini tasdiqlash',
      reportDispute: 'E’tiroz bildirish',
      chatWithOpponent: 'Raqibga yozish',
      opponentEntered: 'Raqib kiritgan hisob',
      matchdayLocked: 'Tur qulflangan',
      noClubYet: 'Hali klub biriktirilmagan',
      selectClubCta: 'Ligalar bo‘limidan klub tanlang',
      exploreLeagues: 'Ligalar bo‘limiga o‘tish',
      activeStatus: 'Faol',
      groupStage: 'Guruh bosqichi',
      knockoutStage: 'Pley-off',
      sandboxSubtitle: 'Ikki tomonlama o‘yinlar va hisob tasdiqlashni sinash',
      homeTag: 'Mezbon',
      awayTag: 'Mehmon',
      matchday: 'tur',
      officialStadium: 'Rasmiy stadion',
    },
    ru: {
      activeClub: 'Активный клуб',
      controlledClub: 'Клуб под вашим управлением',
      switchClub: 'Сменить клуб',
      otherClub: 'Второй клуб',
      ownershipTag: 'Мой клуб',
      nextMatchAction: 'Следующий матч / Требуется действие',
      actionRequired: 'Требуется действие',
      matches: 'Матчи',
      upcoming: 'Предстоящие',
      results: 'Результаты',
      noMatches: 'Матчи не найдены',
      seasonSnapshot: 'Статистика сезона',
      position: 'Место',
      points: 'Очки',
      played: 'Игры',
      record: 'В–Н–П',
      goals: 'Голы',
      difference: 'Разница',
      form: 'Форма',
      competitions: 'Турниры клуба',
      domesticLeague: 'Национальная лига',
      domesticCup: 'Кубок страны',
      europeanCup: 'Еврокубок',
      accountSettings: 'Аккаунт и Настройки',
      appearance: 'Тема оформления',
      light: 'Светлая',
      dark: 'Тёмная',
      adminPanel: 'Панель администратора',
      adminDesc: 'Управление матчами, спорами, операциями и клубами',
      submitResult: 'Внести счёт',
      updateResult: 'Обновить счёт',
      confirmOpponent: 'Подтвердить счёт соперника',
      reportDispute: 'Открыть спор',
      chatWithOpponent: 'Написать сопернику',
      opponentEntered: 'Соперник внёс счёт',
      matchdayLocked: 'Тур закрыт',
      noClubYet: 'Клуб пока не выбран',
      selectClubCta: 'Выберите клуб в разделе лиг',
      exploreLeagues: 'Перейти к лигам',
      activeStatus: 'Активен',
      groupStage: 'Групповой этап',
      knockoutStage: 'Плей-офф',
      sandboxSubtitle: 'Переключение для проверки подтверждения результатов',
      homeTag: 'Хозяева',
      awayTag: 'Гости',
      matchday: 'тур',
      officialStadium: 'Официальный стадион',
    },
    en: {
      activeClub: 'Active Club',
      controlledClub: 'Club under your control',
      switchClub: 'Switch Club',
      otherClub: 'Other Club',
      ownershipTag: 'My Club',
      nextMatchAction: 'Next Match / Action Required',
      actionRequired: 'Action Required',
      matches: 'Matches',
      upcoming: 'Upcoming',
      results: 'Results',
      noMatches: 'No matches found',
      seasonSnapshot: 'Season Snapshot',
      position: 'Pos',
      points: 'PTS',
      played: 'Played',
      record: 'W–D–L',
      goals: 'Goals',
      difference: 'GD',
      form: 'Recent Form',
      competitions: 'Club Competitions',
      domesticLeague: 'Domestic League',
      domesticCup: 'Domestic Cup',
      europeanCup: 'European Competition',
      accountSettings: 'Account & Settings',
      appearance: 'Appearance',
      light: 'Light',
      dark: 'Dark',
      adminPanel: 'Tournament Admin Panel',
      adminDesc: 'Manage fixtures, disputes, operations, and clubs',
      submitResult: 'Submit Result',
      updateResult: 'Update Result',
      confirmOpponent: 'Confirm Opponent Score',
      reportDispute: 'Report Dispute',
      chatWithOpponent: 'Chat with Opponent',
      opponentEntered: 'Opponent submitted score',
      matchdayLocked: 'Matchday Locked',
      noClubYet: 'No Club Claimed Yet',
      selectClubCta: 'Select a club from the leagues section',
      exploreLeagues: 'Explore Leagues',
      activeStatus: 'Active',
      groupStage: 'Group Stage',
      knockoutStage: 'Knockout Stage',
      sandboxSubtitle: 'Switch test profiles to simulate consensus match flow',
      homeTag: 'Home',
      awayTag: 'Away',
      matchday: 'MD',
      officialStadium: 'Official Stadium',
    },
  }[language] || {
    activeClub: 'Active Club',
    controlledClub: 'Club under your control',
    switchClub: 'Switch Club',
    otherClub: 'Other Club',
    ownershipTag: 'My Club',
    nextMatchAction: 'Next Match / Action Required',
    actionRequired: 'Action Required',
    matches: 'Matches',
    upcoming: 'Upcoming',
    results: 'Results',
    noMatches: 'No matches found',
    seasonSnapshot: 'Season Snapshot',
    position: 'Pos',
    points: 'PTS',
    played: 'Played',
    record: 'W–D–L',
    goals: 'Goals',
    difference: 'GD',
    form: 'Recent Form',
    competitions: 'Club Competitions',
    domesticLeague: 'Domestic League',
    domesticCup: 'Domestic Cup',
    europeanCup: 'European Competition',
    accountSettings: 'Account & Settings',
    appearance: 'Appearance',
    light: 'Light',
    dark: 'Dark',
    adminPanel: 'Tournament Admin Panel',
    adminDesc: 'Manage fixtures, disputes, operations, and clubs',
    submitResult: 'Submit Result',
    updateResult: 'Update Result',
    confirmOpponent: 'Confirm Opponent Score',
    reportDispute: 'Report Dispute',
    chatWithOpponent: 'Chat with Opponent',
    opponentEntered: 'Opponent submitted score',
    matchdayLocked: 'Matchday Locked',
    noClubYet: 'No Club Claimed Yet',
    selectClubCta: 'Select a club from the leagues section',
    exploreLeagues: 'Explore Leagues',
    activeStatus: 'Active',
    groupStage: 'Group Stage',
    knockoutStage: 'Knockout Stage',
    sandboxSubtitle: 'Switch test profiles to simulate consensus match flow',
    homeTag: 'Home',
    awayTag: 'Away',
    matchday: 'MD',
    officialStadium: 'Official Stadium',
  };

  // State
  const [allFixtures, setAllFixtures] = useState<Fixture[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [leagueStandings, setLeagueStandings] = useState<StandingsRow[]>([]);
  const [matchTab, setMatchTab] = useState<'upcoming' | 'results'>('upcoming');
  const [selectedFixtureForModal, setSelectedFixtureForModal] = useState<Fixture | null>(
    initialSelectedFixture || null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingQuick, setIsSubmittingQuick] = useState(false);

  // Active Club determination
  const activeClub = currentClub || ownedClubs[0] || null;
  const secondaryClubs = useMemo(
    () => ownedClubs.filter((c) => c.id !== activeClub?.id),
    [ownedClubs, activeClub?.id]
  );

  // Load Fixtures & Competitions
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [matchesRes, compsRes] = await Promise.all([
        api.getMyMatches(activeSeasonId).catch(() => ({ fixtures: [] })),
        api.getCompetitions(activeSeasonId).catch(() => ({ competitions: [] })),
      ]);

      const fixtures = matchesRes.fixtures || [];
      setAllFixtures(fixtures);

      const comps = compsRes.competitions || [];
      setCompetitions(comps);

      // Load league standings for active club
      if (activeClub?.leagueId) {
        const matchingComp = comps.find(
          (c) => c.leagueId === activeClub.leagueId && c.type === 'LEAGUE'
        );
        if (matchingComp) {
          try {
            const standRes = await api.getCompetitionStandings(matchingComp.id);
            setLeagueStandings(standRes.standings || []);
          } catch {
            setLeagueStandings([]);
          }
        }
      }
    } catch (err: any) {
      console.warn('Failed to load club hub data:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, [activeSeasonId, activeClub?.id, activeClub?.leagueId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Filter fixtures belonging to the active club
  const activeClubFixtures = useMemo(() => {
    if (!activeClub) return allFixtures;
    const directMatches = allFixtures.filter(
      (f) =>
        f.homeClubId === activeClub.id ||
        f.awayClubId === activeClub.id ||
        f.homeClub?.id === activeClub.id ||
        f.awayClub?.id === activeClub.id
    );
    return directMatches.length > 0 ? directMatches : allFixtures;
  }, [allFixtures, activeClub?.id]);

  // Partitions
  const pendingFixtures = useMemo(
    () => activeClubFixtures.filter((f) => f.status !== 'CONFIRMED' && f.status !== 'CANCELLED'),
    [activeClubFixtures]
  );

  const confirmedFixtures = useMemo(
    () => [...activeClubFixtures].filter((f) => f.status === 'CONFIRMED').reverse(),
    [activeClubFixtures]
  );

  // 3. NEXT MATCH / ACTION REQUIRED (Priority hierarchy)
  const heroMatch = useMemo(() => {
    // 1. Disputed match
    const disputed = pendingFixtures.find((f) => f.status === 'DISPUTED');
    if (disputed) return disputed;

    // 2. Waiting confirmation
    const waitingConfirm = pendingFixtures.find(
      (f) => f.status === 'PENDING_CONFIRMATION' || Boolean(f.opponentSubmission)
    );
    if (waitingConfirm) return waitingConfirm;

    // 3. Ready-to-play fixture
    const readyToPlay = pendingFixtures.find(
      (f) => f.isPlayable !== false && f.status === 'SCHEDULED'
    );
    if (readyToPlay) return readyToPlay;

    // 4. Next scheduled fixture
    if (pendingFixtures.length > 0) return pendingFixtures[0];

    // 5. Recent confirmed result
    if (confirmedFixtures.length > 0) return confirmedFixtures[0];

    return null;
  }, [pendingFixtures, confirmedFixtures]);

  // Opponent Telegram Username for Hero Match
  const opponentTelegram = useMemo(() => {
    if (!heroMatch) return null;
    const isHome = heroMatch.homeClubId === activeClub?.id || heroMatch.homeClub?.id === activeClub?.id;
    const oppUsername = isHome
      ? heroMatch.awayOwner?.username || heroMatch.awayUser?.username || heroMatch.awayClub?.claimedByUsername
      : heroMatch.homeOwner?.username || heroMatch.homeUser?.username || heroMatch.homeClub?.claimedByUsername;
    return isValidTelegramUsername(oppUsername) ? oppUsername : null;
  }, [heroMatch, activeClub?.id]);

  // Season Snapshot Data
  const clubStandingRow = useMemo(() => {
    if (!activeClub || leagueStandings.length === 0) return null;
    return leagueStandings.find((r) => r.clubId === activeClub.id) || null;
  }, [activeClub?.id, leagueStandings]);

  const statsPosition = clubStandingRow?.position ?? userStats?.leaguePosition ?? null;
  const statsPoints = clubStandingRow?.points ?? userStats?.points ?? 0;
  const statsPlayed = clubStandingRow?.played ?? userStats?.matchesPlayed ?? 0;
  const statsWon = clubStandingRow?.won ?? userStats?.wins ?? 0;
  const statsDrawn = clubStandingRow?.drawn ?? userStats?.draws ?? 0;
  const statsLost = clubStandingRow?.lost ?? userStats?.losses ?? 0;
  const statsGf = clubStandingRow?.goalsFor ?? userStats?.goalsScored ?? 0;
  const statsGa = clubStandingRow?.goalsAgainst ?? userStats?.goalsConceded ?? 0;
  const statsGd = clubStandingRow?.goalDifference ?? statsGf - statsGa;

  // Recent Form dots derived from actual confirmed matches
  const recentFormList = useMemo(() => {
    if (!activeClub) return [];
    return confirmedFixtures.slice(0, 5).map((f) => {
      const isHome = f.homeClubId === activeClub.id || f.homeClub?.id === activeClub.id;
      const myScore = isHome ? (f.homeScore ?? 0) : (f.awayScore ?? 0);
      const oppScore = isHome ? (f.awayScore ?? 0) : (f.homeScore ?? 0);
      if (myScore > oppScore) return { letter: 'W', bg: 'bg-emerald-500 text-white' };
      if (myScore === oppScore) return { letter: 'D', bg: 'bg-amber-500 text-white' };
      return { letter: 'L', bg: 'bg-rose-500 text-white' };
    });
  }, [confirmedFixtures, activeClub?.id]);

  // Competitions for the active club
  const clubCompetitions = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      type: string;
      icon: typeof Shield;
      stage: string;
      targetTab: string;
    }> = [];

    if (!activeClub) return list;

    // 1. Domestic League
    const domLeague = competitions.find(
      (c) => c.leagueId === activeClub.leagueId && c.type === 'LEAGUE'
    );
    list.push({
      id: domLeague?.id || 'dom-league',
      name: domLeague?.name || (activeClub.leagueId ? activeClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase() : 'Domestic League'),
      type: copy.domesticLeague,
      icon: Shield,
      stage: statsPosition ? `#${statsPosition} ${copy.position}` : copy.activeStatus,
      targetTab: 'leagues',
    });

    // 2. Domestic Cup
    const domCup = competitions.find(
      (c) => c.type === 'CUP' && (c.leagueId === activeClub.leagueId || c.name.toLowerCase().includes(activeClub.leagueId?.replace('league-', '') || ''))
    );
    if (domCup) {
      list.push({
        id: domCup.id,
        name: domCup.name,
        type: copy.domesticCup,
        icon: Trophy,
        stage: copy.activeStatus,
        targetTab: 'cups',
      });
    }

    // 3. Champions League / European
    const eurComp = competitions.find((c) => c.type === 'CHAMPIONS_LEAGUE');
    if (eurComp) {
      list.push({
        id: eurComp.id,
        name: eurComp.name || 'UEFA Champions League',
        type: copy.europeanCup,
        icon: Globe2,
        stage: copy.groupStage,
        targetTab: 'champions-league',
      });
    }

    return list;
  }, [competitions, activeClub, statsPosition, copy]);

  // Quick confirm opponent submission
  const handleQuickConfirm = async (fixture: Fixture, homeScore: number, awayScore: number) => {
    if (isSubmittingQuick) return;
    setIsSubmittingQuick(true);
    try {
      await api.submitFixtureResult(fixture.id, homeScore, awayScore);
      showToast(t.submissionSuccess, 'success');
      void loadData();
    } catch (err: any) {
      showToast(err.message || 'Confirmation failed', 'error');
    } finally {
      setIsSubmittingQuick(false);
    }
  };

  const languagesList: { code: Language; label: string; flag: string }[] = [
    { code: 'uz', label: 'O‘zbekcha', flag: '🇺🇿' },
    { code: 'ru', label: 'Русский', flag: '🇷🇺' },
    { code: 'en', label: 'English', flag: '🇬🇧' },
  ];

  // If user has NO club claimed
  if (!activeClub && ownedClubs.length === 0 && !isLoading) {
    return (
      <div className="preview-surface p-8 sm:p-12 rounded-3xl border border-[var(--efl-border)] text-center max-w-lg mx-auto my-8 space-y-4 shadow-sm">
        <div className="w-16 h-16 rounded-2xl bg-[var(--efl-primary-soft)] border border-[var(--efl-border)] text-[var(--efl-primary)] mx-auto flex items-center justify-center">
          <Shield className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-black text-[var(--efl-text)]">
            {copy.noClubYet}
          </h2>
          <p className="text-xs text-[var(--efl-text-2)] mt-1 max-w-sm mx-auto">
            {copy.selectClubCta}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigateTab('leagues')}
          className="btn-glass-primary px-6 py-2.5 text-xs font-black inline-flex items-center gap-2"
        >
          <Shield className="w-4 h-4" />
          <span>{copy.exploreLeagues}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 animate-in fade-in duration-200">
      {/* ==============================================================
          1. ACTIVE CLUB IDENTITY & 2. OWNED CLUB SWITCHER
          ============================================================== */}
      <section className="preview-surface rounded-3xl border border-[var(--efl-border)] p-5 sm:p-6 shadow-sm relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-5 text-center sm:text-left">
          {/* Active Club Identity Layout */}
          <div className="flex flex-col sm:flex-row items-center gap-4.5">
            <div className="relative group shrink-0">
              <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl bg-[var(--efl-surface)] border-2 border-[var(--efl-primary)] p-2 flex items-center justify-center shadow-md transition-transform duration-200">
                <ClubCrest
                  clubId={activeClub?.id}
                  logoUrl={activeClub?.logoUrl}
                  name={activeClub?.name}
                  shortName={activeClub?.shortName}
                  size="xl"
                  className="w-full h-full object-contain"
                />
              </div>
              <div
                className="absolute -bottom-1 -right-1 bg-[var(--efl-primary)] text-white p-1 rounded-full shadow-sm ring-2 ring-[var(--efl-surface)]"
                title={copy.activeClub}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 mb-1">
                <Sparkles className="w-3 h-3" />
                <span>
                  {activeClub?.leagueId
                    ? activeClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase()
                    : 'DOMESTIC LEAGUE'}
                </span>
                <span>•</span>
                <span>2026/27</span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-black text-[var(--efl-text)] tracking-tight truncate max-w-sm">
                {activeClub?.name || 'Club'}
              </h1>

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-[var(--efl-text-2)] mt-1">
                <span className="font-bold text-[var(--efl-primary)] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--efl-primary)] animate-pulse" />
                  {copy.controlledClub}
                </span>
                {activeClub?.stadium && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[var(--efl-muted)]" />
                      {activeClub.stadium}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 2. OWNED CLUB SWITCHER (Crest-first switching, only if user owns > 1 club) */}
          {secondaryClubs.length > 0 && (
            <div className="flex flex-col items-center sm:items-end gap-1.5 bg-[var(--efl-surface-2)] p-3 rounded-2xl border border-[var(--efl-border)] shrink-0">
              <div className="text-[10px] font-black uppercase tracking-wider text-[var(--efl-text-2)]">
                {copy.switchClub}
              </div>

              <div className="flex items-center gap-2">
                {/* Active Club mini crest */}
                <div
                  className="w-11 h-11 rounded-xl p-1.5 flex items-center justify-center bg-[var(--efl-surface)] ring-2 ring-[var(--efl-primary)] shadow-xs relative"
                  title={`${activeClub?.name} (${copy.activeClub})`}
                >
                  <ClubCrest
                    clubId={activeClub?.id}
                    logoUrl={activeClub?.logoUrl}
                    name={activeClub?.name}
                    shortName={activeClub?.shortName}
                    size="xs"
                    className="w-full h-full object-contain"
                  />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--efl-primary)] ring-1 ring-[var(--efl-surface)]" />
                </div>

                {/* Secondary Owned Clubs */}
                {secondaryClubs.map((club) => (
                  <button
                    key={club.id}
                    type="button"
                    onClick={() => selectCurrentClub(club.id)}
                    title={`${copy.switchClub}: ${club.name}`}
                    aria-label={`${copy.switchClub}: ${club.name}`}
                    className="w-11 h-11 rounded-xl p-1.5 flex items-center justify-center bg-[var(--efl-surface)] hover:bg-[var(--efl-surface-2)] border border-[var(--efl-border)] opacity-80 hover:opacity-100 hover:scale-105 active:scale-95 transition-all duration-180"
                  >
                    <ClubCrest
                      clubId={club.id}
                      logoUrl={club.logoUrl}
                      name={club.name}
                      shortName={club.shortName}
                      size="xs"
                      className="w-full h-full object-contain"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ==============================================================
          3. NEXT MATCH / ACTION REQUIRED
          ============================================================== */}
      {heroMatch && (
        <section className="preview-surface rounded-3xl border border-[var(--efl-border)] p-5 shadow-sm space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between gap-2 border-b border-[var(--efl-border)] pb-3">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--efl-text-2)]">
              <Swords className="w-3.5 h-3.5 text-[var(--efl-primary)]" />
              <span>
                {heroMatch.competitionName || 'Domestic League'} • {copy.matchday} {heroMatch.matchday}
              </span>
            </div>

            {/* Status Pill */}
            {heroMatch.status === 'CONFIRMED' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" /> {t.matchStatusConfirmed}
              </span>
            ) : heroMatch.status === 'DISPUTED' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                <AlertTriangle className="w-3 h-3" /> {t.matchStatusDisputed}
              </span>
            ) : heroMatch.status === 'PENDING_CONFIRMATION' || heroMatch.opponentSubmission ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 animate-pulse">
                <Clock className="w-3 h-3" /> {t.matchStatusPending}
              </span>
            ) : heroMatch.isPlayable === false ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[var(--efl-surface-2)] text-[var(--efl-muted)] border border-[var(--efl-border)]">
                <Lock className="w-3 h-3" /> {copy.matchdayLocked}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <Calendar className="w-3 h-3" /> {t.matchStatusUpcoming}
              </span>
            )}
          </div>

          {/* 3-Column Match Layout */}
          <div className="grid grid-cols-7 items-center gap-2 py-1">
            {/* Home Team (Cols 3) */}
            <div className="col-span-3 flex flex-col sm:flex-row items-center justify-end sm:gap-3 text-center sm:text-right">
              <div className="order-2 sm:order-1 min-w-0">
                <div className="text-xs font-black text-[var(--efl-text)] truncate">
                  {heroMatch.homeClub?.name || 'Home Club'}
                </div>
                <div className="text-[10px] text-[var(--efl-muted)] font-bold uppercase">{copy.homeTag}</div>
              </div>
              <div className="order-1 sm:order-2 w-12 h-12 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] p-1.5 flex items-center justify-center shrink-0 mb-1 sm:mb-0">
                <ClubCrest
                  clubId={heroMatch.homeClubId || heroMatch.homeClub?.id}
                  logoUrl={heroMatch.homeClub?.logoUrl}
                  name={heroMatch.homeClub?.name}
                  shortName={heroMatch.homeClub?.shortName}
                  size="sm"
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* Center Score / VS (Col 1) */}
            <div className="col-span-1 flex flex-col items-center justify-center text-center">
              {heroMatch.status === 'CONFIRMED' ? (
                <div className="text-lg sm:text-2xl font-black text-[var(--efl-text)] tabular-nums tracking-tight font-mono">
                  {heroMatch.homeScore ?? 0} : {heroMatch.awayScore ?? 0}
                </div>
              ) : heroMatch.opponentSubmission ? (
                <div className="text-base sm:text-lg font-black text-amber-500 tabular-nums font-mono">
                  {heroMatch.opponentSubmission.homeScore} : {heroMatch.opponentSubmission.awayScore}
                </div>
              ) : (
                <div className="text-xs sm:text-sm font-black text-[var(--efl-muted)] uppercase tracking-widest">
                  VS
                </div>
              )}
            </div>

            {/* Away Team (Cols 3) */}
            <div className="col-span-3 flex flex-col sm:flex-row items-center justify-start sm:gap-3 text-center sm:text-left">
              <div className="w-12 h-12 rounded-xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] p-1.5 flex items-center justify-center shrink-0 mb-1 sm:mb-0">
                <ClubCrest
                  clubId={heroMatch.awayClubId || heroMatch.awayClub?.id}
                  logoUrl={heroMatch.awayClub?.logoUrl}
                  name={heroMatch.awayClub?.name}
                  shortName={heroMatch.awayClub?.shortName}
                  size="sm"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-black text-[var(--efl-text)] truncate">
                  {heroMatch.awayClub?.name || 'Away Club'}
                </div>
                <div className="text-[10px] text-[var(--efl-muted)] font-bold uppercase">{copy.awayTag}</div>
              </div>
            </div>
          </div>

          {/* Opponent score notification & quick consensus confirmation */}
          {heroMatch.opponentSubmission && heroMatch.status === 'PENDING_CONFIRMATION' && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-2.5">
              <div className="flex items-center justify-between font-black text-amber-600 dark:text-amber-400">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 animate-spin text-amber-500" />
                  <span>
                    {copy.opponentEntered}: {heroMatch.opponentSubmission.homeScore} – {heroMatch.opponentSubmission.awayScore}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isSubmittingQuick}
                  onClick={() =>
                    handleQuickConfirm(
                      heroMatch,
                      heroMatch.opponentSubmission!.homeScore,
                      heroMatch.opponentSubmission!.awayScore
                    )
                  }
                  className="btn-glass-primary flex-1 py-2 text-xs font-black"
                >
                  {copy.confirmOpponent}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFixtureForModal(heroMatch)}
                  className="px-3.5 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-xs font-bold transition-all"
                >
                  {copy.reportDispute}
                </button>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {heroMatch.status !== 'CONFIRMED' && (
              <button
                type="button"
                disabled={heroMatch.isPlayable === false}
                onClick={() => setSelectedFixtureForModal(heroMatch)}
                className={`flex-1 min-h-[40px] py-2.5 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all ${
                  heroMatch.isPlayable === false
                    ? 'bg-[var(--efl-surface-2)] text-[var(--efl-muted)] border border-[var(--efl-border)] cursor-not-allowed'
                    : 'btn-glass-primary'
                }`}
              >
                {heroMatch.isPlayable === false ? (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>{copy.matchdayLocked}</span>
                  </>
                ) : (
                  <>
                    <Swords className="w-3.5 h-3.5" />
                    <span>{heroMatch.userSubmission ? copy.updateResult : copy.submitResult}</span>
                  </>
                )}
              </button>
            )}

            {opponentTelegram && (
              <button
                type="button"
                onClick={() => openTelegramChat(opponentTelegram)}
                className="py-2.5 px-4 rounded-xl text-xs font-bold bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/20 flex items-center justify-center gap-1.5 transition-all min-h-[40px]"
                title={`Telegram @${opponentTelegram}`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>{copy.chatWithOpponent}</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* ==============================================================
          4. MATCHES (Upcoming & Results on a single coherent surface)
          ============================================================== */}
      <section className="preview-surface rounded-3xl border border-[var(--efl-border)] overflow-hidden shadow-sm">
        {/* Section Header & Segmented Tabs */}
        <div className="p-4 sm:p-5 border-b border-[var(--efl-border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-[var(--efl-primary)]" />
            <h2 className="text-sm font-black text-[var(--efl-text)] uppercase tracking-wider">
              {copy.matches}
            </h2>
          </div>

          <div className="flex items-center gap-1 bg-[var(--efl-surface-2)] p-1 rounded-xl border border-[var(--efl-border)] text-xs">
            <button
              type="button"
              onClick={() => setMatchTab('upcoming')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                matchTab === 'upcoming'
                  ? 'bg-[var(--efl-primary)] text-white font-black shadow-xs'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
              }`}
            >
              {copy.upcoming} ({pendingFixtures.length})
            </button>
            <button
              type="button"
              onClick={() => setMatchTab('results')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                matchTab === 'results'
                  ? 'bg-[var(--efl-primary)] text-white font-black shadow-xs'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
              }`}
            >
              {copy.results} ({confirmedFixtures.length})
            </button>
          </div>
        </div>

        {/* Fixture Rows with clean row dividers */}
        <div className="divide-y divide-[var(--efl-border)]">
          {(matchTab === 'upcoming' ? pendingFixtures : confirmedFixtures).length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--efl-muted)]">
              {copy.noMatches}
            </div>
          ) : (
            (matchTab === 'upcoming' ? pendingFixtures : confirmedFixtures).slice(0, 10).map((fixture) => {
              const isHome = fixture.homeClubId === activeClub?.id || fixture.homeClub?.id === activeClub?.id;
              const isAway = fixture.awayClubId === activeClub?.id || fixture.awayClub?.id === activeClub?.id;

              return (
                <div
                  key={fixture.id}
                  onClick={() => {
                    if (fixture.status !== 'CONFIRMED' && fixture.isPlayable !== false) {
                      setSelectedFixtureForModal(fixture);
                    }
                  }}
                  className="p-3 sm:p-4 hover:bg-[var(--efl-surface-2)] transition-colors cursor-pointer flex items-center justify-between gap-2 text-xs"
                >
                  {/* Home Team */}
                  <div className="flex-1 flex items-center justify-end gap-2 text-right min-w-0">
                    <span
                      className={`truncate font-bold ${
                        isHome
                          ? 'text-[var(--efl-primary)] font-black'
                          : 'text-[var(--efl-text)]'
                      }`}
                    >
                      {fixture.homeClub?.shortName || fixture.homeClub?.name || 'Home'}
                    </span>
                    <div className="w-6 h-6 rounded-md bg-[var(--efl-surface-2)] p-0.5 flex items-center justify-center shrink-0">
                      <ClubCrest
                        clubId={fixture.homeClubId || fixture.homeClub?.id}
                        logoUrl={fixture.homeClub?.logoUrl}
                        name={fixture.homeClub?.name}
                        shortName={fixture.homeClub?.shortName}
                        size="xs"
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>

                  {/* Center Score / Time */}
                  <div className="px-2.5 py-1 rounded-lg bg-[var(--efl-surface-2)] text-center min-w-[70px] shrink-0 font-mono tabular-nums">
                    {fixture.status === 'CONFIRMED' ? (
                      <span className="font-black text-[var(--efl-text)] text-xs">
                        {fixture.homeScore ?? 0} : {fixture.awayScore ?? 0}
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-[var(--efl-text-2)]">
                        {copy.matchday} {fixture.matchday}
                      </span>
                    )}
                  </div>

                  {/* Away Team */}
                  <div className="flex-1 flex items-center justify-start gap-2 text-left min-w-0">
                    <div className="w-6 h-6 rounded-md bg-[var(--efl-surface-2)] p-0.5 flex items-center justify-center shrink-0">
                      <ClubCrest
                        clubId={fixture.awayClubId || fixture.awayClub?.id}
                        logoUrl={fixture.awayClub?.logoUrl}
                        name={fixture.awayClub?.name}
                        shortName={fixture.awayClub?.shortName}
                        size="xs"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <span
                      className={`truncate font-bold ${
                        isAway
                          ? 'text-[var(--efl-primary)] font-black'
                          : 'text-[var(--efl-text)]'
                      }`}
                    >
                      {fixture.awayClub?.shortName || fixture.awayClub?.name || 'Away'}
                    </span>
                  </div>

                  {/* Action / Status Pill */}
                  <div className="shrink-0 pl-1 hidden sm:block">
                    {fixture.status === 'CONFIRMED' ? (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        ✓
                      </span>
                    ) : fixture.isPlayable === false ? (
                      <Lock className="w-3.5 h-3.5 text-[var(--efl-muted)]" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--efl-muted)]" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ==============================================================
          5. SEASON SNAPSHOT (One coherent stats surface)
          ============================================================== */}
      <section className="preview-surface rounded-3xl border border-[var(--efl-border)] p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--efl-border)] pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[var(--efl-primary)]" />
            <h2 className="text-sm font-black text-[var(--efl-text)] uppercase tracking-wider">
              {copy.seasonSnapshot}
            </h2>
          </div>
          <span className="text-xs font-bold text-[var(--efl-text-2)]">
            {activeClub?.leagueId ? activeClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase() : 'League Record'}
          </span>
        </div>

        {/* 6-Metric Sports Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          <div className="p-3 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]">
            <span className="text-[10px] font-bold text-[var(--efl-text-2)] uppercase">
              {copy.position}
            </span>
            <div className="text-base sm:text-lg font-black text-[var(--efl-text)] tabular-nums mt-0.5">
              {statsPosition ? `#${statsPosition}` : '—'}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]">
            <span className="text-[10px] font-bold text-[var(--efl-text-2)] uppercase">
              {copy.points}
            </span>
            <div className="text-base sm:text-lg font-black text-[var(--efl-primary)] tabular-nums mt-0.5">
              {statsPoints}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]">
            <span className="text-[10px] font-bold text-[var(--efl-text-2)] uppercase">
              {copy.played}
            </span>
            <div className="text-base sm:text-lg font-black text-[var(--efl-text)] tabular-nums mt-0.5">
              {statsPlayed}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]">
            <span className="text-[10px] font-bold text-[var(--efl-text-2)] uppercase">
              {copy.record}
            </span>
            <div className="text-xs sm:text-sm font-black text-[var(--efl-text)] tabular-nums mt-1 font-mono">
              {statsWon}–{statsDrawn}–{statsLost}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]">
            <span className="text-[10px] font-bold text-[var(--efl-text-2)] uppercase">
              {copy.goals}
            </span>
            <div className="text-xs sm:text-sm font-black text-[var(--efl-text)] tabular-nums mt-1 font-mono">
              {statsGf}:{statsGa}
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)]">
            <span className="text-[10px] font-bold text-[var(--efl-text-2)] uppercase">
              {copy.difference}
            </span>
            <div
              className={`text-xs sm:text-sm font-black tabular-nums mt-1 font-mono ${
                statsGd > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : statsGd < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-[var(--efl-text)]'
              }`}
            >
              {statsGd > 0 ? `+${statsGd}` : statsGd}
            </div>
          </div>
        </div>

        {/* Recent Form row if confirmed fixtures exist */}
        {recentFormList.length > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-[var(--efl-border)] text-xs">
            <span className="text-[11px] font-bold text-[var(--efl-text-2)] uppercase">
              {copy.form}
            </span>
            <div className="flex items-center gap-1.5">
              {recentFormList.map((item, idx) => (
                <span
                  key={idx}
                  className={`w-6 h-6 rounded-md font-black text-[11px] flex items-center justify-center shadow-xs font-mono ${item.bg}`}
                >
                  {item.letter}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ==============================================================
          6. COMPETITION STATUS (Tournaments the active club participates in)
          ============================================================== */}
      <section className="preview-surface rounded-3xl border border-[var(--efl-border)] p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-[var(--efl-border)] pb-3">
          <div className="flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-[var(--efl-primary)]" />
            <h2 className="text-sm font-black text-[var(--efl-text)] uppercase tracking-wider">
              {copy.competitions}
            </h2>
          </div>
        </div>

        <div className="space-y-2">
          {clubCompetitions.map((comp) => {
            const CompIcon = comp.icon;
            return (
              <div
                key={comp.id}
                onClick={() => onNavigateTab(comp.targetTab)}
                className="p-3 sm:p-3.5 rounded-2xl bg-[var(--efl-surface-2)] hover:bg-[var(--efl-surface)] border border-[var(--efl-border)] transition-all flex items-center justify-between gap-3 cursor-pointer group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <CompIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-black text-[var(--efl-text)] truncate group-hover:text-[var(--efl-primary)] transition-colors">
                      {comp.name}
                    </div>
                    <div className="text-[10px] text-[var(--efl-muted)]">{comp.type}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    {comp.stage}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--efl-muted)] group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ==============================================================
          7. ACCOUNT / SETTINGS (Lower in the page, secondary)
          ============================================================== */}
      <section className="preview-surface rounded-3xl border border-[var(--efl-border)] p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex items-center gap-2 border-b border-[var(--efl-border)] pb-3">
          <UserIcon className="w-4 h-4 text-[var(--efl-primary)]" />
          <h2 className="text-sm font-black text-[var(--efl-text)] uppercase tracking-wider">
            {copy.accountSettings}
          </h2>
        </div>

        {/* Telegram User Identity Bar */}
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] flex items-center justify-center text-[var(--efl-muted)] overflow-hidden shrink-0">
            {user?.photoUrl ? (
              <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
            ) : (
              <UserIcon className="w-6 h-6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-[var(--efl-text)] truncate">
                {user?.firstName} {user?.lastName || ''}
              </span>
              {user?.isAdmin && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Admin
                </span>
              )}
            </div>
            <div className="text-xs font-semibold text-[var(--efl-primary)]">
              @{user?.username || 'player'}
            </div>
            <div className="text-[10px] text-[var(--efl-muted)]">
              Telegram ID: {user?.telegramId || user?.id || '—'}
            </div>
          </div>
        </div>

        {/* Appearance Toggle (Light / Dark) */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <div className="text-xs font-bold text-[var(--efl-text)]">
              {copy.appearance}
            </div>
            <div className="text-[11px] text-[var(--efl-text-2)]">
              EFL UZ Premium Broadcast Design
            </div>
          </div>

          <div className="flex items-center gap-1 bg-[var(--efl-surface-2)] p-1 rounded-xl border border-[var(--efl-border)]">
            <button
              type="button"
              onClick={() => onThemeChange?.('light')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                theme === 'light'
                  ? 'bg-[var(--efl-surface)] text-[var(--efl-text)] shadow-xs font-black'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
              }`}
            >
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              <span>{copy.light}</span>
            </button>
            <button
              type="button"
              onClick={() => onThemeChange?.('dark')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                theme === 'dark'
                  ? 'bg-[var(--efl-primary)] text-white shadow-xs font-black'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>{copy.dark}</span>
            </button>
          </div>
        </div>

        {/* Language Selector */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--efl-text)]">
            <Languages className="w-3.5 h-3.5 text-[var(--efl-primary)]" />
            <span>{t.changeLanguage}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {languagesList.map((item) => {
              const isSelected = language === item.code;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setLanguage(item.code)}
                  className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border transition-all text-xs ${
                    isSelected
                      ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-400 font-black shadow-xs'
                      : 'bg-[var(--efl-surface-2)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
                  }`}
                >
                  <span className="text-base">{item.flag}</span>
                  <span className="font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Admin Control Center Link (Only for admins) */}
        {user?.isAdmin && (
          <button
            type="button"
            onClick={() => onNavigateTab('admin')}
            className="w-full text-left p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60 transition-all flex items-center justify-between gap-3 group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-500 flex items-center justify-center shrink-0">
                <SlidersHorizontal className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-black text-[var(--efl-text)] flex items-center gap-2">
                  <span>{copy.adminPanel}</span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-500">
                    Admin
                  </span>
                </div>
                <div className="text-[11px] text-[var(--efl-text-2)] mt-0.5">
                  {copy.adminDesc}
                </div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-amber-500 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}

        {/* Sandbox Dev Profiles Switcher (When in dev mode) */}
        {isDevMode && devProfiles.length > 0 && (
          <div className="p-4 rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[var(--efl-text)]">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>{t.sandboxSwitcher}</span>
            </div>
            <p className="text-[11px] text-[var(--efl-text-2)]">
              {copy.sandboxSubtitle}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {devProfiles.map((prof) => {
                const isSelected = user?.id === prof.id || user?.username === prof.username;
                return (
                  <button
                    key={prof.id}
                    type="button"
                    onClick={() => switchDevUser(prof.id)}
                    className={`flex items-center justify-between p-2 rounded-xl border text-left text-xs transition-all ${
                      isSelected
                        ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-400 font-black'
                        : 'bg-[var(--efl-surface)] border-[var(--efl-border)] text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-blue-500' : 'bg-[var(--efl-muted)]'}`} />
                      <div className="truncate">
                        <div className="font-bold truncate">@{prof.username}</div>
                        <div className="text-[10px] text-[var(--efl-muted)]">
                          {prof.firstName} {prof.isAdmin ? '• Admin' : ''}
                        </div>
                      </div>
                    </div>
                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Result Submission Modal */}
      {selectedFixtureForModal && (
        <ResultSubmissionModal
          fixture={selectedFixtureForModal}
          isOpen={true}
          onClose={() => setSelectedFixtureForModal(null)}
          onSuccess={() => {
            void loadData();
            setSelectedFixtureForModal(null);
          }}
        />
      )}
    </div>
  );
};
