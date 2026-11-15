import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {getOrCreateTelegramUserFirestore} from '../firebase/firestoreStore';
import {listSeasonGroupedClubOwnerExits} from '../services/clubOwnerGroupExitService';
await initDatabase();
const db=getFirestoreDb();
const old='2026-11-02T10:30:00.000Z',now='2026-11-15T19:45:00.000Z';
for(const [id,name,clubs] of [
 ['10101','Birinchi',{seasonId:'season-2026-27',clubId:'club-first',clubName:'Birinchi klub'}],
 ['20202','Ikkinchi',{seasonId:'season-2027-28',clubId:'club-second',clubName:'Ikkinchi klub'}],
] as const){
 await db.collection('club_owner_group_exits').doc(id).set({
  id,telegramId:id,userId:'user-'+id,name,username:name.toLowerCase(),
  state:'left',exitedAt:old,group:'efleagueuz',clubs:[clubs],lastUpdateId:1
 });
}
await db.collection('users').doc('user-10101').set({id:'user-10101',telegramId:'10101',
  username:'birinchi',firstName:'Birinchi',isAdmin:false,isSuspended:false,
  createdAt:old,updatedAt:now,lastWebAppOpenedAt:old});
await db.collection('users').doc('user-20202').set({id:'user-20202',telegramId:'20202',
  username:'ikkinchi',firstName:'Ikkinchi',isAdmin:false,isSuspended:false,
  createdAt:old,updatedAt:now});
const report=await listSeasonGroupedClubOwnerExits();
assert.equal(report.total,2);
const season1=report.bySeason.find(s=>s.seasonId==='season-2026-27');
const season2=report.bySeason.find(s=>s.seasonId==='season-2027-28');
assert.equal(season1?.total,1);
assert.equal(season2?.total,1);
assert.equal(season1?.owners[0].lastWebAppOpenedAt,old);
assert.equal(season2?.owners[0].lastWebAppOpenedAt,null,
 'Changing a user profile must never be mislabeled as visiting Web App');
const verified=await getOrCreateTelegramUserFirestore({id:20202,first_name:'Ikkinchi',username:'ikkinchi'});
assert.equal(verified.id,'user-20202');
const after=(await db.collection('users').doc('user-20202').get()).data() as any;
assert.ok(Number.isFinite(Date.parse(after.lastWebAppOpenedAt)));
const again=await getOrCreateTelegramUserFirestore({id:20202,first_name:'Ikkinchi',username:'ikkinchi'});
assert.equal(again.id,'user-20202');
assert.equal((await db.collection('users').doc('user-20202').get()).data()?.lastWebAppOpenedAt,
  after.lastWebAppOpenedAt,'Repeated login within 30 minutes must not rewrite visit timestamp');
assert.equal((await listSeasonGroupedClubOwnerExits()).bySeason[0].owners[0].lastWebAppOpenedAt,after.lastWebAppOpenedAt);
console.log('PASS season-isolated group-leavers report, unknown historic activity and throttled verified login timestamps');
