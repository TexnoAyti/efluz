import { getFirestoreDb } from '../firebase/admin';
import { getCompetitionFixturesFromReadModel } from '../readModel/readModelStore';
import { Fixture } from '../../types';

export type LifecyclePhaseId = 'LEAGUE_1_9' | 'DOMESTIC_CUPS' | 'LEAGUE_10_19' | 'EUROPE' | 'LEAGUE_20_PLUS';
export type LifecyclePhaseStatus = 'COMPLETED' | 'ACTIVE' | 'LOCKED';

export interface LifecyclePhase {
  id: LifecyclePhaseId;
  label: string;
  description: string;
  status: LifecyclePhaseStatus;
  confirmed: number;
  total: number;
  progress: number;
}

export interface SeasonLifecycle {
  seasonId: string;
  currentPhase: LifecyclePhaseId;
  phases: LifecyclePhase[];
  overridePhase: LifecyclePhaseId | null;
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
const PHASE_ORDER: LifecyclePhaseId[] = ['LEAGUE_1_9', 'DOMESTIC_CUPS', 'LEAGUE_10_19', 'EUROPE', 'LEAGUE_20_PLUS'];

let cached: { key: string; value: SeasonLifecycle; expiresAt: number } | null = null;

async function fixturesFor(ids: string[], seasonId: string): Promise<Fixture[]> {
  const batches = await Promise.all(ids.map(async (id) => {
    try { return (await getCompetitionFixturesFromReadModel(id, { seasonId })).fixtures; }
    catch { return [] as Fixture[]; }
  }));
  return batches.flat();
}

function playable(fixtures: Fixture[]) {
  return fixtures.filter((f) => Boolean(f.homeClubId && f.awayClubId));
}

function stats(fixtures: Fixture[]) {
  const rows = playable(fixtures);
  const total = rows.length;
  const confirmed = rows.filter((f) => f.status === 'CONFIRMED').length;
  return { total, confirmed, progress: total === 0 ? 0 : Math.round((confirmed / total) * 100) };
}

async function readOverride(seasonId: string): Promise<{ phase: LifecyclePhaseId; reason?: string } | null> {
  try {
    const db = getFirestoreDb();
    const snap = await db.collection('season_lifecycle_controls').doc(seasonId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return PHASE_ORDER.includes(data.overridePhase) ? { phase: data.overridePhase, reason: data.reason } : null;
  } catch { return null; }
}

export async function setSeasonLifecycleOverride(seasonId: string, phase: LifecyclePhaseId | null, reason: string, actorUserId: string) {
  const db = getFirestoreDb();
  const ref = db.collection('season_lifecycle_controls').doc(seasonId);
  if (!phase) {
    await ref.set({ overridePhase: null, reason, actorUserId, updatedAt: new Date().toISOString() }, { merge: true });
  } else {
    if (!PHASE_ORDER.includes(phase)) throw new Error('Invalid lifecycle phase');
    await ref.set({ overridePhase: phase, reason, actorUserId, updatedAt: new Date().toISOString() }, { merge: true });
  }
  cached = null;
}

export async function getSeasonLifecycle(seasonId = 'season-2026-27', force = false): Promise<SeasonLifecycle> {
  const key = seasonId;
  if (!force && cached?.key === key && cached.expiresAt > Date.now()) return cached.value;

  const [leagueFixtures, cupFixtures, europeFixtures, override] = await Promise.all([
    fixturesFor(LEAGUES, seasonId), fixturesFor(CUPS, seasonId), fixturesFor(EUROPE, seasonId), readOverride(seasonId),
  ]);

  const groups: Record<LifecyclePhaseId, Fixture[]> = {
    LEAGUE_1_9: leagueFixtures.filter((f) => Number(f.matchday || 0) >= 1 && Number(f.matchday || 0) <= 9),
    DOMESTIC_CUPS: cupFixtures,
    LEAGUE_10_19: leagueFixtures.filter((f) => Number(f.matchday || 0) >= 10 && Number(f.matchday || 0) <= 19),
    EUROPE: europeFixtures.filter((f) => Number(f.matchday || 0) >= 1 && Number(f.matchday || 0) <= 8),
    LEAGUE_20_PLUS: leagueFixtures.filter((f) => Number(f.matchday || 0) >= 20),
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
    LEAGUE_1_9: ['Liga 1–9-turlar', 'Mavsumning birinchi liga bloki'],
    DOMESTIC_CUPS: ['Domestic Cups', 'FA Cup, Copa del Rey, Coppa Italia, DFB-Pokal, Coupe de France'],
    LEAGUE_10_19: ['Liga 10–19-turlar', 'Yevropa bosqichidan oldingi liga bloki'],
    EUROPE: ['UCL / UEL', 'Yevropa liga bosqichi'],
    LEAGUE_20_PLUS: ['Liga 20+ turlar', 'Liga mavsumining ikkinchi yarmi'],
  };

  const phases = PHASE_ORDER.map((id, index): LifecyclePhase => {
    const s = phaseStats[id];
    const status: LifecyclePhaseStatus = index < activeIndex ? 'COMPLETED' : index === activeIndex ? 'ACTIVE' : 'LOCKED';
    return { id, label: labels[id][0], description: labels[id][1], status, ...s };
  });

  const value: SeasonLifecycle = {
    seasonId, currentPhase, phases, overridePhase: override?.phase || null,
    overrideReason: override?.reason || null, generatedAt: new Date().toISOString(),
  };
  cached = { key, value, expiresAt: Date.now() + 15000 };
  return value;
}

export function fixtureLifecyclePhase(fixture: Fixture): LifecyclePhaseId | null {
  const md = Number(fixture.matchday || 0);
  if (LEAGUES.includes(fixture.competitionId)) {
    if (md <= 9) return 'LEAGUE_1_9';
    if (md <= 19) return 'LEAGUE_10_19';
    return 'LEAGUE_20_PLUS';
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
}
