import {getSeasonAwards} from '../services/seasonInsightsService';
import {getPremiumCareerSnapshot} from '../services/premiumService';
import {loadSeasonOperationsFixtures} from '../services/seasonOperationsService';
import {markSingleNotificationReadFirestore, markNotificationsReadFirestore} from '../firebase/firestoreStore';
import {getNotificationReadState} from '../services/notificationReadState';
import {firestoreCircuitBreaker} from '../firebase/circuitBreaker';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {adminRouter} from '../routes/admin.routes';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {SEED_CLUBS} from '../db/seed';
import {notifySmartMatchdayOpened} from '../services/smartNotificationService';
import {processPendingMatchdayNotifications} from '../services/matchdayNotificationJobs';
import {processNotificationQueue, getBroadcastDetails} from '../services/telegramNotificationQueue';
import {PostgresNotificationStore} from '../services/postgresNotificationStore';
import {ReadModelKeys, redisSetRaw, redisGetFresh} from '../readModel/readModelStore';

export async function verifyPostgresMatchdayNotifications(failNextEnqueue: () => void, deliveries: string[]) {
  const previousNodeEnv = process.env.NODE_ENV;
  const db = getFirestoreDb(), seasonId = 'season-notification-native', competitionId = 'comp-notification-native';
  const clubs = SEED_CLUBS.slice(0, 20), users = clubs.map((_, i) => ({id: `user-${890000 + i}`, telegramId: String(890000 + i), username: `native${i}`, firstName: 'Native', isSuspended: false}));
  for (let i = 0; i < clubs.length; i++) {
    await db.collection('users').doc(users[i].id).set(users[i]);
    await db.collection('club_occupancies').doc(`${seasonId}_${clubs[i].id}`).set({seasonId, clubId: clubs[i].id, userId: users[i].id, status: 'active'});
  }
  await db.collection('competitions').doc(competitionId).set({id: competitionId, seasonId, type: 'LEAGUE', leagueId: 'league-test', currentMatchday: 1, totalMatchdays: 19, isMatchdayOpen: true, updatedAt: '2026-10-11T00:00:00Z'});
  for (let round = 1; round <= 2; round++) for (let i = 0; i < 10; i++) {
    const id = `${competitionId}-${round}-${i}`;
    await db.collection('fixtures').doc(id).set({id, seasonId, competitionId, matchday: round, status: round === 1 ? 'CONFIRMED' : 'SCHEDULED', homeClubId: clubs[i * 2].id, awayClubId: clubs[i * 2 + 1].id});
  }
  await redisSetRaw(ReadModelKeys.competitions(seasonId), {data: [(await db.collection('competitions').doc(competitionId).get()).data()]} as any);
  const admin = {id: 'user-5209126900', telegramId: '5209126900', username: 'nativeadmin', isAdmin: true, isSuspended: false, firstName: 'Native', lastName: '', photoUrl: '', createdAt: '', updatedAt: ''};
  await db.collection('users').doc(admin.id).set(admin);
  process.env.SESSION_SECRET = 'native-notification-http-secret-32bytes';
  process.env.TELEGRAM_BOT_TOKEN = 'isolated-claim-test';
  process.env.NODE_ENV = 'production';
  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use('/api/admin', adminRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    failNextEnqueue();
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/admin/competitions/${competitionId}/matchday/control`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${createSessionToken(admin)}`}, body: JSON.stringify({action: 'SELECT', matchday: 2, durationHours: 24, expectedUpdatedAt: '2026-10-11T00:00:00Z'})});
    const body: any = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal((await redisGetFresh<any[]>(ReadModelKeys.competitions(seasonId)))?.data[0].currentMatchday, 2, 'Visible catalog follows the committed round');
    assert.equal(body.smartNotificationsStatus, 'PENDING', 'Enqueue failure is visible, not silent zero-success');
    assert.equal((await db.collection('competitions').doc(competitionId).get()).data()?.currentMatchday, 2);
    assert.equal((await db.collection('matchday_notification_jobs').where('status', '==', 'PENDING').get()).size, 1, 'Round and recoverable intent commit together');
    await processPendingMatchdayNotifications();
    assert.equal((await db.collection('matchday_notification_jobs').where('status', '==', 'PENDING').get()).size, 0);
    const store = new PostgresNotificationStore();
    const jobs: any[] = await store.get('efluz:v1:telegram:queue') || [];
    assert.equal(jobs.length, 20, 'Cold snapshots and missing directory still enqueue all 20 current owners');
    const event = {competitionId, seasonId, matchday: 2, deadlineAt: body.nextMatchdayOpenAt};
    assert.equal(await notifySmartMatchdayOpened(event), 0, 'Retry deduplicates every successful recipient');
    // A changed owner cannot inherit the old recipient directory or fixture cache.
    const replacement = {id: 'user-890100', telegramId: '890100', username: 'replacement', isSuspended: false};
    await db.collection('users').doc(replacement.id).set(replacement);
    await db.collection('club_occupancies').doc(`${seasonId}_${clubs[0].id}`).update({userId: replacement.id});
    await redisSetRaw(ReadModelKeys.competitionFixtures(competitionId, seasonId), {data: [{id: 'stale', matchday: 2, homeOwnerId: users[0].id, awayOwnerId: 'old-owner'}]} as any);
    assert.equal(await notifySmartMatchdayOpened(event), 1, 'Transfer notifies the new owner using authoritative occupancy');
    await db.collection('users').doc(users[1].id).update({isSuspended: true});
    const before = deliveries.length;
    const result = await processNotificationQueue(25);
    assert.equal(result.succeeded, 20, 'Suspended recipient is skipped at actual dispatch');
    assert.equal(deliveries.length - before, 20); assert.ok(!deliveries.slice(before).includes(users[1].telegramId));
    assert.ok(deliveries.slice(before).includes(replacement.telegramId), 'New owner receives a message without directory refresh');
    for (const job of jobs) {
      const record = await getBroadcastDetails(job.broadcastId);
      assert.equal(record?.recipients[0].status, job.userId === users[1].id ? 'SKIPPED_NO_TELEGRAM' : 'SENT');
    }
    assert.equal((await processNotificationQueue(25)).processed, 0, 'Receipted delivery is never repeated');
    const reportSeason = 'season-report-native';
    await db.collection('club_occupancies').doc(`${reportSeason}_${clubs[0].id}`).set({seasonId: reportSeason, clubId: clubs[0].id, userId: replacement.id, status: 'active'});
    await db.collection('fixtures').doc('native-report-score').set({id: 'native-report-score', seasonId: reportSeason, competitionId: 'comp-premier-league-2026', matchday: 1, homeClubId: clubs[0].id, awayClubId: clubs[1].id, homeScore: 3, awayScore: 1, status: 'CONFIRMED'});
    const report = await loadSeasonOperationsFixtures(reportSeason);
    assert.equal(report.source, 'postgresql'); assert.equal(report.fixtures.length, 1);
    const awards = await getSeasonAwards(reportSeason);
    const leader = awards.awards.find(award => award.id === 'MOST_GOALS')?.leaders[0];
    assert.equal(leader?.value, 3); assert.equal(leader?.userId, replacement.id);
    const career = await getPremiumCareerSnapshot(replacement.id, reportSeason);
    assert.equal(career.overall.wins, 1); assert.equal(career.overall.goalsFor, 3);
    await db.collection('fixtures').doc('native-report-score').update({homeScore: 5});
    assert.equal((await getPremiumCareerSnapshot(replacement.id, reportSeason)).overall.goalsFor, 5, 'Cold reports read live PostgreSQL, not the bundled SQLite history');
    await db.collection('notifications').doc('native-read-notice').set({userId: replacement.id, createdAt: new Date().toISOString(), isRead: false});
    firestoreCircuitBreaker.forceState('OPEN');
    try {
      await assert.rejects(markSingleNotificationReadFirestore(users[0].id, 'native-read-notice'), /OWNERSHIP_MISMATCH/);
      await markSingleNotificationReadFirestore(replacement.id, 'native-read-notice');
      await markNotificationsReadFirestore(replacement.id);
      const state = await getNotificationReadState(replacement.id);
      assert.ok(state.all && state['notification:native-read-notice'], 'PostgreSQL acknowledgements do not depend on a Firestore circuit or Redis outbox');
    } finally { firestoreCircuitBreaker.reset(); }
    console.log('PASS native PostgreSQL cold season reports, current award/career owner and score updates; notification read ownership and durable acknowledgements with legacy circuit open.');
    console.log('PASS signed round-control HTTP → native PostgreSQL intent → recovered 20-player queue → mocked Telegram → durable receipts; cold cache, missing directory, current transfer, suspension and dedupe.');
  } finally { server.close(); delete process.env.TELEGRAM_BOT_TOKEN; process.env.NODE_ENV = previousNodeEnv; }
}
