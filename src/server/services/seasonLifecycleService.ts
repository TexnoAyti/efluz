import { getFirestoreDb } from '../firebase/admin';
import { getCompetitionFixturesFromReadModel } from '../readModel/readModelStore';
import { filterTombstonedFixtures } from './fixtureTombstoneService';
import { Fixture } from '../../types';

export type LifecyclePhaseId = 'LEAGUE_1_9' | 'DOMESTIC_CUPS' | 'LEAGUE_10_19' | 'EUROPE';
export type LifecyclePhaseStatus = 'COMPLETED' | 'ACTIVE' | 'LOCKED';

export interface LifecyclePhase {
  id: LifecyclePhaseId;
  label: string;
  description: string;
  status: LifecyclePhaseStatus;
  confirmed: number;
  total: number;
  progress: number;
  currentMatchday: number | null;
}

export interface SeasonLifecycle {
  seasonId: string;
  currentPhase: LifecyclePhaseId;
  phases: LifecyclePhase[];
  overridePhase: LifecyclePhaseId | null;
  overrideMatchday: number | null;
  overrideReason?: string | null;
  generatedAt: string;
}

const LEAGUES = [
  'comp-premier-league-2026', 'comp-la-liga-2026', 'comp-serie-a-2026',
  'comp-bundesliga-2026', 'comp-ligue-1-2026',
];
const CUPS = [
  'comp-fa-cup-2026', 'comp-copa-del-rey-2026', 'comp-coppa-italia-2026',
  'comp-dfb-pokal-2026', 'comp-coupe-de-france-2026',
];
const EUROPE = ['comp-champions-league-2026', 'comp-europa-league-2026'];
const PHASE_ORDER: LifecyclePhaseId[] = ['LEAGUE_1_9', 'DOMESTIC_CUPS', 'LEAGUE_10_19', 'EUROPE'];

let cached: { key: string; value: SeasonLifecycle; expiresAt: number } | null = null;

async function fixturesFor(ids: string[], seasonId: string): Promise<Fixture[]> {
  const batches = await Promise.all(ids.map(async (id) => {
    try {
      const fixtures = (await getCompetitionFixturesFromReadModel(id, { seasonId })).fixtures;
      return await filterTombstonedFixtures(fixtures, seasonId);
    } catch {
      return [] as Fixture[];
    }
  }));
  return batches.flat();
}

function playable(fixtures: Fixture[]) {
  return fixtures.filter((f) => {
    const homeOwned = Boolean(f.homeOwnerId || f.homeClub?.claimedByUserId);
    const awayOwned = Boolean(f.awayOwnerId || f.awayClub?.claimedByUserId);
    return Boolean(f.homeClubId && f.awayClubId && homeOwned && awayOwned);
  });
}

