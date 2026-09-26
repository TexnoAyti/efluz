import { getFirestoreDb } from '../firebase/admin';
import {
  COLLECTIONS,
  FirestoreCompetitionDoc,
  FirestoreFixtureDoc,
  FirestoreCompetitionParticipantDoc,
  FirestoreClubDoc,
} from '../firebase/collections';
import { createAuditLog } from '../services/adminService';
import { notifySmartCupAdvancement, notifySmartCupChampion } from '../services/smartNotificationService';
import {
  redisGetRaw,
  redisSetRaw,
  invalidateDataset,
  invalidateFixtureReadModels,
  refreshChangedFixtureReadModel,
  getLkgKey,
  ReadModelKeys,
  ReadModelSnapshot,
  SCHEMA_VERSION,
} from '../readModel/readModelStore';
import { SEED_CLUBS, SEED_LEAGUES } from '../db/seed';
import { queryAll, queryGet, queryRun } from '../db';
import { firestoreCircuitBreaker } from '../firebase/firestoreStore';

export interface DomesticCupConfig {
  id: string;
  name: string;
  country: string;
  leagueId: string;
  expectedTeams: number;
}

export const DOMESTIC_CUPS: Record<string, DomesticCupConfig> = {
  'comp-fa-cup-2026': {
    id: 'comp-fa-cup-2026',
    name: 'FA Cup',
    country: 'England',
    leagueId: 'league-premier-league',
    expectedTeams: 20,
  },
  'comp-copa-del-rey-2026': {
    id: 'comp-copa-del-rey-2026',
    name: 'Copa del Rey',
    country: 'Spain',
    leagueId: 'league-la-liga',
    expectedTeams: 20,
  },
  'comp-coppa-italia-2026': {
    id: 'comp-coppa-italia-2026',
    name: 'Coppa Italia',
    country: 'Italy',
    leagueId: 'league-serie-a',
    expectedTeams: 20,
  },
  'comp-dfb-pokal-2026': {
    id: 'comp-dfb-pokal-2026',
    name: 'DFB-Pokal',
    country: 'Germany',
    leagueId: 'league-bundesliga',
    expectedTeams: 18,
  },
  'comp-coupe-de-france-2026': {
    id: 'comp-coupe-de-france-2026',
    name: 'Coupe de France',
    country: 'France',
    leagueId: 'league-ligue-1',
    expectedTeams: 18,
  },
};

export function isDomesticCup(competitionId: string): boolean {
  if (competitionId.toLowerCase().includes('efl-cup') || competitionId.toLowerCase().includes('carabao')) {
    return false;
  }
  return Boolean(DOMESTIC_CUPS[competitionId]);
}

export function validateDomesticCupId(competitionId: string): DomesticCupConfig {
  if (competitionId.toLowerCase().includes('efl-cup') || competitionId.toLowerCase().includes('carabao')) {
    throw new Error('EFL Cup is strictly excluded from domestic cup administration.');
  }
  const cup = DOMESTIC_CUPS[competitionId];
  if (!cup) {
    throw new Error(`Invalid domestic cup ID '${competitionId}'. Must be one of: ${Object.keys(DOMESTIC_CUPS).join(', ')}`);
  }
  return cup;
}

export interface CupBracketNode {
  id: string; // Alias for fixtureId
  fixtureId: string;
  matchday: number;
  roundName: string;
  homeClubId: string | null;
  homeClubName: string;
  homeClubBadge?: string;
  awayClubId: string | null;
  awayClubName: string;
  awayClubBadge?: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore?: number | null;
  awayPenaltyScore?: number | null;
  winnerClubId: string | null;
  winnerClubName?: string;
  scheduledAt: string;
  resultConfirmedAt: string | null;
  sourceFixtureId?: string | null;
  sourceWinnerSlot?: string | null;
  homeSourceFixtureId?: string | null;
  awaySourceFixtureId?: string | null;
  homeSourceWinnerSlot?: string | null;
  awaySourceWinnerSlot?: string | null;
}

export interface CupBracketRound {
  roundNumber: number;
  roundName: string;
  matches: CupBracketNode[];
  fixtures: CupBracketNode[]; // Alias for matches
  matchesCount: number;
  totalMatches: number; // Alias for matchesCount
  completedCount: number;
  completedMatches: number; // Alias for completedCount
}

export interface DomesticCupDetails {
  competition: {
    id: string;
    name: string;
    type: string;
    seasonId: string;
    status: string;
    hasFixtures: boolean;
    fixtureCount: number;
    fixturesCount: number; // Alias
    currentMatchday: number;
    isMatchdayOpen: boolean;
    nextMatchdayOpenAt?: string;
    matchdayOverrideStatus?: string;
  };
  totalTeams: number;
  totalParticipants: number; // Alias
  participantsCount: number; // Alias
  expectedTeams: number; // Alias
  participants: Array<{
    clubId: string;
    clubName: string;
    badgeUrl?: string;
    seedNumber?: number;
    ownerUserId?: string;
    ownerUsername?: string;
  }>;
  rounds: CupBracketRound[];
  fixturesCount: number;
  totalFixtures: number; // Alias
  completedFixturesCount: number;
  completedFixtures: number; // Alias
  totalMatches: number; // Alias
  completedMatches: number; // Alias
  bracketStatus: 'NOT_GENERATED' | 'IN_PROGRESS' | 'COMPLETED';
  currentRound?: number;
  currentRoundName?: string;
  isMatchdayLocked?: boolean;
  source: 'firestore' | 'redis-lkg' | 'sqlite';
  degraded: boolean;
}

export interface BracketPreviewMatch {
  roundNumber: number;
  roundName: string;
  matchIndex: number;
  fixtureId: string;
  homeClubId: string | null;
  homeClubName: string;
  awayClubId: string | null;
  awayClubName: string;
  homeClub?: { id: string | null; name: string } | null;
  awayClub?: { id: string | null; name: string } | null;
  sourceFixtureId?: string | null;
  sourceWinnerSlot?: string | null;
  homeSourceFixtureId?: string | null;
  awaySourceFixtureId?: string | null;
  homeSourceWinnerSlot?: string | null;
  awaySourceWinnerSlot?: string | null;
}

