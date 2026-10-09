import type { Club, Competition, Fixture } from '../../types';
import { SEED_COMPETITIONS } from '../db/seed';
import { ReadModelKeys, redisGetFresh, redisGetLkg, normalizeFixtureSnapshot, ReadModelSnapshot, ReadModelNotWarmedError } from '../readModel/readModelStore';
import { getFixturesFirestore, enrichFixturesWithAuthoritativeOwners, refreshFixtureMatchdayRules, getAllCompetitionsFirestore } from '../firebase/firestoreStore';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { filterTombstonedFixtures } from './fixtureTombstoneService';
import { sortSeasonFixtures } from '../../lib/fixtureOrder';

type Cached<T> = { snapshot: ReadModelSnapshot<T[]>; stale: boolean };
async function cached<T>(key: string): Promise<Cached<T> | null> {
  const fresh = await redisGetFresh<T[]>(key);
  if (fresh && Array.isArray(fresh.data)) return { snapshot: fresh, stale: Boolean(fresh.stale || fresh.degraded) };
  const lkg = await redisGetLkg<T[]>(key);
  return lkg && Array.isArray(lkg.data) ? { snapshot: lkg, stale: true } : null;
}

/** Shared snapshots are filtered by server-resolved ownership before returning any fixture. */
export async function getMyMatchesResilient(userId: string, ownedClubs: Club[], seasonId: string, status?: string) {
  if (!ownedClubs.length) return { fixtures: [] as Fixture[], stale: false, degraded: false, source: 'no-club' };
  const ids = new Set(ownedClubs.map(c => c.id));
  const [admin, catalog] = await Promise.all([
    cached<Fixture>(ReadModelKeys.adminFixtures(seasonId)),
    cached<Competition>(ReadModelKeys.competitions(seasonId)),
  ]);
  const compIds = [...new Set([
    ...(catalog?.snapshot.data || SEED_COMPETITIONS).filter(c => c.seasonId === seasonId &&
      (ownedClubs.some(club => club.leagueId === c.leagueId) || c.type === 'EUROPEAN_LEAGUE_PHASE' || c.type === 'EUROPEAN_KNOCKOUT' || !c.leagueId)).map(c => c.id),
    ...(admin?.snapshot.data || []).filter(f => f.seasonId === seasonId && (ids.has(f.homeClubId || '') || ids.has(f.awayClubId || ''))).map(f => f.competitionId),
  ])];
  const parts = await Promise.all(compIds.map(async id => ({ id, result: await cached<Fixture>(ReadModelKeys.competitionFixtures(id,seasonId)) })));
  let rows = admin?.snapshot.data || [];
  let stale = Boolean(admin?.stale);
  const times: string[] = admin ? [admin.snapshot.generatedAt] : [];
  const covered = new Set(rows.map(f => f.competitionId));
  // Replace the entire competition slice: a new cup draw can have different IDs.
  for (const {id,result} of parts) if (result) {
    if (admin && covered.has(id) && (Date.parse(result.snapshot.generatedAt) || 0) < (Date.parse(admin.snapshot.generatedAt) || 0)) continue;
    rows = [...rows.filter(f => f.competitionId !== id), ...result.snapshot.data];
    covered.add(id); stale ||= result.stale; times.push(result.snapshot.generatedAt);
  }
  const snapshotAvailable = Boolean(admin || parts.some(p => p.result));
  if (!snapshotAvailable) {
    if (firestoreCircuitBreaker.getStatus().state !== 'CLOSED') throw new ReadModelNotWarmedError('MY_MATCHES_CACHE_UNAVAILABLE');
    return { fixtures: await getFixturesFirestore({userId,seasonId,status}), stale:false,degraded:false,source:'firestore' };
  }
  rows = rows.filter(f => (!f.seasonId || f.seasonId === seasonId) && (ids.has(f.homeClubId || '') || ids.has(f.awayClubId || '')));
  const relevantCatalog = (catalog?.snapshot.data || SEED_COMPETITIONS).filter(c => c.seasonId === seasonId && c.type === 'LEAGUE' && ownedClubs.some(club => club.leagueId === c.leagueId));
  const partial = relevantCatalog.some(c => !covered.has(c.id));
  if (!rows.length && partial) {
    if (firestoreCircuitBreaker.getStatus().state !== 'CLOSED') throw new ReadModelNotWarmedError('MY_MATCHES_CACHE_UNAVAILABLE');
    return { fixtures: await getFixturesFirestore({userId,seasonId,status}),stale:false,degraded:false,source:'firestore' };
  }
  rows = rows.map(f => ({ ...normalizeFixtureSnapshot(f,seasonId), ...f }));
  rows = await filterTombstonedFixtures(rows,seasonId);
  rows = await enrichFixturesWithAuthoritativeOwners(rows,seasonId);
  await getAllCompetitionsFirestore(seasonId);
  rows = await refreshFixtureMatchdayRules(rows,seasonId);
  // Shared caches never carry another request's personalized submission fields.
  rows = rows.map(({userSubmission,opponentSubmission,...f}) => ({...f}));
  if (status) rows = rows.filter(f => f.status === status);
  return { fixtures:sortSeasonFixtures(rows),stale:stale || partial,degraded:stale || partial,partial,source:'redis',snapshotAt:times.filter(Boolean).sort()[0] };
}
