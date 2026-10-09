import { createHash } from 'node:crypto';
import { readSharedAdminData } from './adminReviewCache';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { enrichFixturesWithAuthoritativeOwners, trackFirestoreRead, refreshFixtureMatchdayRules } from '../firebase/firestoreStore';
import {
  getCompetitionFixturesFromReadModel,
  normalizeFixtureSnapshot,
  ReadModelKeys,
  redisSetRaw,
  SCHEMA_VERSION,
} from '../readModel/readModelStore';
import { Club, Fixture } from '../../types';

const DOMESTIC_CUP_BY_LEAGUE: Record<string, string> = {
  'league-premier-league': 'comp-fa-cup-2026',
  'league-la-liga': 'comp-copa-del-rey-2026',
  'league-serie-a': 'comp-coppa-italia-2026',
  'league-bundesliga': 'comp-dfb-pokal-2026',
  'league-ligue-1': 'comp-coupe-de-france-2026',
};

async function loadAuthoritativeCupFixtures(competitionId: string, seasonId: string): Promise<Fixture[]> {
  const db = getFirestoreDb();
  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await db.collection(COLLECTIONS.FIXTURES)
      .where('competitionId', '==', competitionId)
      .where('seasonId', '==', seasonId)
      .get();
  } catch (error: any) {
    if (error?.code !== 9 && !/index|FAILED_PRECONDITION/i.test(String(error?.message))) {
      firestoreCircuitBreaker.recordFailure(error);
      throw error;
    }
    // Avoid making the repair depend on a composite index being present.
    snap = await db.collection(COLLECTIONS.FIXTURES)
      .where('competitionId', '==', competitionId)
      .get();
  }

  trackFirestoreRead(COLLECTIONS.FIXTURES, Math.max(1, snap.docs.length), 'myMatches:cupHeal');
  const fixtures = snap.docs
    .map((doc) => normalizeFixtureSnapshot({ id: doc.id, ...doc.data() }, seasonId))
    .filter((fixture) => !fixture.seasonId || fixture.seasonId === seasonId);

  if (fixtures.length > 0) {
    const now = new Date().toISOString();
    await redisSetRaw(ReadModelKeys.competitionFixtures(competitionId, seasonId), {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: now,
      sourceVersion: `cup-authoritative-heal-${now}`,
      expectedCount: fixtures.length,
      actualCount: fixtures.length,
      data: fixtures,
      source: 'firestore_cup_authoritative_heal',
      stale: false,
      degraded: false,
    }, 86400).catch(() => {});
  }

  return fixtures;
}

export async function canonicalizeMyDomesticCupFixtures(
  fixtures: Fixture[],
  currentClub: Club | Club[] | null | undefined,
  seasonId: string
): Promise<Fixture[]> {
  if (Array.isArray(currentClub)) {
    let result = fixtures;
    for (const club of currentClub) result = await canonicalizeMyDomesticCupFixtures(result, club, seasonId);
    return result;
  }
  if (!currentClub?.id || !currentClub.leagueId) return fixtures;
  const cupId = DOMESTIC_CUP_BY_LEAGUE[currentClub.leagueId];
  if (!cupId) return fixtures;

  let cupFixtures: Fixture[] = [];
  let degradedCup = false;
  try {
    const readModel = await getCompetitionFixturesFromReadModel(cupId, { seasonId, allowFirestore: false });
    cupFixtures = readModel.fixtures;
    degradedCup = Boolean(readModel.stale || readModel.degraded);
    // A redraw invalidates Fresh Redis but deliberately preserves LKG. My Matches
    // must not keep serving that old opponent indefinitely, so a stale cup snapshot
    // is healed once from authoritative Firestore and written back to Redis.
    if ((readModel.stale || readModel.degraded) && firestoreCircuitBreaker.getStatus().state === 'CLOSED') {
      try {
        const signature = createHash('sha256').update(JSON.stringify([seasonId, cupId, readModel.snapshotAt, cupFixtures.map(f => [f.id, f.updatedAt, f.status])])).digest('hex');
        const healed = await readSharedAdminData('efluz:v1:cup-heal:' + signature, async () => ({ fixtures: await loadAuthoritativeCupFixtures(cupId, seasonId), stale: false, degraded: false, source: 'firestore' }), 60);
        if (healed.fixtures.length) cupFixtures = healed.fixtures;
        degradedCup = healed.stale || healed.degraded;
      }
      catch { /* Keep the last-known cup draw on quota/network failure. */ }
    }
  } catch { /* Preserve the known fixture list; never scan on every cache miss. */ }

  if (cupFixtures.length === 0) return fixtures;

  const canonicalForClub = cupFixtures.filter(
    (fixture) => fixture.homeClubId === currentClub.id || fixture.awayClubId === currentClub.id
  );
  const staleById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const mergedCup = canonicalForClub.map((canonical) => {
    const previous = staleById.get(canonical.id);
    return {
      ...(previous || {}),
      ...canonical,
      // Never carry the previous draw's club/opponent objects over canonical IDs.
      homeClub: canonical.homeClub,
      awayClub: canonical.awayClub,
      homeClubId: canonical.homeClubId,
      awayClubId: canonical.awayClubId,
      isPlayable: degradedCup ? previous?.isPlayable === true : canonical.isPlayable === true,
      activeMatchday: canonical.matchday,
    } as Fixture;
  });

  const gatedCup = degradedCup ? mergedCup : await refreshFixtureMatchdayRules(mergedCup, seasonId);
  const enrichedCup = await enrichFixturesWithAuthoritativeOwners(gatedCup, seasonId).catch(() => gatedCup);
  const nonCup = fixtures.filter((fixture) => fixture.competitionId !== cupId);
  return [...nonCup, ...enrichedCup];
}
