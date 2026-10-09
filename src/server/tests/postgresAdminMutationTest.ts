import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { redisSetRaw, redisGetFresh, ReadModelKeys, refreshChangedFixtureReadModel, patchCompetitionMatchdayCatalog, clearProcessMemoryCache, getUpstashClient } from '../readModel/readModelStore';
import { getNotificationControls, setNotificationTypeVisibility, setNotificationVisibility } from '../services/notificationVisibility';
import { getNotificationReadState, persistNotificationReadState } from '../services/notificationReadState';
import { authMiddleware } from '../middleware/authMiddleware';
import { createSessionToken } from '../auth/sessionToken';
import { adminRouter } from '../routes/admin.routes';

await initDatabase();
const db = getFirestoreDb();
process.env.DATABASE_PROVIDER = 'supabase';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis-outage.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'isolated-token';
const client = getUpstashClient()!;
client.eval = async () => { throw Error('Redis mutation must not run'); };
client.hgetall = async () => { throw Error('Redis visibility must not run'); };
const seasonId = 'season-2026-27', competitionId = 'comp-serie-a-2026';
const fixture = { id: 'pg-admin-result', seasonId, competitionId, homeClubId:'club-inter',awayClubId:'club-milan',matchday:3,status:'SCHEDULED',updatedAt:'2026-10-09T00:00:00Z' };
await db.collection(COLLECTIONS.FIXTURES).doc(fixture.id).set(fixture);
await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).set({id:competitionId,seasonId,type:'LEAGUE',currentMatchday:1});
for(const key of [ReadModelKeys.adminFixtures(seasonId),ReadModelKeys.competitionFixtures(competitionId,seasonId)]) await redisSetRaw(key,{data:[fixture]});
await db.collection(COLLECTIONS.FIXTURES).doc(fixture.id).update({homeScore:0,awayScore:3,status:'CONFIRMED',updatedAt:'2026-10-09T00:01:00Z'});
await refreshChangedFixtureReadModel(fixture.id);
clearProcessMemoryCache();
assert.equal((await redisGetFresh<any[]>(ReadModelKeys.adminFixtures(seasonId)))?.data[0].awayScore,3);
await redisSetRaw(ReadModelKeys.competitions(seasonId),{data:[{id:competitionId,currentMatchday:1,name:'Serie A'}]});
await patchCompetitionMatchdayCatalog({id:competitionId,seasonId,currentMatchday:3,updatedAt:'2026-10-09T00:01:00Z'} as any);
assert.equal((await redisGetFresh<any[]>(ReadModelKeys.competitions(seasonId)))?.data[0].currentMatchday,3);
assert.equal((await redisGetFresh<any[]>(ReadModelKeys.competitions(seasonId)))?.data[0].name,'Serie A');
await setNotificationTypeVisibility('SYSTEM',false);
await setNotificationTypeVisibility('RESULT_CONFIRMED',false);
assert.equal((await getNotificationControls())['type:SYSTEM'],'hidden');
await persistNotificationReadState('test-admin','2026-10-09T01:00:00Z');
await persistNotificationReadState('test-admin','2026-10-09T00:00:00Z');
assert.equal((await getNotificationReadState('test-admin')).all,'2026-10-09T01:00:00Z');
assert.deepEqual(await getNotificationReadState('other-user'),{});
await db.collection(COLLECTIONS.NOTIFICATIONS).doc('notice').set({userId:'test-admin',type:'SYSTEM',title:'Test',message:'Test',createdAt:'2026-10-09T00:00:00Z'});
await setNotificationVisibility('notice','deleted','test-admin');
await assert.rejects(setNotificationVisibility('notice','visible','test-admin'),/NOTIFICATION_DELETED/);
process.env.SESSION_SECRET = 'isolated-admin-http-secret-32bytes';
await db.collection(COLLECTIONS.USERS).doc('test-admin').set({telegramId:'123',isAdmin:true,username:'test'});
const app=express();app.use(express.json());app.use(authMiddleware);app.use('/api/admin',adminRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const token=createSessionToken({id:'test-admin',telegramId:'123',username:'test',isAdmin:true,isSuspended:false,firstName:'',lastName:'',photoUrl:'',createdAt:'',updatedAt:''});
try {
  const saved=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/admin/fixtures/${fixture.id}/result`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({homeScore:2,awayScore:1,status:'CONFIRMED',idempotencyKey:'isolated-postgres-admin-result'})});
  const savedBody:any=await saved.json();
  assert.equal(saved.status,200,JSON.stringify(savedBody));
  assert.equal(savedBody.success,true);
  assert.equal((await db.collection(COLLECTIONS.FIXTURES).doc(fixture.id).get()).data()?.homeScore,2);
  assert.equal((await redisGetFresh<any[]>(ReadModelKeys.adminFixtures(seasonId)))?.data[0].homeScore,2);
  for(const path of ['notifications','notifications/messages','telegram-notifications/recipients']) {
    const res=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/admin/${path}`,{headers:{Authorization:`Bearer ${token}`}});
    const body:any = await res.json();
    assert.equal(res.status,200,JSON.stringify(body));
    assert.ok(Array.isArray(path.includes('recipients') ? body.recipients : body.notifications));
    if (path.includes('recipients')) { assert.equal(body.total,1); assert.equal('telegramId' in body.recipients[0],false); }
  }
} finally {server.close();}
console.log('PASS authenticated result POST, PostgreSQL result snapshots, matchday patch, visibility tombstones, and notification routes with broken Redis');
