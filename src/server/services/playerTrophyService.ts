import type { Fixture } from '../../types';
import { trophyId, type PlayerTrophy, type PlayerTrophyCabinet, type TrophyRecord } from '../../types/trophies';
import { getFirestoreDb } from '../firebase/admin';
import { trackFirestoreRead, trackFirestoreWrite } from '../firebase/firestoreStore';
import { SEED_COMPETITIONS } from '../db/seed';
import { DOMESTIC_LEAGUE_CONFIG, ReadModelKeys, invalidateDataset, redisGetFresh, redisGetLkg, redisIsDirty, redisSetRaw } from '../readModel/readModelStore';
import { getSeasonTrophies } from './seasonInsightsService';

const COLLECTION = 'player_trophies';
const HISTORY_KEY = 'player-trophies:history';
export interface RecordedTrophy extends PlayerTrophy {
  active: boolean;
  evaluatedAt: string;
}
type TrophyHistory = { records: RecordedTrophy[]; archives: Array<{ seasonId: string; trophies: TrophyRecord[] }> };
const memoryRecords = new Map<string, RecordedTrophy>();
let cachedHistory: { data: TrophyHistory; expiresAt: number } | null = null;
let historyFlight: Promise<{ data: TrophyHistory; stale: boolean }> | null = null;
let historyEpoch = 0;
const localMode = () => process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

export function clearMemoryTrophies(): void {
  memoryRecords.clear(); cachedHistory = null; historyFlight = null; historyEpoch++;
}

/** Same winning club keeps the player who earned it, even after a club transfer.
 * Only a corrected champion can replace that identity. Older events cannot undo it. */
export function reconcileTrophy(previous: RecordedTrophy | null, candidate: TrophyRecord | null, evaluatedAt: string): RecordedTrophy | null {
  if (previous && previous.evaluatedAt > evaluatedAt) return previous;
  if (!candidate) return previous ? { ...previous, active: false, evaluatedAt } : null;
  const sameChampion = previous?.clubId === candidate.clubId;
  if (!candidate.winnerUserId && !sameChampion) return previous ? { ...previous, active: false, evaluatedAt } : null;
  return {
    ...candidate,
    id: trophyId(candidate.seasonId, candidate.competitionId),
    winnerUserId: sameChampion ? previous.winnerUserId : candidate.winnerUserId,
    winnerUsername: sameChampion ? previous.winnerUsername : candidate.winnerUsername,
    active: true,
    evaluatedAt,
  };
}

export async function invalidateTrophyHistory(): Promise<void> {
  cachedHistory = null; historyEpoch++;
  await invalidateDataset(HISTORY_KEY);
}

async function readHistory(): Promise<{ data: TrophyHistory; stale: boolean }> {
  if (localMode()) {
    const archives = await getFirestoreDb().collection('season_archives').get();
    return { data: { records: [...memoryRecords.values()], archives: archives.docs.map(doc => ({ seasonId: doc.id, trophies: (doc.data().trophies || []) as TrophyRecord[] })) }, stale: false };
  }
  if (cachedHistory && cachedHistory.expiresAt > Date.now()) return { data: cachedHistory.data, stale: false };
  if (historyFlight) return historyFlight;
  const generation = historyEpoch;
  const work = (async () => {
    const fresh = await redisGetFresh<TrophyHistory>(HISTORY_KEY);
    if (fresh && !(await redisIsDirty(HISTORY_KEY))) return { data: fresh.data, stale: false };
    try {
      const db = getFirestoreDb();
      // These are small, shared official trophy/archive collections, never a fixture scan.
      const [records, archives] = await Promise.all([db.collection(COLLECTION).get(), db.collection('season_archives').get()]);
      trackFirestoreRead(COLLECTION, records.size, 'playerTrophyHistory');
      trackFirestoreRead('season_archives', archives.size, 'playerTrophyHistory');
      const data: TrophyHistory = {
        records: records.docs.map(doc => doc.data() as RecordedTrophy),
        archives: archives.docs.map(doc => ({ seasonId: doc.id, trophies: (doc.data().trophies || []) as TrophyRecord[] })),
      };
      if (generation === historyEpoch) {
        cachedHistory = { data, expiresAt: Date.now() + 30_000 };
        await redisSetRaw(HISTORY_KEY, { data, sourceVersion: 'firestore-trophy-history' }, 30).catch(() => {});
      }
      return { data, stale: false };
    } catch (error) {
      const last = await redisGetLkg<TrophyHistory>(HISTORY_KEY);
      if (last) return { data: last.data, stale: true };
      throw error;
    }
  })();
  historyFlight = work;
  try { return await work; } finally { if (historyFlight === work) historyFlight = null; }
}