function currentMatchday(fixtures: Fixture[]): number | null {
  const pending = playable(fixtures)
    .filter((f) => f.status !== 'CONFIRMED' && f.status !== 'CANCELLED')
    .map((f) => Number(f.matchday || 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return pending[0] ?? null;
}

function stats(fixtures: Fixture[]) {
  const rows = playable(fixtures);
  const total = rows.length;
  const confirmed = rows.filter((f) => f.status === 'CONFIRMED' || f.status === 'CANCELLED').length;
  return {
    total,
    confirmed,
    progress: total === 0 ? 0 : Math.round((confirmed / total) * 100),
    currentMatchday: currentMatchday(rows),
  };
}

async function readOverride(seasonId: string): Promise<{ phase: LifecyclePhaseId; matchday: number | null; reason?: string } | null> {
  try {
    const db = getFirestoreDb();
    if (!db) return null;
    const snap = await db.collection('season_lifecycle_controls').doc(seasonId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return PHASE_ORDER.includes(data.overridePhase)
      ? { phase: data.overridePhase, matchday: Number.isInteger(data.overrideMatchday) ? data.overrideMatchday : null, reason: data.reason }
      : null;
  } catch { return null; }
}

export async function setSeasonLifecycleOverride(
  seasonId: string,
  phase: LifecyclePhaseId | null,
  reason: string,
  actorUserId: string,
  matchday: number | null = null
) {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore is unavailable');
  const ref = db.collection('season_lifecycle_controls').doc(seasonId);
  if (!phase) {
    await ref.set({ overridePhase: null, overrideMatchday: null, reason, actorUserId, updatedAt: new Date().toISOString() }, { merge: true });
  } else {
    if (!PHASE_ORDER.includes(phase)) throw new Error('Invalid lifecycle phase');
    await ref.set({ overridePhase: phase, overrideMatchday: matchday, reason, actorUserId, updatedAt: new Date().toISOString() }, { merge: true });
  }
  cached = null;
}

export async function getSeasonLifecycle(seasonId = 'season-2026-27', force = false): Promise<SeasonLifecycle> {
  if (!force && cached?.key === seasonId && cached.expiresAt > Date.now()) return cached.value;

  const [leagueFixtures, cupFixtures, europeFixtures, override] = await Promise.all([
    fixturesFor(LEAGUES, seasonId), fixturesFor(CUPS, seasonId), fixturesFor(EUROPE, seasonId), readOverride(seasonId),
  ]);

  const groups: Record<LifecyclePhaseId, Fixture[]> = {
    LEAGUE_1_9: leagueFixtures.filter((f) => Number(f.matchday || 0) >= 1 && Number(f.matchday || 0) <= 9),
    DOMESTIC_CUPS: cupFixtures,
    LEAGUE_10_19: leagueFixtures.filter((f) => Number(f.matchday || 0) >= 10 && Number(f.matchday || 0) <= 19),
    EUROPE: europeFixtures.filter((f) => Number(f.matchday || 0) >= 1 && Number(f.matchday || 0) <= 8),
  };

  const phaseStats = Object.fromEntries(PHASE_ORDER.map((id) => [id, stats(groups[id])])) as Record<LifecyclePhaseId, ReturnType<typeof stats>>;
  let derivedIndex = PHASE_ORDER.findIndex((id) => {
    const s = phaseStats[id];
    return s.total === 0 || s.confirmed < s.total;
  });
  if (derivedIndex < 0) derivedIndex = PHASE_ORDER.length - 1;
  const currentPhase = override?.phase || PHASE_ORDER[derivedIndex];
  const activeIndex = PHASE_ORDER.indexOf(currentPhase);

  const labels: Record<LifecyclePhaseId, [string, string]> = {
    LEAGUE_1_9: ['Liga 1–9-turlar', 'MD1 tugagach MD2 ochiladi; MD9 dan keyin kuboklar'],
    DOMESTIC_CUPS: ['Milliy kuboklar', '5 ta milliy kubok bosqichi'],
    LEAGUE_10_19: ['Liga 10–19-turlar', 'Bir davrali liga shu bosqichda MD19 bilan yakunlanadi'],
    EUROPE: ['UCL / UEL', 'MD19 dan keyin Yevropa liga bosqichi, turma-tur progression'],
  };

  const phases = PHASE_ORDER.map((id, index): LifecyclePhase => {
    const s = phaseStats[id];
    const status: LifecyclePhaseStatus = index < activeIndex ? 'COMPLETED' : index === activeIndex ? 'ACTIVE' : 'LOCKED';
    return {
      id,
      label: labels[id][0],
      description: labels[id][1],
      status,
      ...s,
      currentMatchday: index === activeIndex && override?.matchday ? override.matchday : s.currentMatchday,
    };
  });

  const value: SeasonLifecycle = {
    seasonId,
    currentPhase,
    phases,
    overridePhase: override?.phase || null,
    overrideMatchday: override?.matchday || null,
    overrideReason: override?.reason || null,
    generatedAt: new Date().toISOString(),
  };
  cached = { key: seasonId, value, expiresAt: Date.now() + 15000 };
  return value;
}

export function fixtureLifecyclePhase(fixture: Fixture): LifecyclePhaseId | null {
  const md = Number(fixture.matchday || 0);
  if (LEAGUES.includes(fixture.competitionId)) {
    if (md >= 1 && md <= 9) return 'LEAGUE_1_9';
    if (md >= 10 && md <= 19) return 'LEAGUE_10_19';
    return null;
  }
  if (CUPS.includes(fixture.competitionId)) return 'DOMESTIC_CUPS';
  if (EUROPE.includes(fixture.competitionId) && md >= 1 && md <= 8) return 'EUROPE';
  return null;
}

export async function assertFixtureLifecycleOpen(fixture: Fixture): Promise<void> {
  const phase = fixtureLifecyclePhase(fixture);
  if (!phase) return;
  const lifecycle = await getSeasonLifecycle(fixture.seasonId || 'season-2026-27');
  if (lifecycle.currentPhase !== phase) {
    const err: any = new Error(`This match is locked until the ${phase} season phase opens.`);
    err.status = 423;
    err.code = 'SEASON_PHASE_LOCKED';
    throw err;
  }

  const active = lifecycle.phases.find((p) => p.id === phase);
  const fixtureMd = Number(fixture.matchday || 0);
  if (active?.currentMatchday && fixtureMd > active.currentMatchday) {
    const err: any = new Error(`Matchday ${fixtureMd} is locked. Complete matchday ${active.currentMatchday} first.`);
    err.status = 423;
    err.code = 'MATCHDAY_PROGRESSION_LOCKED';
    throw err;
  }
}
