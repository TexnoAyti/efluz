import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, StandingsRow, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { TournamentBracket } from './TournamentBracket';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import {
  Globe2,
  Trophy,
  Award,
  Shield,
  Calendar,
  Sparkles,
  ChevronRight,
  Info,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface ChampionsLeagueViewProps {
  onNavigateTab?: (tab: any) => void;
}

export const ChampionsLeagueView: React.FC<ChampionsLeagueViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, ownedClubs = [], activeSeasonId } = useAuth();
  const { openUserProfile } = useUserProfile();
  const { t } = useI18n();

  const [tournaments, setTournaments] = useState<Competition[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<Competition | null>(null);
  const [standings, setStandings] = useState<StandingsRow[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [activeTab, setActiveTab] = useState<'STANDINGS' | 'BRACKET' | 'QUALIFICATION'>('STANDINGS');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFixtureForSubmit, setSelectedFixtureForSubmit] = useState<Fixture | null>(null);
  const [isGeneratingKnockouts, setIsGeneratingKnockouts] = useState(false);

  const handleGenerateKnockouts = async () => {
    if (!selectedTournament) return;
    setIsGeneratingKnockouts(true);
    try {
      await api.generateKnockoutBracket(selectedTournament.id);
      await loadTournamentDetails(selectedTournament.id, true);
    } catch (err: any) {
      console.error('Failed to generate knockouts:', err);
    } finally {
      setIsGeneratingKnockouts(false);
    }
  };

  const loadEuropeanData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const compsRes = await api.getCompetitions(activeSeasonId);
      const uefaComps = (compsRes.competitions || []).filter(
        (c) =>
          ((c.type === 'EUROPEAN_LEAGUE_PHASE' ||
            c.type === 'EUROPEAN_KNOCKOUT' ||
            c.id.includes('champions') ||
            c.id.includes('europa') ||
            c.id.includes('ucl') ||
            c.id.includes('uel')) &&
          !c.id.includes('conference') &&
          !c.id.includes('uecl'))
      );
      setTournaments(uefaComps);

      if (uefaComps.length > 0) {
        const defaultComp = uefaComps.find((c) => c.id.includes('champions')) || uefaComps[0];
        setSelectedTournament(defaultComp);
        loadTournamentDetails(defaultComp.id);
      }
    } catch (err: any) {
      console.error('Failed to load European tournament data:', err);
      setError("Couldn't load data. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEuropeanData();
  }, [activeSeasonId]);

  const loadTournamentDetails = async (compId: string, loadFix = false) => {
    try {
      const promises: Promise<any>[] = [
        api.getCompetitionStandings(compId).catch(() => ({ standings: [] })),
        api.getCompetitionParticipants(compId).catch(() => ({ participants: [] })),
      ];
      if (loadFix || activeTab === 'BRACKET') {
        promises.push(api.getCompetitionFixtures(compId).catch(() => ({ fixtures: [] })));
      }

      const results = await Promise.all(promises);
      setStandings(results[0]?.standings || []);
      setParticipants(results[1]?.participants || []);
      if (results[2]) {
        setFixtures(results[2]?.fixtures || []);
      }
    } catch (err: any) {
      console.error('Error fetching tournament details:', err);
    }
  };

  const handleSelectTournament = (comp: Competition) => {
    setSelectedTournament(comp);
    loadTournamentDetails(comp.id, activeTab === 'BRACKET');
  };

  const handleTabChange = (tab: 'STANDINGS' | 'BRACKET') => {
    setActiveTab(tab);
    if (tab === 'BRACKET' && selectedTournament && fixtures.length === 0) {
      api.getCompetitionFixtures(selectedTournament.id)
        .then((res) => setFixtures(res.fixtures || []))
        .catch((err) => console.error('Error loading bracket fixtures:', err));
    }
  };

  // Group fixtures by roundName
  const fixturesByRound: Record<string, Fixture[]> = {};
  fixtures.forEach((f) => {
    const round = f.roundName || `Matchday ${f.matchday}`;
    if (!fixturesByRound[round]) {
      fixturesByRound[round] = [];
    }
    fixturesByRound[round].push(f);
  });

  const rounds = Object.keys(fixturesByRound);

  // Authoritative 32-team European Standings mapping
  const displayStandings = useMemo(() => {
    if (standings.length >= 32) return standings;
    if (participants.length > 0) {
      const existingMap = new Map(standings.map((s) => [s.clubId, s]));
      const fullRows: StandingsRow[] = participants.map((p, idx) => {
        const existing = existingMap.get(p.clubId);
        if (existing) return existing;
        return {
          position: p.seedNumber || idx + 1,
          clubId: p.clubId,
          clubName: p.clubName,
          clubLogoUrl: p.clubLogoUrl,
          shortName: p.shortName,
          managerUsername: p.managerUsername,
          managerUserId: p.managerUserId,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          points: 0,
          recentForm: '',
        };
      });

      return fullRows
        .sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
          if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
          return (a.position || 0) - (b.position || 0);
        })
        .map((r, i) => ({ ...r, position: i + 1 }));
    }
    return standings;
  }, [standings, participants]);

  const actualKnockoutFixtures = useMemo(
    () => fixtures.filter((f) =>
      f.id.includes('-po-') ||
      f.id.includes('-r16-') ||
      f.id.includes('-qf-') ||
      f.id.includes('-sf-') ||
      f.id.includes('-final-')
    ),
    [fixtures]
  );

  /**
   * Live knockout projection driven entirely by the current league-phase ranking.
   * It is display-only: no projected node can submit a result or mutate tournament data.
   * Once authoritative knockout fixtures exist, they replace this projection automatically.
   */
  const projectedKnockoutFixtures = useMemo<Fixture[]>(() => {
    if (actualKnockoutFixtures.length > 0 || displayStandings.length < 24 || !selectedTournament) return [];

    const ranked = [...displayStandings]
      .sort((a, b) => (a.position || 999) - (b.position || 999))
      .slice(0, 24);
    if (ranked.length < 24) return [];

    const now = new Date().toISOString();
    const clubFromRow = (row: StandingsRow) => ({
      id: row.clubId,
      name: row.clubName,
      shortName: row.shortName,
      country: '',
      leagueId: '',
      logoUrl: (row as any).clubLogoUrl || (row as any).logoUrl || '',
      active: true,
      managerUsername: row.managerUsername,
      claimedByUserId: row.managerUserId || null,
      claimedByUsername: row.managerUsername || null,
      createdAt: now,
    } as any);
    const baseFixture = (id: string, matchday: number, roundName: string): Fixture => ({
      id,
      seasonId: selectedTournament.seasonId,
      competitionId: selectedTournament.id,
      competitionName: selectedTournament.name,
      matchday,
      roundName,
      homeClubId: null,
      awayClubId: null,
      scheduledAt: now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now,
      ...( { isProjected: true } as any),
    });

    const out: Fixture[] = [];

    // Position-paired play-offs: 9v24, 10v23, ... 16v17.
    for (let i = 0; i < 8; i++) {
      const seeded = ranked[8 + i];
      const unseeded = ranked[23 - i];
      const f = baseFixture(`projection-${selectedTournament.id}-po-m${i}`, 9, 'Knockout Play-offs');
      f.homeClubId = unseeded.clubId;
      f.awayClubId = seeded.clubId;
      f.homeClub = clubFromRow(unseeded);
      f.awayClub = clubFromRow(seeded);
      (f as any).homeSeedPosition = unseeded.position;
      (f as any).awaySeedPosition = seeded.position;
      (f as any).projectionLabel = `#${seeded.position} vs #${unseeded.position}`;
      out.push(f);
    }

    // Top 8 are direct R16 qualifiers. Their opponent is the winner of the
    // corresponding position-paired play-off and updates live as standings move.
    for (let i = 0; i < 8; i++) {
      const direct = ranked[i];
      const seeded = ranked[8 + i];
      const unseeded = ranked[23 - i];
      const f = baseFixture(`projection-${selectedTournament.id}-r16-m${i}`, 10, 'Round of 16');
      f.homeClubId = direct.clubId;
      f.homeClub = clubFromRow(direct);
      f.awayClubId = null;
      f.awaySourceFixtureId = `projection-${selectedTournament.id}-po-m${i}`;
      (f as any).homeSeedPosition = direct.position;
      (f as any).awaySourceLabel = `Winner #${seeded.position} vs #${unseeded.position}`;
      out.push(f);
    }

    for (let i = 0; i < 4; i++) {
      const f = baseFixture(`projection-${selectedTournament.id}-qf-m${i}`, 11, 'Quarter-Finals');
      f.homeSourceFixtureId = `projection-${selectedTournament.id}-r16-m${i * 2}`;
      f.awaySourceFixtureId = `projection-${selectedTournament.id}-r16-m${i * 2 + 1}`;
      (f as any).homeSourceLabel = `Winner R16 • M${i * 2 + 1}`;
      (f as any).awaySourceLabel = `Winner R16 • M${i * 2 + 2}`;
      out.push(f);
    }

    for (let i = 0; i < 2; i++) {
      const f = baseFixture(`projection-${selectedTournament.id}-sf-m${i}`, 12, 'Semi-Finals');
      f.homeSourceFixtureId = `projection-${selectedTournament.id}-qf-m${i * 2}`;
      f.awaySourceFixtureId = `projection-${selectedTournament.id}-qf-m${i * 2 + 1}`;
      (f as any).homeSourceLabel = `Winner QF • M${i * 2 + 1}`;
      (f as any).awaySourceLabel = `Winner QF • M${i * 2 + 2}`;
      out.push(f);
    }

    const final = baseFixture(`projection-${selectedTournament.id}-final-m0`, 13, 'Final');
    final.homeSourceFixtureId = `projection-${selectedTournament.id}-sf-m0`;
    final.awaySourceFixtureId = `projection-${selectedTournament.id}-sf-m1`;
    (final as any).homeSourceLabel = 'Winner SF • M1';
    (final as any).awaySourceLabel = 'Winner SF • M2';
    out.push(final);

    return out;
  }, [actualKnockoutFixtures.length, displayStandings, selectedTournament]);

  const bracketFixtures = actualKnockoutFixtures.length > 0 ? actualKnockoutFixtures : projectedKnockoutFixtures;
  const isLiveProjection = actualKnockoutFixtures.length === 0 && projectedKnockoutFixtures.length > 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Category Quick Switcher Hub */}
      {!user?.isAdmin && onNavigateTab && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => onNavigateTab('leagues')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 hover:text-white min-h-[36px]"
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t.domesticLeagues}</span>
          </button>
          <button
            onClick={() => onNavigateTab('cups')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 hover:text-white min-h-[36px]"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span>{t.nationalCups}</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black bg-blue-600 text-white shadow-md min-h-[36px]"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t.championsLeague}</span>
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="preview-europe-hero preview-surface relative overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/10 p-5 sm:p-6 shadow-xs">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-wider mb-2">
              <Sparkles className="w-3 h-3" />
              <span>{t.uefaClubCompetitions}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {selectedTournament?.name || t.uefaChampionsLeague}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
              {t.uefaSubtitle}
            </p>
          </div>

          {/* Tournament Switcher Buttons */}
          <div className="flex flex-wrap gap-2">
            {tournaments.map((comp) => {
              const isSelected = selectedTournament?.id === comp.id;
              return (
                <button
                  key={comp.id}
                  onClick={() => handleSelectTournament(comp)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 min-h-[36px] ${
                    isSelected
                      ? 'bg-blue-600 text-white font-black shadow-xs'
                      : 'bg-slate-100 dark:bg-[#171e2c] border border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Trophy className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-blue-500'}`} />
                  <span>{comp.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && tournaments.length === 0 && !isLoading && (
        <div className="p-4 rounded-2xl preview-surface border border-rose-500/30 bg-rose-500/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-700 dark:text-rose-300 text-xs shadow-xs">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            <div>
              <div className="font-bold text-xs">Ma’lumotlarni yuklab bo‘lmadi</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Iltimos qayta urinib ko‘ring.</div>
            </div>
          </div>
          <button
            onClick={loadEuropeanData}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shrink-0 shadow-xs transition-colors"
          >
            <span>Qayta urinish</span>
          </button>
        </div>
      )}

      {isLoading && tournaments.length === 0 ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-10 rounded-xl bg-slate-100 dark:bg-white/[0.04] w-1/3" />
          <div className="h-64 rounded-2xl bg-slate-100 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.06]" />
        </div>
      ) : (
        <>
          {/* Segmented Sub-navigation Tabs */}
          <div className="p-1 rounded-2xl bg-[#eef1f5] dark:bg-[#171e2c] border border-[#e2e6ec] dark:border-white/10 flex items-center gap-1 overflow-x-auto scrollbar-none shadow-xs">
            <button
              onClick={() => handleTabChange('STANDINGS')}
              className={`flex-1 min-w-[110px] py-1.5 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === 'STANDINGS'
                  ? 'bg-white dark:bg-[#111722] text-[#2563eb] dark:text-[#3b82f6] shadow-xs font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.leaguePhase} (32)
            </button>
            <button
              onClick={() => handleTabChange('BRACKET')}
              className={`flex-1 min-w-[110px] py-1.5 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === 'BRACKET'
                  ? 'bg-white dark:bg-[#111722] text-[#2563eb] dark:text-[#3b82f6] shadow-xs font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.knockoutBracket} {fixtures.length > 0 ? `(${fixtures.length})` : ''}
            </button>
            <button
              onClick={() => setActiveTab('QUALIFICATION')}
              className={`flex-1 min-w-[110px] py-1.5 px-3 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeTab === 'QUALIFICATION'
                  ? 'bg-white dark:bg-[#111722] text-[#2563eb] dark:text-[#3b82f6] shadow-xs font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.qualificationRules}
            </button>
          </div>

          {/* TAB 1: League Phase Table & Participants */}
          {activeTab === 'STANDINGS' && (
            <div className="space-y-4">
              <div className="preview-surface rounded-2xl border border-slate-200/80 dark:border-white/10 overflow-hidden shadow-xs">
                <div className="p-4 sm:p-5 border-b border-slate-200/80 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                      <Globe2 className="w-4 h-4 text-blue-500" />
                      <span>{selectedTournament?.name || 'Champions League'} - {t.leaguePhase}</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      32 jamoa • 8 tur (4 Uy / 4 Mehmon) • Yakka umumiy liga jadvali
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[10px]">
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-bold">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      <span>1–8: Nimchorak final</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-bold">
                      <span className="w-2 h-2 rounded-full bg-indigo-500" />
                      <span>9–24: O‘tish pley-offi</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-bold">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>25–32: Chiqib ketadi</span>
                    </div>
                  </div>
                </div>

                {standings.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs">
                    {participants.length === 0 ? (
                      <div>
                        <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{t.noEuropeanParticipants}</p>
                        <p className="text-slate-500">{t.europeanQualificationHint}</p>
                      </div>
                    ) : (
                      <p>{t.matchesBeingScheduled}</p>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto -mx-4 sm:mx-0">
                    <table className="w-full text-left text-xs border-collapse min-w-[320px]">
                      <thead>
                        <tr className="border-b border-slate-200/80 dark:border-white/10 bg-slate-50/75 dark:bg-white/[0.03] text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-wider">
                          <th className="py-2.5 px-2.5 w-8 sm:w-10">#</th>
                          <th className="py-2.5 px-2.5">{t.club}</th>
                          <th className="py-2.5 px-2 text-center w-8">{t.p}</th>
                          <th className="py-2.5 px-2 text-center w-8">{t.w}</th>
                          <th className="py-2.5 px-2 text-center w-8 hidden sm:table-cell">{t.d}</th>
                          <th className="py-2.5 px-2 text-center w-8 hidden sm:table-cell">{t.l}</th>
                          <th className="py-2.5 px-2 text-center w-8 hidden md:table-cell">{t.gf}</th>
                          <th className="py-2.5 px-2 text-center w-8 hidden md:table-cell">{t.ga}</th>
                          <th className="py-2.5 px-2 text-center w-9">{t.gd}</th>
                          <th className="py-2.5 px-2.5 text-center w-10 font-black text-blue-600 dark:text-blue-400">{t.pts}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-semibold">
                        {standings.map((row, idx) => {
                          const isDirectRO16 = idx < 8;
                          const isPlayoff = idx >= 8 && idx < 24;
                          const isEliminated = idx >= 24;
                          const isMyClub = ownedClubs.some((c) => c.id === row.clubId) || currentClub?.id === row.clubId;

                          return (
                            <React.Fragment key={row.clubId}>
                              {idx === 8 && (
                                <tr key="divider-playoffs">
                                  <td colSpan={10} className="py-1.5 px-3 bg-indigo-50 dark:bg-indigo-500/15 border-y border-indigo-200 dark:border-indigo-500/30 text-[10px] font-black text-indigo-700 dark:text-indigo-300 tracking-wide">
                                    9–24: O‘tish pley-off bosqichi (Knockout Play-offs)
                                  </td>
                                </tr>
                              )}
                              {idx === 24 && (
                                <tr key="divider-eliminated">
                                  <td colSpan={10} className="py-1.5 px-3 bg-rose-50 dark:bg-rose-500/15 border-y border-rose-200 dark:border-rose-500/30 text-[10px] font-black text-rose-700 dark:text-rose-300 tracking-wide">
                                    25–32: Chiqib ketadi (Turnirni tark etadi)
                                  </td>
                                </tr>
                              )}
                              <tr
                                className={`transition-colors ${
                                  isMyClub
                                    ? 'active-club-highlight bg-blue-500/10 dark:bg-blue-500/15'
                                    : isDirectRO16
                                    ? 'bg-blue-500/5 hover:bg-blue-500/10'
                                    : isPlayoff
                                    ? 'bg-indigo-500/5 hover:bg-indigo-500/10'
                                    : isEliminated
                                    ? 'bg-rose-500/5 hover:bg-rose-500/10'
                                    : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                                }`}
                              >
                                <td className="py-2.5 px-2.5">
                                  <div className="flex items-center gap-1">
                                    <span
                                      className={`w-1 h-3.5 rounded-full ${
                                        isDirectRO16
                                          ? 'bg-blue-500'
                                          : isPlayoff
                                          ? 'bg-indigo-500'
                                          : 'bg-rose-500'
                                      }`}
                                    />
                                    <span className="font-bold text-slate-800 dark:text-slate-200 text-xs tabular-nums">{row.position}</span>
                                  </div>
                                </td>
                                <td className="py-2.5 px-2.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <ClubCrest
                                      clubId={row.clubId}
                                      logoUrl={row.clubLogoUrl}
                                      name={row.clubName}
                                      size="xs"
                                      className="w-4 h-4 sm:w-5 sm:h-5 shrink-0"
                                    />
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <span className={`truncate text-xs ${isMyClub ? 'font-black text-blue-600 dark:text-blue-400' : 'font-bold text-slate-900 dark:text-white'}`}>
                                        {row.clubName}
                                      </span>
                                      {isMyClub && (
                                        <span className="px-1 py-0.2 rounded text-[8px] font-black bg-blue-600 text-white uppercase shrink-0">
                                          Siz
                                        </span>
                                      )}
                                      {(() => {
                                        const ownerInfo = getClubOwnerDisplay(
                                          {
                                            claimedByUserId: row.managerUserId,
                                            claimedByUsername: row.managerUsername,
                                            managerUsername: row.managerUsername,
                                          },
                                          undefined,
                                          row.managerUserId,
                                          t.userNeeded
                                        );
                                        if (ownerInfo.isClaimed && !isMyClub) {
                                          return ownerInfo.userId ? (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openUserProfile(ownerInfo.userId!);
                                              }}
                                              className="text-[10px] text-slate-400 hover:text-blue-500 font-medium truncate max-w-[90px] text-left transition-colors"
                                            >
                                              @{ownerInfo.displayText}
                                            </button>
                                          ) : null;
                                        }
                                        return null;
                                      })()}
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2.5 px-2 text-center text-slate-700 dark:text-slate-300 text-xs tabular-nums">{row.played}</td>
                                <td className="py-2.5 px-2 text-center text-emerald-600 dark:text-emerald-400 text-xs font-bold tabular-nums">{row.won}</td>
                                <td className="py-2.5 px-2 text-center text-amber-600 dark:text-amber-400 text-xs hidden sm:table-cell tabular-nums">{row.drawn}</td>
                                <td className="py-2.5 px-2 text-center text-rose-600 dark:text-rose-400 text-xs hidden sm:table-cell tabular-nums">{row.lost}</td>
                                <td className="py-2.5 px-2 text-center text-slate-500 dark:text-slate-400 text-xs hidden md:table-cell tabular-nums">{row.goalsFor}</td>
                                <td className="py-2.5 px-2 text-center text-slate-500 dark:text-slate-400 text-xs hidden md:table-cell tabular-nums">{row.goalsAgainst}</td>
                                <td className="py-2.5 px-2 text-center font-bold text-xs tabular-nums text-slate-800 dark:text-slate-200">
                                  {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                                </td>
                                <td className="py-2.5 px-2.5 text-center font-black text-blue-600 dark:text-blue-400 text-xs sm:text-sm tabular-nums">
                                  {row.points}
                                </td>
                              </tr>
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Qualified Participants Snapshot List */}
              {participants.length > 0 && (
                <div className="preview-surface p-4 sm:p-5 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-xs space-y-4">
                  <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <span>Qualified Club Roster ({participants.length} Clubs)</span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {participants.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-xl border border-slate-200/80 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] flex items-center justify-between gap-3 shadow-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-white dark:bg-white/5 border border-slate-200/80 dark:border-white/10 p-1 flex items-center justify-center shrink-0">
                            <ClubCrest
                              clubId={p.clubId}
                              logoUrl={p.clubLogoUrl}
                              name={p.clubName}
                              size="xs"
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-black text-slate-900 dark:text-white truncate">{p.clubName}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {p.qualificationReason || p.sourceCompetitionName || 'Domestic Qualification'}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                            Seed #{p.seedNumber || '-'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

      {/* TAB 2: Knockout Bracket & Matches */}
      {activeTab === 'BRACKET' && (
        <div className="space-y-4">
          {isLiveProjection && (
            <div className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.07] px-4 py-3 text-xs text-blue-100 shadow-lg">
              <div className="flex items-center gap-2 font-black uppercase tracking-wider">
                <Sparkles className="h-4 w-4 text-blue-300" />
                Live knockout projection
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                Juftliklar hozirgi liga jadvalidagi o‘rinlarga qarab avtomatik yangilanadi: 9–24, 10–23, 11–22 … 16–17. Liga bosqichi tugagach final jadval bo‘yicha rasmiy bracket yaratiladi.
              </p>
            </div>
          )}

          <TournamentBracket
            fixtures={bracketFixtures}
            currentClubId={currentClub?.id}
            userId={user?.id}
            onSelectFixture={isLiveProjection ? undefined : (f) => setSelectedFixtureForSubmit(f)}
            competition={selectedTournament}
          />

          {bracketFixtures.length === 0 && (
            <div className="glass-panel p-5 rounded-2xl border-indigo-500/30 bg-indigo-950/20 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-indigo-400 mx-auto" />
              <h4 className="text-sm font-bold text-white">Knockout bosqichi kutilmoqda</h4>
              <p className="text-xs text-slate-300 max-w-md mx-auto">
                32 jamoalik Liga bosqichi yakunlangach, 1–8-o‘rinlar to‘g‘ridan-to‘g‘ri Nimchorak finalga yo‘l oladi,
                9–24-o‘rinlar esa 8 ta Play-off juftligida bellashadi.
              </p>
              {user?.isAdmin && (
                <button
                  type="button"
                  onClick={handleGenerateKnockouts}
                  disabled={isGeneratingKnockouts}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all disabled:opacity-50 inline-flex items-center gap-2"
                >
                  <Trophy className="w-3.5 h-3.5" />
                  <span>{isGeneratingKnockouts ? 'Generatsiya qilinmoqda...' : 'Knockout to‘rini generatsiya qilish'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {selectedFixtureForSubmit && (
        <ResultSubmissionModal
          fixture={selectedFixtureForSubmit}
          onClose={() => setSelectedFixtureForSubmit(null)}
          onSuccess={() => {
            setSelectedFixtureForSubmit(null);
            if (selectedTournament) {
              loadTournamentDetails(selectedTournament.id, true);
            }
          }}
        />
      )}

      {/* TAB 3: European Qualification Breakdown */}
      {activeTab === 'QUALIFICATION' && (
        <div className="preview-surface p-5 sm:p-6 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-xs space-y-4">
          <h3 className="text-sm sm:text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-500" />
            <span>European Allocation Formula (32-Team Single League Phase)</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 text-xs">
            <div className="p-4 rounded-xl border border-slate-200/80 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] space-y-2">
              <div className="font-black text-blue-600 dark:text-blue-400 text-sm">UEFA Champions League (32 Clubs Total)</div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 text-xs">
                <li>• Premier League: 7 spots (1st – 7th)</li>
                <li>• La Liga: 7 spots (1st – 7th)</li>
                <li>• Serie A: 6 spots (1st – 6th)</li>
                <li>• Bundesliga: 6 spots (1st – 6th)</li>
                <li>• Ligue 1: 6 spots (1st – 6th)</li>
                <li>• Format: 32-Team Single League Phase, 8 Matchdays (4H / 4A)</li>
                <li>• Top 8: Direct to Round of 16 | 9th–24th: Knockout Play-offs | 25th–32nd: Eliminated</li>
              </ul>
            </div>

            <div className="p-4 rounded-xl border border-slate-200/80 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] space-y-2">
              <div className="font-black text-indigo-600 dark:text-indigo-400 text-sm">UEFA Europa League (32 Clubs Total)</div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-400 text-xs">
                <li>• Premier League: 7 spots (8th – 14th)</li>
                <li>• La Liga: 7 spots (8th – 14th)</li>
                <li>• Serie A: 6 spots (7th – 12th)</li>
                <li>• Bundesliga: 6 spots (7th – 12th)</li>
                <li>• Ligue 1: 6 spots (7th – 12th)</li>
                <li>• Format: 32-Team Single League Phase, 8 Matchdays (4H / 4A)</li>
                <li>• Top 8: Direct to Round of 16 | 9th–24th: Knockout Play-offs | 25th–32nd: Eliminated</li>
              </ul>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