/** Called after authoritative result snapshots have been patched. No award is
 * written from a stale snapshot, an unfinished league, or an unconfirmed final. */
export async function syncCompetitionTrophy(competitionId: string, seasonId: string, changedFixture?: Fixture): Promise<void> {
  const competition = SEED_COMPETITIONS.find(item => item.id === competitionId);
  if (!competition) return;
  const key = ReadModelKeys.competitionFixtures(competitionId, seasonId);
  const snapshot = await redisGetFresh<Fixture[]>(key);
  if (!snapshot || !Array.isArray(snapshot.data) || await redisIsDirty(key)) return;
  const fixtures = snapshot.data.filter(item => item.competitionId === competitionId && item.seasonId === seasonId);
  if (changedFixture && !fixtures.some(item => item.id === changedFixture.id && item.updatedAt === changedFixture.updatedAt)) return;
  const expectedClubs = DOMESTIC_LEAGUE_CONFIG[competitionId]?.expectedCount;
  if (changedFixture && expectedClubs && fixtures.filter(item => item.status === 'CONFIRMED').length < expectedClubs * (expectedClubs - 1) / 2 - 1) return;
  if (changedFixture && !expectedClubs && !/^final(?:\s|$)/i.test(changedFixture.roundName || '') && !(competition.type === 'SUPER_CUP' && competition.formatConfig.teams === 2)) return;
  const result = await getSeasonTrophies(seasonId, { fixtures, competitionId });
  if (result.unavailableCompetitions.includes(competitionId)) return;
  const candidate = result.trophies.find(item => item.competitionId === competitionId) || null;
  if (candidate) {
    const ownerKey = ReadModelKeys.clubsWithOwners(seasonId);
    const owners = await redisGetFresh<Array<{ id: string; ownerUserId?: string; ownerUsername?: string }>>(ownerKey);
    if (!owners || await redisIsDirty(ownerKey)) return;
    const owner = owners.data.find(item => item.id === candidate.clubId);
    candidate.winnerUserId = owner?.ownerUserId;
    candidate.winnerUsername = owner?.ownerUsername;
  }
  const id = trophyId(seasonId, competitionId);
  const evaluatedAt = [changedFixture?.updatedAt || '', ...fixtures.map(item => item.updatedAt || '')].sort().at(-1) || new Date().toISOString();
  if (localMode()) {
    const next = reconcileTrophy(memoryRecords.get(id) || null, candidate, evaluatedAt);
    if (next) memoryRecords.set(id, next);
    return;
  }
  const db = getFirestoreDb();
  const ref = db.collection(COLLECTION).doc(id);
  const changed = await db.runTransaction(async transaction => {
    const [previous, archived] = await Promise.all([transaction.get(ref), transaction.get(db.collection('season_archives').doc(seasonId))]);
    trackFirestoreRead(COLLECTION, previous.exists ? 1 : 0, 'syncCompetitionTrophy');
    trackFirestoreRead('season_archives', archived.exists ? 1 : 0, 'syncCompetitionTrophy');
    if (archived.exists) return false;
    if (changedFixture) {
      const current = await transaction.get(db.collection('fixtures').doc(changedFixture.id));
      trackFirestoreRead('fixtures', current.exists ? 1 : 0, 'syncCompetitionTrophy');
      const value = current.data();
      if (!current.exists || ['updatedAt', 'status', 'homeScore', 'awayScore', 'winnerClubId'].some(field => (value?.[field] ?? null) !== ((changedFixture as unknown as Record<string, unknown>)[field] ?? null))) return false;
    }
    const before = previous.exists ? previous.data() as RecordedTrophy : null;
    const next = reconcileTrophy(before, candidate, evaluatedAt);
    if (!next || JSON.stringify(before) === JSON.stringify(next)) return false;
    // Firestore does not accept optional undefined properties.
    transaction.set(ref, JSON.parse(JSON.stringify(next)));
    return true;
  });
  if (changed) {
    trackFirestoreWrite(COLLECTION, 1, 'syncCompetitionTrophy');
    await invalidateTrophyHistory();
  }
}