export interface BracketPreviewRound {
  roundNumber: number;
  roundName: string;
  matchesCount: number;
  totalMatches: number;
  pairings: Array<{
    homeClub: { id: string | null; name: string };
    awayClub: { id: string | null; name: string };
    fixtureId?: string;
  }>;
  matches: BracketPreviewMatch[];
}

export interface BracketPreviewResult {
  competitionId: string;
  competitionName: string;
  totalTeams: number;
  totalParticipants: number; // Alias
  prelimMatches: number;
  byeTeamsCount: number;
  totalRounds: number;
  roundsCount: number; // Alias
  existingFixturesCount: number;
  canGenerate: boolean;
  blockReason?: string;
  previewMatches: BracketPreviewMatch[];
  rounds: BracketPreviewRound[];
}

/**
 * Returns complete domestic cup details including bracket nodes, participants, and matchday controls.
 */
export async function getDomesticCupDetails(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<DomesticCupDetails> {
  const cupConfig = validateDomesticCupId(competitionId);

  // 1. Try tiered read from Read Model (Memory -> Fresh Redis -> Firestore -> LKG Redis)
  const cacheKey = `cup:bracket:${competitionId}:${seasonId}`;
  const rawLkg = await redisGetRaw<DomesticCupDetails>(cacheKey);

  if (rawLkg?.data && (!firestoreCircuitBreaker.canExecute() || rawLkg.data.rounds?.length > 0)) {
    // If circuit breaker is open or we have valid LKG data
    if (!firestoreCircuitBreaker.canExecute()) {
      return {
        ...rawLkg.data,
        source: 'redis-lkg',
        degraded: true,
      };
    }
  }

  // 2. Fetch authoritative details from Firestore
  try {
    const db = getFirestoreDb();
    const [compDoc, partSnap, fixSnap, occSnap] = await Promise.all([
      db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get(),
      db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId', '==', competitionId).get(),
      db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get(),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId', '==', seasonId).get(),
    ]);

    const compData = compDoc.exists ? (compDoc.data() as FirestoreCompetitionDoc) : null;
    const occupancyUserMap = new Map<string, string>();
    for (const d of occSnap.docs) {
      const occ = d.data();
      if (occ.clubId && occ.userId) {
        occupancyUserMap.set(occ.clubId, occ.userId);
      }
    }

    const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));

    // Participants
    const participants: DomesticCupDetails['participants'] = [];
    if (!partSnap.empty) {
      for (const d of partSnap.docs) {
        const part = d.data() as FirestoreCompetitionParticipantDoc;
        const club = clubsMap.get(part.clubId);
        participants.push({
          clubId: part.clubId,
          clubName: club?.name || part.clubId,
          badgeUrl: club?.logoUrl,
          seedNumber: part.seedNumber,
          ownerUserId: part.ownerUserId || occupancyUserMap.get(part.clubId),
        });
      }
    } else {
      // Fallback: populate from league clubs
      const leagueClubs = SEED_CLUBS.filter((c) => c.leagueId === cupConfig.leagueId);
      for (const c of leagueClubs) {
        participants.push({
          clubId: c.id,
          clubName: c.name,
          badgeUrl: c.logoUrl,
          ownerUserId: occupancyUserMap.get(c.id),
        });
      }
    }

    // Fixtures & Rounds
    const fixtures = fixSnap.docs.map((d) => d.data() as FirestoreFixtureDoc);
    const roundMap = new Map<number, CupBracketNode[]>();

    const getRoundTitle = (md: number, totalRounds: number) => {
      if (md === totalRounds) return 'Final';
      if (md === totalRounds - 1) return 'Semi-Finals';
      if (md === totalRounds - 2) return 'Quarter-Finals';
      if (md === totalRounds - 3) return 'Round of 16';
      return `Round ${md}`;
    };

    const maxMatchday = Math.max(1, ...fixtures.map((f) => f.matchday || 1));

    for (const f of fixtures) {
      const md = f.matchday || 1;
      const rawHomeId = f.homeClubId;
      const rawAwayId = f.awayClubId;
      const homeClubId = (!rawHomeId || rawHomeId === 'TBD') ? null : rawHomeId;
      const awayClubId = (!rawAwayId || rawAwayId === 'TBD') ? null : rawAwayId;
      const homeClub = homeClubId ? clubsMap.get(homeClubId) : null;
      const awayClub = awayClubId ? clubsMap.get(awayClubId) : null;
      const winnerClub = f.winnerClubId ? clubsMap.get(f.winnerClubId) : null;

      const node: CupBracketNode = {
        id: f.id,
        fixtureId: f.id,
        matchday: md,
        roundName: f.roundName || getRoundTitle(md, maxMatchday),
        homeClubId,
        homeClubName: homeClub?.name || 'TBD',
        homeClubBadge: homeClub?.logoUrl,
        awayClubId,
        awayClubName: awayClub?.name || 'TBD',
        awayClubBadge: awayClub?.logoUrl,
        status: f.status,
        homeScore: f.homeScore,
        awayScore: f.awayScore,
        homePenaltyScore: (f as any).homePenaltyScore ?? null,
        awayPenaltyScore: (f as any).awayPenaltyScore ?? null,
        winnerClubId: f.winnerClubId,
        winnerClubName: winnerClub?.name,
        scheduledAt: f.scheduledAt,
        resultConfirmedAt: f.resultConfirmedAt || null,
        sourceFixtureId: (f as any).sourceFixtureId || null,
        sourceWinnerSlot: (f as any).sourceWinnerSlot || null,
        homeSourceFixtureId: (f as any).homeSourceFixtureId || null,
        awaySourceFixtureId: (f as any).awaySourceFixtureId || null,
        homeSourceWinnerSlot: (f as any).homeSourceWinnerSlot || null,
        awaySourceWinnerSlot: (f as any).awaySourceWinnerSlot || null,
      };

      if (!roundMap.has(md)) {
        roundMap.set(md, []);
      }
      roundMap.get(md)!.push(node);
    }

    const rounds: CupBracketRound[] = Array.from(roundMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNumber, matches]) => {
        const sortedMatches = matches.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
        const completedCount = sortedMatches.filter((m) => m.status === 'CONFIRMED').length;
        return {
          roundNumber,
          roundName: sortedMatches[0]?.roundName || `Round ${roundNumber}`,
          matches: sortedMatches,
          fixtures: sortedMatches,
          matchesCount: sortedMatches.length,
          totalMatches: sortedMatches.length,
          completedCount,
          completedMatches: completedCount,
        };
      });

    const completedCount = fixtures.filter((f) => f.status === 'CONFIRMED').length;
    const bracketStatus = fixtures.length === 0
      ? 'NOT_GENERATED'
      : (completedCount === fixtures.length ? 'COMPLETED' : 'IN_PROGRESS');

    const result: DomesticCupDetails = {
      competition: {
        id: competitionId,
        name: compData?.name || cupConfig.name,
        type: compData?.type || 'KNOCKOUT',
        seasonId: compData?.seasonId || seasonId,
        status: compData?.status || 'active',
        hasFixtures: fixtures.length > 0,
        fixtureCount: fixtures.length,
        fixturesCount: fixtures.length,
        currentMatchday: compData?.currentMatchday || 1,
        isMatchdayOpen: compData?.isMatchdayOpen ?? true,
        nextMatchdayOpenAt: compData?.nextMatchdayOpenAt,
        matchdayOverrideStatus: compData?.adminOverrideStatus,
      },
      totalTeams: participants.length,
      totalParticipants: participants.length,
      participantsCount: participants.length,
      expectedTeams: cupConfig.expectedTeams,
      participants,
      rounds,
      fixturesCount: fixtures.length,
      totalFixtures: fixtures.length,
      completedFixturesCount: completedCount,
      completedFixtures: completedCount,
      totalMatches: fixtures.length,
      completedMatches: completedCount,
      bracketStatus,
      currentRound: compData?.currentMatchday || 1,
      currentRoundName: rounds.find((r) => r.roundNumber === (compData?.currentMatchday || 1))?.roundName || 'Round 1',
      isMatchdayLocked: !(compData?.isMatchdayOpen ?? true),
      source: 'firestore',
      degraded: false,
    };

    // Save into Read Model snapshot (LKG + fresh)
    await redisSetRaw(
      cacheKey,
      {
        data: result,
        schemaVersion: SCHEMA_VERSION,
        sourceVersion: 'firestore-authoritative',
        expectedCount: result.rounds.length,
      },
      86400
    );

    return result;
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);

    // Fallback to SQLite
    const compRow = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    const fixRows = queryAll<any>(
      'SELECT * FROM fixtures WHERE competition_id = ? ORDER BY matchday ASC, id ASC',
      [competitionId]
    );

    const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
    const roundMap = new Map<number, CupBracketNode[]>();

    for (const f of fixRows) {
      const md = f.matchday || 1;
      const rawHomeId = f.home_club_id;
      const rawAwayId = f.away_club_id;
      const homeClubId = (!rawHomeId || rawHomeId === 'TBD') ? null : rawHomeId;
      const awayClubId = (!rawAwayId || rawAwayId === 'TBD') ? null : rawAwayId;
      const homeClub = homeClubId ? clubsMap.get(homeClubId) : null;
      const awayClub = awayClubId ? clubsMap.get(awayClubId) : null;
      const winnerClub = f.winner_club_id ? clubsMap.get(f.winner_club_id) : null;

      const node: CupBracketNode = {
        id: f.id,
        fixtureId: f.id,
        matchday: md,
        roundName: f.round_name || `Round ${md}`,
        homeClubId,
        homeClubName: homeClub?.name || 'TBD',
        homeClubBadge: homeClub?.logoUrl,
        awayClubId,
        awayClubName: awayClub?.name || 'TBD',
        awayClubBadge: awayClub?.logoUrl,
        status: f.status,
        homeScore: f.home_score,
        awayScore: f.away_score,
        homePenaltyScore: f.home_penalty_score ?? null,
        awayPenaltyScore: f.away_penalty_score ?? null,
        winnerClubId: f.winner_club_id,
        winnerClubName: winnerClub?.name,
        scheduledAt: f.scheduled_at,
        resultConfirmedAt: f.result_confirmed_at,
        sourceFixtureId: f.source_fixture_id || null,
        sourceWinnerSlot: f.source_winner_slot || null,
      };

      if (!roundMap.has(md)) roundMap.set(md, []);
      roundMap.get(md)!.push(node);
    }

    const rounds: CupBracketRound[] = Array.from(roundMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNumber, matches]) => {
        const sorted = matches.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
        const completed = sorted.filter((m) => m.status === 'CONFIRMED').length;
        return {
          roundNumber,
          roundName: sorted[0]?.roundName || `Round ${roundNumber}`,
          matches: sorted,
          fixtures: sorted,
          matchesCount: sorted.length,
          totalMatches: sorted.length,
          completedCount: completed,
          completedMatches: completed,
        };
      });

    const completedCount = fixRows.filter((f) => f.status === 'CONFIRMED').length;
    const bracketStatus = fixRows.length === 0
      ? 'NOT_GENERATED'
      : (completedCount === fixRows.length ? 'COMPLETED' : 'IN_PROGRESS');

    return {
      competition: {
        id: competitionId,
        name: compRow?.name || cupConfig.name,
        type: compRow?.type || 'KNOCKOUT',
        seasonId: compRow?.season_id || seasonId,
        status: compRow?.status || 'active',
        hasFixtures: fixRows.length > 0,
        fixtureCount: fixRows.length,
        fixturesCount: fixRows.length,
        currentMatchday: compRow?.current_matchday || 1,
        isMatchdayOpen: Boolean(compRow?.is_matchday_open ?? 1),
        nextMatchdayOpenAt: compRow?.next_matchday_open_at,
        matchdayOverrideStatus: compRow?.matchday_override_status,
      },
      totalTeams: cupConfig.expectedTeams,
      totalParticipants: cupConfig.expectedTeams,
      participantsCount: cupConfig.expectedTeams,
      expectedTeams: cupConfig.expectedTeams,
      participants: SEED_CLUBS.filter((c) => c.leagueId === cupConfig.leagueId).map((c) => ({
        clubId: c.id,
        clubName: c.name,
        badgeUrl: c.logoUrl,
      })),
      rounds,
      fixturesCount: fixRows.length,
      totalFixtures: fixRows.length,
      completedFixturesCount: completedCount,
      completedFixtures: completedCount,
      totalMatches: fixRows.length,
      completedMatches: completedCount,
      bracketStatus,
      currentRound: compRow?.current_matchday || 1,
      currentRoundName: rounds.find((r) => r.roundNumber === (compRow?.current_matchday || 1))?.roundName || 'Round 1',
      isMatchdayLocked: !Boolean(compRow?.is_matchday_open ?? 1),
      source: 'sqlite',
      degraded: true,
    };
  }
}

