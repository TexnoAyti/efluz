import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { seedDatabase } from '../db/seed';
import { claimClubAtomicFirestore } from '../firebase/firestoreStore';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFreshKey, ReadModelKeys, redisDelRaw } from '../readModel/readModelStore';
import { CLUB_ADMISSION_LEAGUES, advanceClubAdmission, getClubAdmissionStatus } from '../services/clubAdmission';

async function run() {
  await initDatabase();
  seedDatabase();
  const seasonId = 'season-2026-27';
  let status = await getClubAdmissionStatus(seasonId);
  assert.equal(status.enabled, false, 'existing seasons retain open selection until an admin starts stages');

  status = await advanceClubAdmission(seasonId, -1, 'admin-test');
  assert.equal(status.activeLeagueId, 'league-premier-league');
  await assert.rejects(() => advanceClubAdmission(seasonId, -1, 'admin-test'), (err: any) => err.code === 'ADMISSION_STAGE_CHANGED');
  await assert.rejects(
    () => claimClubAtomicFirestore('user-admission-rejected', 'club-real-madrid', seasonId, { authoritativeOnly: true }),
    (err: any) => err.code === 'CLUB_ADMISSION_CLOSED',
  );
  await claimClubAtomicFirestore('user-admission-pl', 'club-arsenal', seasonId, { authoritativeOnly: true });

  status = await advanceClubAdmission(seasonId, 0, 'admin-test');
  assert.equal(status.activeLeagueId, 'league-la-liga');
  await claimClubAtomicFirestore('user-admission-pl', 'club-arsenal', seasonId, { authoritativeOnly: true }); // existing owner stays valid
  await assert.rejects(
    () => claimClubAtomicFirestore('user-admission-rejected', 'club-chelsea', seasonId, { authoritativeOnly: true }),
    (err: any) => err.code === 'CLUB_ADMISSION_CLOSED',
  );
  await claimClubAtomicFirestore('user-admission-la-liga', 'club-real-madrid', seasonId, { authoritativeOnly: true });

  for (let stage = 1; stage < status.leagues.length; stage++) status = await advanceClubAdmission(seasonId, stage, 'admin-test');
  assert.equal(status.activeLeagueId, null);
  await assert.rejects(() => claimClubAtomicFirestore('user-admission-final', 'club-barcelona', seasonId, { authoritativeOnly: true }), (err: any) => err.code === 'CLUB_ADMISSION_CLOSED');

  // The last committed stage remains visible during Firestore outages; unknown seasons fail closed.
  const db = getFirestoreDb();
  const originalCollection = db.collection.bind(db);
  db.collection = (() => { throw new Error('Cached admission must not read Firestore'); }) as any;
  try {
    assert.equal((await getClubAdmissionStatus(seasonId)).stage, CLUB_ADMISSION_LEAGUES.length);
  } finally {
    db.collection = originalCollection;
  }
  await redisDelRaw(getFreshKey(ReadModelKeys.clubAdmission(seasonId)));
  db.collection = (() => { throw Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'), { code: 8 }); }) as any;
  try {
    const cached = await getClubAdmissionStatus(seasonId);
    assert.equal(cached.stage, CLUB_ADMISSION_LEAGUES.length);
    assert.equal(cached.stale, true);
    await assert.rejects(() => getClubAdmissionStatus('season-admission-uncached'), (err: any) => err.errorCode === 'READ_MODEL_NOT_WARMED');
  } finally {
    db.collection = originalCollection;
    firestoreCircuitBreaker.reset();
  }
  console.log('Club admission stages regression: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