export function mergePlayerTrophies(userId: string, live: TrophyRecord[], history: TrophyHistory, activeSeasonId: string): PlayerTrophy[] {
  const all = new Map<string, TrophyRecord>();
  const archivedSeasons = new Set(history.archives.map(item => item.seasonId));
  for (const record of history.records) {
    if (record.active && !archivedSeasons.has(record.seasonId) && record.seasonId !== activeSeasonId) all.set(record.id, record);
  }
  for (const candidate of live) {
    if (candidate.seasonId !== activeSeasonId || archivedSeasons.has(candidate.seasonId)) continue;
    const id = trophyId(candidate.seasonId, candidate.competitionId);
    const recorded = history.records.find(item => item.id === id);
    // Revoked records are not revived by an older cached fixture snapshot.
    if (recorded && !recorded.active) continue;
    all.set(id, recorded?.clubId === candidate.clubId ? recorded : candidate);
  }
  // Archive ownership is immutable and takes precedence over all live data.
  for (const archive of history.archives) {
    for (const trophy of archive.trophies) {
      if (trophy.seasonId === archive.seasonId) all.set(trophyId(trophy.seasonId, trophy.competitionId), trophy);
    }
  }
  return [...all.entries()].filter(([, trophy]) => trophy.winnerUserId === userId)
    .map(([id, trophy]) => ({ id, competitionId: trophy.competitionId, competitionName: trophy.competitionName,
      seasonId: trophy.seasonId, clubId: trophy.clubId, clubName: trophy.clubName, winnerUserId: trophy.winnerUserId,
      winnerUsername: trophy.winnerUsername, decidedBy: trophy.decidedBy, confirmedAt: trophy.confirmedAt }))
    .sort((a, b) => b.seasonId.localeCompare(a.seasonId) || a.competitionName.localeCompare(b.competitionName));
}

export async function getPlayerTrophyCabinet(userId: string, activeSeasonId: string): Promise<PlayerTrophyCabinet> {
  const [history, live] = await Promise.all([readHistory(), getSeasonTrophies(activeSeasonId).catch(() => null)]);
  const saved = history.data.records.filter(record => record.active && record.seasonId === activeSeasonId);
  const current = live ? [...live.trophies, ...saved.filter(record => live.unavailableCompetitions.includes(record.competitionId))] : saved;
  return { trophies: mergePlayerTrophies(userId, current, history.data, activeSeasonId), stale: history.stale || !live || live.unavailableCompetitions.length > 0 || live.source === 'redis_stale' || live.source === 'sqlite' };
}

export async function preserveRecordedTrophyOwners(trophies: TrophyRecord[]): Promise<TrophyRecord[]> {
  const history = await readHistory();
  if (history.stale) throw new Error('TROPHY_HISTORY_STALE');
  return trophies.map(trophy => {
    const record = history.data.records.find(item => item.id === trophyId(trophy.seasonId, trophy.competitionId));
    if (!record) return trophy;
    if (!record.active || record.clubId !== trophy.clubId) throw new Error('TROPHY_RECONCILIATION_REQUIRED');
    return { ...trophy, winnerUserId: record.winnerUserId, winnerUsername: record.winnerUsername };
  });
}
