import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { migrateFixturesTableIfNeeded } from '../db/migrateFixtures';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { buildAdminFixturesSnapshot, redisSetRaw, redisGetLkg, redisGetFresh, invalidateDataset, readThroughReadModel, resetMemoryRedisStore, ReadModelKeys, enrichClubForUser, getUserActiveClubFromReadModel, buildClubsSnapshot, buildCompetitionsSnapshot } from '../readModel/readModelStore';
import { firestoreCircuitBreaker, submitFixtureResultFirestore } from '../firebase/firestoreStore';
import { advanceDomesticCupWinnerSafe } from '../tournament/domesticCupService';
import { generateKnockoutBracket } from '../tournament/knockoutEngine';
import { enqueueMutation } from '../sync/mutationQueue';
import { initDatabase } from '../db';

async function main() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`PRAGMA foreign_keys=OFF;
    CREATE TABLE fixtures(id TEXT PRIMARY KEY, home_club_id TEXT NOT NULL, away_club_id TEXT NOT NULL, custom_field TEXT, home_score INTEGER, away_score INTEGER);
    CREATE INDEX custom_fixture_index ON fixtures(custom_field);
    CREATE TABLE changes(id TEXT);
    CREATE TRIGGER custom_fixture_trigger AFTER INSERT ON fixtures BEGIN INSERT INTO changes VALUES(new.id); END;
    INSERT INTO fixtures VALUES('saved','club-barcelona','TBD','keep me',3,1);`);
  assert.equal(migrateFixturesTableIfNeeded(db).recordsPreserved, 1);
  assert.deepEqual(db.exec('SELECT * FROM fixtures')[0].values[0].slice(0,6), ['saved','club-barcelona',null,'keep me',3,1]);
  assert.equal(db.exec('PRAGMA foreign_keys')[0].values[0][0], 0);
  assert.equal(db.exec("SELECT count(*) FROM sqlite_master WHERE name IN ('custom_fixture_index','custom_fixture_trigger')")[0].values[0][0], 2);
  assert.equal(migrateFixturesTableIfNeeded(db).migrated, false);
  db.run("INSERT INTO fixtures(id,home_club_id,away_club_id) VALUES('next',NULL,NULL)");
  assert.equal(db.exec('SELECT count(*) FROM changes')[0].values[0][0], 2);
  const rollback = new SQL.Database();
  rollback.run("CREATE TABLE fixtures(id TEXT PRIMARY KEY,home_club_id TEXT NOT NULL,away_club_id TEXT NOT NULL); INSERT INTO fixtures VALUES('old','TBD','club-a'); CREATE TABLE fixtures_migration_temp(x TEXT);");
  assert.throws(() => migrateFixturesTableIfNeeded(rollback));
  assert.equal(rollback.exec('SELECT home_club_id FROM fixtures')[0].values[0][0], 'TBD');
  rollback.run('BEGIN; ROLLBACK;');
  console.log('PASS: SQLite columns, scores, indexes, triggers, FK setting, repeat migration and rollback');

  resetMemoryRedisStore();
  const key = 'safety:preserve';
  await redisSetRaw(key, { data: [{ id: 'real-owner' }] });
  await assert.rejects(redisSetRaw(key, { data: [] }), /SNAPSHOT_REJECTED/);
  assert.equal((await redisGetFresh<any[]>(key))?.data[0].id, 'real-owner');
  await invalidateDataset(key);
  assert.equal(await redisGetFresh(key), null);
  let calls = 0;
  const result = await readThroughReadModel({ key, firestoreFetcher: async () => { calls++; throw new Error('quota'); } });
  assert.equal(result.stale, true);
  assert.equal((await redisGetLkg<any[]>(key))?.data[0].id, 'real-owner');
  assert.equal(calls, 1);
  assert.equal((enrichClubForUser({ id: 'club-a', ownerUserId: 'real-owner', ownerUsername: 'player', telegramId: 'PRIVATE' } as any, 'other') as any).telegramId, undefined);
  console.log('PASS: empty-write rejection, LKG survival, truthful stale metadata and private-field removal');

  firestoreCircuitBreaker.recordSuccess();
  const firestore = getFirestoreDb();
  const seasonId = 'season-2026-27';
  await firestore.collection(COLLECTIONS.FIXTURES).doc('nullable').set({ id: 'nullable', seasonId, competitionId: 'comp-fa-cup-2026', homeClubId: null, awayClubId: 'TBD', matchday: 2, status: 'SCHEDULED' });
  const snapshot = await buildAdminFixturesSnapshot(seasonId);
  assert.equal(snapshot.data[0].homeClubId, null);
  assert.equal(snapshot.data[0].awayClubId, null);
  assert.equal(snapshot.data[0].homeClub, undefined);
  assert.equal(snapshot.data[0].awayClub, undefined);
  await firestore.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc('real').set({ seasonId, clubId: 'club-barcelona', userId: 'real-owner' });
  await firestore.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc('other-season').set({ seasonId: 'season-old', clubId: 'club-arsenal', userId: 'old-owner', status: 'active' });
  const clubs = await buildClubsSnapshot(seasonId);
  assert.equal(clubs.data.find(c => c.id === 'club-barcelona')?.ownerUserId, 'real-owner');
  assert.equal(clubs.data.find(c => c.id === 'club-arsenal')?.ownerUserId, null);
  await redisSetRaw(ReadModelKeys.userMembership('real-owner',seasonId), { data: { hasClub: false, club: null } });
  assert.equal((await getUserActiveClubFromReadModel('real-owner',seasonId))?.id, 'club-barcelona');
  await firestore.collection(COLLECTIONS.COMPETITIONS).doc('comp-fa-cup-2026').set({ seasonId, type: 'KNOCKOUT', name: 'FA Cup', currentMatchday: 4, status: 'completed', isMatchdayOpen: false, fixtureCount: 19 });
  const comps = await buildCompetitionsSnapshot(seasonId);
  assert.equal(comps.data[0].currentMatchday, 4);
  assert.equal(comps.data[0].status, 'completed');
  assert.equal(comps.data[0].isMatchdayOpen, false);
  console.log('PASS: nullable admin fixtures, legacy owner status, season isolation, negative membership cache and competition state');

  const sourceId = 'fix-comp-fa-cup-2026-r1-m0';
  const targetId = 'fix-comp-fa-cup-2026-r2-m4';
  const sourceRef = firestore.collection(COLLECTIONS.FIXTURES).doc(sourceId);
  const targetRef = firestore.collection(COLLECTIONS.FIXTURES).doc(targetId);
  await sourceRef.set({ id: sourceId, seasonId, competitionId: 'comp-fa-cup-2026', status: 'CONFIRMED', homeClubId: 'club-arsenal', awayClubId: 'club-chelsea', winnerClubId: 'club-arsenal' });
  await targetRef.set({ id: targetId, seasonId, competitionId: 'comp-fa-cup-2026', status: 'PLAYING', homeClubId: 'club-liverpool', awayClubId: 'club-arsenal' });
  const noop = await advanceDomesticCupWinnerSafe(sourceId, { adminUserId: 'real-admin' });
  assert.equal(noop.isNoop, true);
  const originalTransaction = firestore.runTransaction.bind(firestore);
  (firestore as any).runTransaction = async (fn: any) => {
    await sourceRef.update({ status: 'SCHEDULED', winnerClubId: null });
    return originalTransaction(fn);
  };
  await assert.rejects(advanceDomesticCupWinnerSafe(sourceId, { adminUserId: 'real-admin' }), /SOURCE_FIXTURE_CHANGED/);
  (firestore as any).runTransaction = originalTransaction;
  assert.equal((await targetRef.get()).data()?.awayClubId, 'club-arsenal');
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.throws(() => enqueueMutation({ mutationId: 'rejected', entityType: 'CLUB_CLAIM', entityId: 'club-arsenal', operation: 'claim', payload: {}, createdAt: new Date().toISOString() } as any), /not accepted/);
  process.env.NODE_ENV = originalEnv;
  console.log('PASS: started-target no-op, concurrent source correction blocks advancement, hosted ephemeral queue rejects acceptance');

  await initDatabase();
  const raceCompId = 'comp-result-race';
  const raceFixtureId = 'fix-result-race';
  await firestore.collection(COLLECTIONS.COMPETITIONS).doc(raceCompId).set({
    id: raceCompId, seasonId, name: 'Race Test', type: 'LEAGUE', currentMatchday: 1,
    isMatchdayOpen: true, adminOverrideStatus: 'AUTO', status: 'active', createdAt: new Date().toISOString(),
  });
  await firestore.collection(COLLECTIONS.FIXTURES).doc(raceFixtureId).set({
    id: raceFixtureId, seasonId, competitionId: raceCompId, matchday: 1, roundName: 'Matchday 1',
    homeClubId: 'club-race-home', awayClubId: 'club-race-away', status: 'SCHEDULED',
    scheduledAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await firestore.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_user-race-home`).set({
    userId: 'user-race-home', seasonId, clubId: 'club-race-home', status: 'active',
  });
  await firestore.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_user-race-away`).set({
    userId: 'user-race-away', seasonId, clubId: 'club-race-away', status: 'active',
  });
  await Promise.all([
    submitFixtureResultFirestore('user-race-home', raceFixtureId, 3, 2),
    submitFixtureResultFirestore('user-race-away', raceFixtureId, 3, 2),
  ]);
  const raceResult = (await firestore.collection(COLLECTIONS.FIXTURES).doc(raceFixtureId).get()).data();
  assert.equal(raceResult?.status, 'CONFIRMED');
  assert.equal(raceResult?.homeScore, 3);
  assert.equal(raceResult?.awayScore, 2);
  console.log('PASS: concurrent two-party submissions converge atomically to CONFIRMED');

  const europeanCompId = 'comp-european-guard';
  await firestore.collection(COLLECTIONS.COMPETITIONS).doc(europeanCompId).set({
    id: europeanCompId, seasonId, name: 'European Guard', type: 'EUROPEAN_LEAGUE_PHASE',
    formatConfig: { matchesPerTeam: 8 }, status: 'active', createdAt: new Date().toISOString(),
  });
  for (let i = 0; i < 32; i++) {
    await firestore.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(`${europeanCompId}-${i}`).set({
      id: `${europeanCompId}-${i}`, competitionId: europeanCompId, seasonId,
      clubId: `club-eu-${i}`, seedNumber: i + 1, createdAt: new Date().toISOString(),
    });
  }
  for (let i = 0; i < 128; i++) {
    await firestore.collection(COLLECTIONS.FIXTURES).doc(`${europeanCompId}-${i}`).set({
      id: `${europeanCompId}-${i}`, competitionId: europeanCompId, seasonId,
      matchday: Math.floor(i / 16) + 1, status: 'SCHEDULED', homeClubId: `club-eu-${i % 32}`,
      awayClubId: `club-eu-${(i + 1) % 32}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }
  await assert.rejects(generateKnockoutBracket(europeanCompId), /LEAGUE_PHASE_INCOMPLETE/);
  console.log('PASS: European knockout generation is blocked until every league-phase fixture is confirmed');
  console.log('All critical safety regression groups passed.');
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