/**
 * Previews bracket generation without changing any documents in the database.
 */
export async function previewDomesticCupBracket(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<BracketPreviewResult> {
  const cupConfig = validateDomesticCupId(competitionId);
  const db = getFirestoreDb();

  // 1. Preconditions check: verify existing fixtures
  const existingFixSnap = await db
    .collection(COLLECTIONS.FIXTURES)
    .where('competitionId', '==', competitionId)
    .get();

  const existingCount = existingFixSnap.size;

  // 2. Fetch participating clubs
  const leagueClubs = SEED_CLUBS.filter((c) => c.leagueId === cupConfig.leagueId).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const clubIds = leagueClubs.map((c) => c.id);
  const totalTeams = clubIds.length;

  const prelimMatches = totalTeams > 16 ? totalTeams - 16 : 0; // 4 for 20 teams, 2 for 18 teams
  const byeTeamsCount = totalTeams - prelimMatches * 2; // 12 for 20 teams, 14 for 18 teams
  const pureByeMatches = totalTeams > 16 ? (byeTeamsCount - prelimMatches) / 2 : 8; // 4 for 20 teams, 6 for 18 teams, 8 for 16 teams
  const totalRounds = totalTeams > 16 ? 5 : 4;

  const previewMatches: BracketPreviewMatch[] = [];
  const roundsStructured: BracketPreviewRound[] = [];

  if (totalTeams > 16) {
    // Round 1 (Preliminary / Play-in)
    const r1Matches: BracketPreviewMatch[] = [];
    for (let i = 0; i < prelimMatches; i++) {
      const homeClub = leagueClubs[byeTeamsCount + i * 2];
      const awayClub = leagueClubs[byeTeamsCount + i * 2 + 1];
      const m: BracketPreviewMatch = {
        roundNumber: 1,
        roundName: 'Preliminary Round',
        matchIndex: i,
        fixtureId: `fix-${competitionId}-r1-m${i}`,
        homeClubId: homeClub?.id || null,
        homeClubName: homeClub?.name || 'TBD',
        awayClubId: awayClub?.id || null,
        awayClubName: awayClub?.name || 'TBD',
        homeClub: homeClub ? { id: homeClub.id, name: homeClub.name } : null,
        awayClub: awayClub ? { id: awayClub.id, name: awayClub.name } : null,
        sourceFixtureId: null,
        sourceWinnerSlot: null,
        homeSourceFixtureId: null,
        awaySourceFixtureId: null,
        homeSourceWinnerSlot: null,
        awaySourceWinnerSlot: null,
      };
      previewMatches.push(m);
      r1Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 1,
      roundName: 'Preliminary Round',
      matchesCount: r1Matches.length,
      totalMatches: r1Matches.length,
      pairings: r1Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r1Matches,
    });

    // Round 2 (Round of 16 - 8 matches)
    const r2Matches: BracketPreviewMatch[] = [];
    for (let i = 0; i < 8; i++) {
      let homeId: string | null = null;
      let homeName = 'TBD';
      let awayId: string | null = null;
      let awayName = 'TBD';
      let homeClubObj: { id: string | null; name: string } | null = null;
      let awayClubObj: { id: string | null; name: string } | null = null;
      let sourceFixtureId: string | null = null;
      let sourceWinnerSlot: string | null = null;
      let homeSourceFixtureId: string | null = null;
      let awaySourceFixtureId: string | null = null;
      let homeSourceWinnerSlot: string | null = null;
      let awaySourceWinnerSlot: string | null = null;

      if (i < pureByeMatches) {
        const homeClub = leagueClubs[i * 2];
        const awayClub = leagueClubs[i * 2 + 1];
        homeId = homeClub?.id || null;
        homeName = homeClub?.name || 'TBD';
        awayId = awayClub?.id || null;
        awayName = awayClub?.name || 'TBD';
        homeClubObj = homeClub ? { id: homeClub.id, name: homeClub.name } : null;
        awayClubObj = awayClub ? { id: awayClub.id, name: awayClub.name } : null;
      } else {
        const k = i - pureByeMatches;
        const byeClub = leagueClubs[pureByeMatches * 2 + k];
        const srcFixId = `fix-${competitionId}-r1-m${k}`;
        homeId = byeClub?.id || null;
        homeName = byeClub?.name || 'TBD';
        awayId = null;
        awayName = `Winner R1-M${k}`;
        homeClubObj = byeClub ? { id: byeClub.id, name: byeClub.name } : null;
        awayClubObj = null;
        sourceFixtureId = srcFixId;
        sourceWinnerSlot = 'away';
        awaySourceFixtureId = srcFixId;
        awaySourceWinnerSlot = 'away';
      }

      const m: BracketPreviewMatch = {
        roundNumber: 2,
        roundName: 'Round of 16',
        matchIndex: i,
        fixtureId: `fix-${competitionId}-r2-m${i}`,
        homeClubId: homeId,
        homeClubName: homeName,
        awayClubId: awayId,
        awayClubName: awayName,
        homeClub: homeClubObj,
        awayClub: awayClubObj,
        sourceFixtureId,
        sourceWinnerSlot,
        homeSourceFixtureId,
        awaySourceFixtureId,
        homeSourceWinnerSlot,
        awaySourceWinnerSlot,
      };
      previewMatches.push(m);
      r2Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 2,
      roundName: 'Round of 16',
      matchesCount: r2Matches.length,
      totalMatches: r2Matches.length,
      pairings: r2Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r2Matches,
    });

    // Subsequent rounds (QF, SF, Final)
    // Round 3: Quarter-Finals (4 matches, fed by R2 pairs)
    const r3Matches: BracketPreviewMatch[] = [];
    for (let mIdx = 0; mIdx < 4; mIdx++) {
      const homeSource = `fix-${competitionId}-r2-m${mIdx * 2}`;
      const awaySource = `fix-${competitionId}-r2-m${mIdx * 2 + 1}`;
      const m: BracketPreviewMatch = {
        roundNumber: 3,
        roundName: 'Quarter-Finals',
        matchIndex: mIdx,
        fixtureId: `fix-${competitionId}-r3-m${mIdx}`,
        homeClubId: null,
        homeClubName: `Winner R2-M${mIdx * 2}`,
        awayClubId: null,
        awayClubName: `Winner R2-M${mIdx * 2 + 1}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: 'home',
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: 'home',
        awaySourceWinnerSlot: 'away',
      };
      previewMatches.push(m);
      r3Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 3,
      roundName: 'Quarter-Finals',
      matchesCount: r3Matches.length,
      totalMatches: r3Matches.length,
      pairings: r3Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r3Matches,
    });

    // Round 4: Semi-Finals (2 matches, fed by R3 pairs)
    const r4Matches: BracketPreviewMatch[] = [];
    for (let mIdx = 0; mIdx < 2; mIdx++) {
      const homeSource = `fix-${competitionId}-r3-m${mIdx * 2}`;
      const awaySource = `fix-${competitionId}-r3-m${mIdx * 2 + 1}`;
      const m: BracketPreviewMatch = {
        roundNumber: 4,
        roundName: 'Semi-Finals',
        matchIndex: mIdx,
        fixtureId: `fix-${competitionId}-r4-m${mIdx}`,
        homeClubId: null,
        homeClubName: `Winner QF-M${mIdx * 2}`,
        awayClubId: null,
        awayClubName: `Winner QF-M${mIdx * 2 + 1}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: 'home',
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: 'home',
        awaySourceWinnerSlot: 'away',
      };
      previewMatches.push(m);
      r4Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 4,
      roundName: 'Semi-Finals',
      matchesCount: r4Matches.length,
      totalMatches: r4Matches.length,
      pairings: r4Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r4Matches,
    });

    // Round 5: Final (1 match, fed by R4 pair)
    const r5HomeSource = `fix-${competitionId}-r4-m0`;
    const r5AwaySource = `fix-${competitionId}-r4-m1`;
    const r5Matches: BracketPreviewMatch[] = [
      {
        roundNumber: 5,
        roundName: 'Final',
        matchIndex: 0,
        fixtureId: `fix-${competitionId}-r5-m0`,
        homeClubId: null,
        homeClubName: 'Winner SF-M0',
        awayClubId: null,
        awayClubName: 'Winner SF-M1',
        homeClub: null,
        awayClub: null,
        sourceFixtureId: r5HomeSource,
        sourceWinnerSlot: 'home',
        homeSourceFixtureId: r5HomeSource,
        awaySourceFixtureId: r5AwaySource,
        homeSourceWinnerSlot: 'home',
        awaySourceWinnerSlot: 'away',
      },
    ];
    previewMatches.push(r5Matches[0]);
    roundsStructured.push({
      roundNumber: 5,
      roundName: 'Final',
      matchesCount: 1,
      totalMatches: 1,
      pairings: r5Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r5Matches,
    });
  } else {
    // 16-Team direct knockout
    const r1Matches: BracketPreviewMatch[] = [];
    for (let i = 0; i < 8; i++) {
      const homeClub = leagueClubs[i * 2];
      const awayClub = leagueClubs[i * 2 + 1];
      const m: BracketPreviewMatch = {
        roundNumber: 1,
        roundName: 'Round of 16',
        matchIndex: i,
        fixtureId: `fix-${competitionId}-r1-m${i}`,
        homeClubId: homeClub?.id || null,
        homeClubName: homeClub?.name || 'TBD',
        awayClubId: awayClub?.id || null,
        awayClubName: awayClub?.name || 'TBD',
        homeClub: homeClub ? { id: homeClub.id, name: homeClub.name } : null,
        awayClub: awayClub ? { id: awayClub.id, name: awayClub.name } : null,
        sourceFixtureId: null,
        sourceWinnerSlot: null,
        homeSourceFixtureId: null,
        awaySourceFixtureId: null,
        homeSourceWinnerSlot: null,
        awaySourceWinnerSlot: null,
      };
      previewMatches.push(m);
      r1Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 1,
      roundName: 'Round of 16',
      matchesCount: r1Matches.length,
      totalMatches: r1Matches.length,
      pairings: r1Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r1Matches,
    });

    // Subsequent rounds (QF, SF, Final) for 16 teams
    // R2: Quarter-Finals (4 matches)
    const r2Matches: BracketPreviewMatch[] = [];
    for (let mIdx = 0; mIdx < 4; mIdx++) {
      const homeSource = `fix-${competitionId}-r1-m${mIdx * 2}`;
      const awaySource = `fix-${competitionId}-r1-m${mIdx * 2 + 1}`;
      const m: BracketPreviewMatch = {
        roundNumber: 2,
        roundName: 'Quarter-Finals',
        matchIndex: mIdx,
        fixtureId: `fix-${competitionId}-r2-m${mIdx}`,
        homeClubId: null,
        homeClubName: `Winner R1-M${mIdx * 2}`,
        awayClubId: null,
        awayClubName: `Winner R1-M${mIdx * 2 + 1}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: 'home',
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: 'home',
        awaySourceWinnerSlot: 'away',
      };
      previewMatches.push(m);
      r2Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 2,
      roundName: 'Quarter-Finals',
      matchesCount: r2Matches.length,
      totalMatches: r2Matches.length,
      pairings: r2Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r2Matches,
    });

    // R3: Semi-Finals (2 matches)
    const r3Matches: BracketPreviewMatch[] = [];
    for (let mIdx = 0; mIdx < 2; mIdx++) {
      const homeSource = `fix-${competitionId}-r2-m${mIdx * 2}`;
      const awaySource = `fix-${competitionId}-r2-m${mIdx * 2 + 1}`;
      const m: BracketPreviewMatch = {
        roundNumber: 3,
        roundName: 'Semi-Finals',
        matchIndex: mIdx,
        fixtureId: `fix-${competitionId}-r3-m${mIdx}`,
        homeClubId: null,
        homeClubName: `Winner QF-M${mIdx * 2}`,
        awayClubId: null,
        awayClubName: `Winner QF-M${mIdx * 2 + 1}`,
        homeClub: null,
        awayClub: null,
        sourceFixtureId: homeSource,
        sourceWinnerSlot: 'home',
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: 'home',
        awaySourceWinnerSlot: 'away',
      };
      previewMatches.push(m);
      r3Matches.push(m);
    }
    roundsStructured.push({
      roundNumber: 3,
      roundName: 'Semi-Finals',
      matchesCount: r3Matches.length,
      totalMatches: r3Matches.length,
      pairings: r3Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r3Matches,
    });

    // R4: Final (1 match)
    const r4HomeSource = `fix-${competitionId}-r3-m0`;
    const r4AwaySource = `fix-${competitionId}-r3-m1`;
    const r4Matches: BracketPreviewMatch[] = [
      {
        roundNumber: 4,
        roundName: 'Final',
        matchIndex: 0,
        fixtureId: `fix-${competitionId}-r4-m0`,
        homeClubId: null,
        homeClubName: 'Winner SF-M0',
        awayClubId: null,
        awayClubName: 'Winner SF-M1',
        homeClub: null,
        awayClub: null,
        sourceFixtureId: r4HomeSource,
        sourceWinnerSlot: 'home',
        homeSourceFixtureId: r4HomeSource,
        awaySourceFixtureId: r4AwaySource,
        homeSourceWinnerSlot: 'home',
        awaySourceWinnerSlot: 'away',
      },
    ];
    previewMatches.push(r4Matches[0]);
    roundsStructured.push({
      roundNumber: 4,
      roundName: 'Final',
      matchesCount: 1,
      totalMatches: 1,
      pairings: r4Matches.map((m) => ({
        homeClub: m.homeClub || { id: null, name: m.homeClubName },
        awayClub: m.awayClub || { id: null, name: m.awayClubName },
        fixtureId: m.fixtureId,
      })),
      matches: r4Matches,
    });
  }

  const canGenerate = existingCount === 0;
  const blockReason = !canGenerate
    ? `Competition already has ${existingCount} existing fixtures. Bracket generation is blocked to preserve confirmed results and prevent overwriting production fixtures.`
    : undefined;

  return {
    competitionId,
    competitionName: cupConfig.name,
    totalTeams,
    totalParticipants: totalTeams,
    prelimMatches,
    byeTeamsCount,
    totalRounds,
    roundsCount: totalRounds,
    existingFixturesCount: existingCount,
    canGenerate,
    blockReason,
    previewMatches,
    rounds: roundsStructured,
  };
}

/**
 * Safely generates a domestic cup knockout bracket with strict precondition checks.
 * STRICT DATA SAFETY RULE: Never overwrite existing fixtures, never force: true in production!
 */
export async function generateDomesticCupBracketSafe(
  competitionId: string,
  options: {
    adminUserId: string;
    adminUsername?: string;
    confirmation: boolean;
    seasonId?: string;
  }
): Promise<{ success: boolean; generated: number; rounds: number; message: string }> {
  const cupConfig = validateDomesticCupId(competitionId);
  const seasonId = options.seasonId || 'season-2026-27';

  if (!options.confirmation) {
    throw new Error('Explicit admin confirmation is required to generate a domestic cup bracket.');
  }

  const db = getFirestoreDb();

  // Document Precondition: Verify no existing fixtures
  const existingFixSnap = await db
    .collection(COLLECTIONS.FIXTURES)
    .where('competitionId', '==', competitionId)
    .get();

  if (!existingFixSnap.empty) {
    throw new Error(
      `Precondition Failed: Competition '${cupConfig.name}' already has ${existingFixSnap.size} existing fixtures. Bracket regeneration is blocked to protect match records. Force overwrite is strictly prohibited.`
    );
  }

  // Preview & generate bracket matches
  const preview = await previewDomesticCupBracket(competitionId, seasonId);
  if (!preview.canGenerate) {
    throw new Error(preview.blockReason || 'Bracket generation preconditions failed.');
  }

  const now = new Date().toISOString();
  const batch = db.batch();

  // Batch insert all fixtures
  for (const m of preview.previewMatches) {
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(m.fixtureId);
    batch.create(fixRef, {
      id: m.fixtureId,
      seasonId,
      competitionId,
      competitionName: cupConfig.name,
      matchday: m.roundNumber,
      roundName: m.roundName,
      homeClubId: m.homeClubId ?? null,
      awayClubId: m.awayClubId ?? null,
      scheduledAt: now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      sourceFixtureId: m.sourceFixtureId ?? null,
      sourceWinnerSlot: m.sourceWinnerSlot ?? null,
      homeSourceFixtureId: m.homeSourceFixtureId ?? null,
      awaySourceFixtureId: m.awaySourceFixtureId ?? null,
      homeSourceWinnerSlot: m.homeSourceWinnerSlot ?? null,
      awaySourceWinnerSlot: m.awaySourceWinnerSlot ?? null,
      createdAt: now,
      updatedAt: now,
    });

  }

  // Update competition metadata
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  batch.set(compRef, {
    status: 'active',
    hasFixtures: true,
    fixtureCount: preview.previewMatches.length,
    fixturesCount: preview.previewMatches.length,
    generationStatus: 'generated',
    updatedAt: now,
  }, { merge: true });

  await batch.commit();

  // Only mirror data after the entire authoritative batch committed.
  for (const m of preview.previewMatches) {
    // Also mirror to SQLite
    try {
      queryRun(
        `INSERT OR IGNORE INTO fixtures (id, season_id, competition_id, matchday, round_name, home_club_id, away_club_id, status, scheduled_at, source_fixture_id, source_winner_slot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.fixtureId,
          seasonId,
          competitionId,
          m.roundNumber,
          m.roundName,
          m.homeClubId ?? null,
          m.awayClubId ?? null,
          'SCHEDULED',
          now,
          m.sourceFixtureId ?? null,
          m.sourceWinnerSlot ?? null,
          now,
          now,
        ]
      );
    } catch {}
  }

  await invalidateDataset(`cup:bracket:${competitionId}:${seasonId}`);
  await invalidateFixtureReadModels(competitionId, seasonId);

  // Write audit log
  await createAuditLog(
    options.adminUserId,
    'CUP_BRACKET_GENERATED',
    'COMPETITION',
    competitionId,
    undefined,
    {
      competitionId,
      competitionName: cupConfig.name,
      generatedFixtures: preview.previewMatches.length,
      totalRounds: preview.totalRounds,
      timestamp: now,
    },
    undefined,
    options.adminUsername || 'admin',
    `Generated ${preview.previewMatches.length} safe knockout bracket fixtures for ${cupConfig.name}.`
  );

  return {
    success: true,
    generated: preview.previewMatches.length,
    rounds: preview.totalRounds,
    message: `Safely generated ${preview.previewMatches.length} fixtures for ${cupConfig.name} across ${preview.totalRounds} rounds without overwriting existing data.`,
  };
}

