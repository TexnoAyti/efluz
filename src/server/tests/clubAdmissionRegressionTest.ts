import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { seedDatabase } from '../db/seed';
import { claimClubAtomicFirestore } from '../firebase/firestoreStore';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFreshKey, ReadModelKeys, redisDelRaw } from '../readModel/readModelStore';
import { CLUB_ADMISSION_LEAGUES, advanceClubAdmission, getClubAdmissionStatus } from '../services/clubAdmission';
import { clubsRouter } from '../routes/clubs.routes';

async function run() {
  await initDatabase();
  seedDatabase();
  const seasonId = 'season-2026-27';
  let status = await getClubAdmissionStatus(seasonId);
  assert.equal(status.enabled, false, 'existing seasons retain open selection until an admin starts stages');

  // Simultaneous first loads of an uncached season should share one Firestore read.
  const dbForConcurrentReads = getFirestoreDb();
  const originalConcurrentCollection = dbForConcurrentReads.collection.bind(dbForConcurrentReads);
  let admissionReads = 0;
  dbForConcurrentReads.collection = ((name: string) => {
    const collection = originalConcurrentCollection(name);
    if (name !== 'club_admissions') return collection;
    return { doc: (id: string) => {
      const ref = collection.doc(id);
      return { get: async () => {
        admissionReads++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return ref.get();
      } };
    } } as any;
  }) as any;
  try {
    const statuses = await Promise.all(Array.from({ length: 8 }, () => getClubAdmissionStatus('season-admission-concurrent')));
    assert.equal(admissionReads, 1);
    assert(statuses.every((item) => item.enabled === false));
  } finally {
    dbForConcurrentReads.collection = originalConcurrentCollection;
  }

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
    const app = express();
    app.use('/api/clubs', clubsRouter);
    const server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/clubs/admission?seasonId=season-admission-uncached`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-data-degraded'), 'true');
      assert.deepEqual(await response.json(), { admission: null, unavailable: true });
    } finally {
      server.close();
    }
  } finally {
    db.collection = originalCollection;
    firestoreCircuitBreaker.reset();
  }
  console.log('Club admission stages regression: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