/**
 * Safely advances the winner of a confirmed match to the next bracket round.
 */
export async function advanceDomesticCupWinnerSafe(
  fixtureId: string,
  options: {
    adminUserId: string;
    adminUsername?: string;
  }
): Promise<{ success: boolean; advanced: boolean; isNoop?: boolean; targetFixtureId?: string; winnerClubId?: string; message: string }> {
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();

  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }

  const fixture = fixDoc.data() as FirestoreFixtureDoc;
  validateDomesticCupId(fixture.competitionId);

  // Preconditions: Result must be CONFIRMED and winnerClubId must be determined
  if (fixture.status !== 'CONFIRMED') {
    throw new Error(`Cannot advance knockout winner: match status is '${fixture.status}'. Must be 'CONFIRMED'.`);
  }
  if (!fixture.winnerClubId) {
    throw new Error('Cannot advance knockout winner: no winnerClubId is recorded for this fixture.');
  }

  const winnerClubId = fixture.winnerClubId;
  const compId = fixture.competitionId;

  // Calculate next round node
  let targetFixtureId = '';
  let isHomeSlot = true;

  const r1Match = fixture.id.match(/-r1-m(\d+)$/);
  const r2Match = fixture.id.match(/-r2-m(\d+)$/);
  const r3Match = fixture.id.match(/-r3-m(\d+)$/);
  const r4Match = fixture.id.match(/-r4-m(\d+)$/);

  const cupConfigEntry = DOMESTIC_CUPS[compId];
  const expectedTeams =
    cupConfigEntry?.expectedTeams ||
    (compId.includes('bundesliga') || compId.includes('dfb') || compId.includes('ligue-1') || compId.includes('coupe')
      ? 18
      : 20);
  const is18Teams = expectedTeams === 18;
  const is16Teams = expectedTeams === 16;
  const pureByeMatches = is18Teams ? 6 : 4;

  if (r1Match) {
    const idx = parseInt(r1Match[1], 10);
    if (is16Teams) {
      targetFixtureId = `fix-${compId}-r2-m${Math.floor(idx / 2)}`;
      isHomeSlot = idx % 2 === 0;
    } else {
      // Preliminary round match k advances to R16 match (pureByeMatches + k), filling the Away slot
      const r16Index = pureByeMatches + idx;
      targetFixtureId = `fix-${compId}-r2-m${r16Index}`;
      isHomeSlot = false;
    }
  } else if (r2Match) {
    const idx = parseInt(r2Match[1], 10);
    targetFixtureId = `fix-${compId}-r3-m${Math.floor(idx / 2)}`;
    isHomeSlot = idx % 2 === 0;
  } else if (r3Match) {
    const idx = parseInt(r3Match[1], 10);
    if (is16Teams) {
      targetFixtureId = `fix-${compId}-r4-m0`;
      isHomeSlot = idx === 0;
    } else {
      targetFixtureId = `fix-${compId}-r4-m${Math.floor(idx / 2)}`;
      isHomeSlot = idx % 2 === 0;
    }
  } else if (r4Match) {
    const idx = parseInt(r4Match[1], 10);
    if (is16Teams) {
      await notifySmartCupChampion({
        competitionId: compId,
        seasonId: fixture.seasonId || 'season-2026-27',
        sourceFixtureId: fixtureId,
        winnerClubId,
      }).catch(() => {});
      return {
        success: true,
        advanced: false,
        message: 'This match was the Final. Winner has been crowned champion.',
      };
    }
    targetFixtureId = `fix-${compId}-r5-m0`;
    isHomeSlot = idx === 0;
  } else {
    await notifySmartCupChampion({
      competitionId: compId,
      seasonId: fixture.seasonId || 'season-2026-27',
      sourceFixtureId: fixtureId,
      winnerClubId,
    }).catch(() => {});
    return {
      success: true,
      advanced: false,
      message: 'This match was the Final. Winner has been crowned champion.',
    };
  }

  const targetRef = db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId);

  // Execute advancement inside a transaction to prevent race conditions and concurrent overwrites
  const txResult = await db.runTransaction(async (transaction) => {
    // Read the source in the same transaction: a reopen/correction must invalidate advancement.
    const sourceDoc = await transaction.get(fixRef);
    const source = sourceDoc.data() as FirestoreFixtureDoc | undefined;
    if (!source || source.status !== 'CONFIRMED' || source.winnerClubId !== winnerClubId ||
        source.competitionId !== compId || source.seasonId !== fixture.seasonId ||
        ![source.homeClubId, source.awayClubId].includes(winnerClubId)) {
      throw Object.assign(new Error('SOURCE_FIXTURE_CHANGED'), { statusCode: 409 });
    }
    const targetDoc = await transaction.get(targetRef);

    if (!targetDoc.exists) {
      const err: any = new Error(`Target round fixture '${targetFixtureId}' does not exist.`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    const targetFixture = targetDoc.data() as FirestoreFixtureDoc;
    if (targetFixture.competitionId !== compId || targetFixture.seasonId !== source.seasonId) {
      throw Object.assign(new Error('TARGET_COMPETITION_MISMATCH'), { statusCode: 409 });
    }
    const existingWinner = isHomeSlot ? targetFixture.homeClubId : targetFixture.awayClubId;
    if (existingWinner === winnerClubId) {
      return { alreadyAdvanced: true, success: true, advanced: false, isNoop: true,
        targetFixtureId, winnerClubId, message: 'Winner already advanced.' };
    }

    // Safety: started, submitted, disputed or confirmed target matches cannot be modified
    const protectedStatuses = [
      'PLAYING',
      'IN_PROGRESS',
      'AWAITING_RESULT',
      'PENDING_CONFIRMATION',
      'DISPUTED',
      'CONFIRMED',
    ];
    if (protectedStatuses.includes(targetFixture.status)) {
      const statusErr: any = new Error(
        `Cannot advance winner: Target round fixture '${targetFixtureId}' has status '${targetFixture.status}'. Matches that are started, submitted, disputed, or confirmed cannot be modified.`
      );
      statusErr.statusCode = 400;
      statusErr.code = 'TARGET_MATCH_LOCKED';
      throw statusErr;
    }

    const currentOccupant = isHomeSlot ? targetFixture.homeClubId : targetFixture.awayClubId;

    // Safety: repeated advancement is an idempotent no-op
    if (currentOccupant === winnerClubId) {
      return {
        alreadyAdvanced: true,
        success: true,
        advanced: false,
        isNoop: true,
        targetFixtureId,
        winnerClubId,
        message: `Winner '${winnerClubId}' has already been advanced to ${targetFixtureId} as ${isHomeSlot ? 'Home' : 'Away'} club. Repeated advancement is a no-op.`,
      };
    }

    // Safety: a target slot containing another club returns 409
    if (currentOccupant && currentOccupant !== winnerClubId && currentOccupant !== 'TBD') {
      const conflictErr: any = new Error(
        `Conflict: Target round fixture '${targetFixtureId}' ${isHomeSlot ? 'home' : 'away'} slot is already occupied by club '${currentOccupant}', which conflicts with advancing winner '${winnerClubId}'.`
      );
      conflictErr.statusCode = 409;
      conflictErr.code = 'TARGET_SLOT_OCCUPIED_CONFLICT';
      throw conflictErr;
    }

    // Atomic update within transaction
    const updatePayload: Partial<FirestoreFixtureDoc> = {
      updatedAt: new Date().toISOString(),
    };
    if (isHomeSlot) {
      updatePayload.homeClubId = winnerClubId;
    } else {
      updatePayload.awayClubId = winnerClubId;
    }

    transaction.update(targetRef, updatePayload);

    return {
      alreadyAdvanced: false,
      success: true,
      advanced: true,
      isNoop: false,
      targetFixtureId,
      winnerClubId,
      message: `Advanced ${winnerClubId} to ${targetFixtureId} as ${isHomeSlot ? 'Home' : 'Away'} club.`,
    };
  });

  if (txResult.alreadyAdvanced) {
    return {
      success: true,
      advanced: false,
      isNoop: true,
      targetFixtureId: txResult.targetFixtureId,
      winnerClubId: txResult.winnerClubId,
      message: txResult.message,
    };
  }

  // Mirror to SQLite
  try {
    if (isHomeSlot) {
      queryRun('UPDATE fixtures SET home_club_id = ?, updated_at = ? WHERE id = ?', [
        winnerClubId,
        new Date().toISOString(),
        targetFixtureId,
      ]);
    } else {
      queryRun('UPDATE fixtures SET away_club_id = ?, updated_at = ? WHERE id = ?', [
        winnerClubId,
        new Date().toISOString(),
        targetFixtureId,
      ]);
    }
  } catch {}

  // Invalidate Redis read model and caches
  const cacheKey = `cup:bracket:${compId}:${fixture.seasonId || 'season-2026-27'}`;
  await invalidateDataset(cacheKey);
  await refreshChangedFixtureReadModel(targetFixtureId).catch(() => invalidateFixtureReadModels(compId, fixture.seasonId || 'season-2026-27'));
  await notifySmartCupAdvancement({
    competitionId: compId,
    seasonId: fixture.seasonId || 'season-2026-27',
    sourceFixtureId: fixtureId,
    targetFixtureId,
    winnerClubId,
  }).catch((error: any) => {
    console.warn('[SMART_NOTIFY] Cup advancement notification failed:', error?.message || error);
  });

  // Write audit log
  await createAuditLog(
    options.adminUserId,
    'KNOCKOUT_ROUND_ADVANCED',
    'FIXTURE',
    targetFixtureId,
    undefined,
    {
      sourceFixtureId: fixtureId,
      targetFixtureId,
      slot: isHomeSlot ? 'home' : 'away',
      winnerClubId,
      timestamp: new Date().toISOString(),
    },
    undefined,
    options.adminUsername || 'admin',
    `Advanced winner ${winnerClubId} from ${fixtureId} to ${targetFixtureId} (${isHomeSlot ? 'home' : 'away'}).`
  );

  return {
    success: true,
    advanced: true,
    isNoop: false,
    targetFixtureId,
    winnerClubId,
    message: `Advanced ${winnerClubId} to ${targetFixtureId} as ${isHomeSlot ? 'Home' : 'Away'} club.`,
  };
}
