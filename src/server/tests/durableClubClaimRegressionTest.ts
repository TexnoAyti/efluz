import assert from 'node:assert/strict';
import express from 'express';
import { clubsRouter } from '../routes/clubs.routes';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { SEED_CLUBS } from '../db/seed';
import { getUpstashClient, resetUpstashClient, ReadModelKeys, redisSetRaw, getUserActiveClubFromReadModel, getFreshKey } from '../readModel/readModelStore';
import { requestDurableClubClaim, getClubClaimReceipt, CLUB_CLAIM_KEYS } from '../services/durableClubClaim';
import { processPendingMutations } from '../sync/mutationQueue';
import { getClubAdmissionStatus } from '../services/clubAdmission';
import { OUTBOX_KEYS } from '../outbox/redisOutbox';
assert.equal(process.env.NODE_ENV,'test');
assert.ok(process.env.REDIS_TEST_PORT,'Run through actual Redis durability suite');
const client=getUpstashClient()!, db=getFirestoreDb(), season='season-2026-27';
const clubs=['club-bochum','club-heidenheim','club-hoffenheim'];
for(const id of clubs){assert.ok(SEED_CLUBS.some(c=>c.id===id),id);await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${season}_${id}`).delete();await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${season}_${id}`).delete();}
await client.del(OUTBOX_KEYS.pending()); // isolate this replay batch from earlier test fixtures
const catalog=SEED_CLUBS.map(c=>({...c,name:c.name,active:true,ownerUserId:null,ownerUsername:null,isOccupied:false,isTaken:false}));
assert.equal(catalog.length,96);
await redisSetRaw(ReadModelKeys.clubsWithOwners(season),{data:catalog});
await redisSetRaw(ReadModelKeys.clubAdmission(season),{data:{enabled:false,stage:-1,seasonId:season}});
firestoreCircuitBreaker.forceState('OPEN');
const originalCollection=db.collection.bind(db);let firestoreReads=0;
db.collection=(()=>{firestoreReads++;throw new Error('RESOURCE_EXHAUSTED');}) as any;
let accepted:any, actor='';
try{
 await client.del(getFreshKey(ReadModelKeys.clubAdmission(season)));
 firestoreCircuitBreaker.forceState('CLOSED');
 assert.equal((await getClubAdmissionStatus(season)).stale,true);assert.equal(firestoreReads,0,'Cold admission read uses durable cache without database probe');
 firestoreCircuitBreaker.forceState('OPEN');
 const parallel=await Promise.allSettled(Array.from({length:12},(_,i)=>requestDurableClubClaim('claim-user-'+i,clubs[0],season)));
 const winners=parallel.map((r,i)=>({r,i})).filter(x=>x.r.status==='fulfilled');assert.equal(winners.length,1);
 accepted=(winners[0].r as PromiseFulfilledResult<any>).value;actor='claim-user-'+winners[0].i;
 assert.equal(accepted.pendingSync,true);assert.equal(accepted.request.status,'PENDING');assert.equal(firestoreReads,0);
 assert.ok(!accepted.club.isCurrentUserClub && !accepted.club.isTaken,'Pending intent is not final ownership');
 assert.equal((await requestDurableClubClaim(actor,clubs[0],season)).request.id,accepted.request.id,'Retry retains same receipt');
 await assert.rejects(requestDurableClubClaim(actor,clubs[1],season),(e:any)=>e.code==='CLUB_CLAIM_PENDING');
 assert.equal(await client.ttl(CLUB_CLAIM_KEYS.club(season,clubs[0])),-1,'Reservation never expires while unsynced');
 resetUpstashClient();assert.equal((await getClubClaimReceipt(actor,season))?.id,accepted.request.id,'Fresh process recovers durable receipt');
 assert.equal((await processPendingMutations()).processed,0,'No writes while circuit is open');
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.headers['x-isolated-user']) req.user={id:String(req.headers['x-isolated-user'])} as any;next();});app.use('/api/clubs',clubsRouter);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port+'/api/clubs';
 try {
  assert.equal((await fetch(url+'/claim-status')).status,401);
  const own=await fetch(url+'/claim-status',{headers:{'x-isolated-user':actor}});assert.equal(own.status,200);assert.equal((await own.json() as any).request.id,accepted.request.id);
  const stranger=await fetch(url+'/claim-status?userId='+actor,{headers:{'x-isolated-user':'other-account'}});assert.equal((await stranger.json() as any).request,null,'Cannot fetch another account intent');
  const retried=await fetch(url+'/'+clubs[0]+'/claim',{method:'POST',headers:{'x-isolated-user':actor,'Content-Type':'application/json'},body:JSON.stringify({seasonId:season})});assert.equal(retried.status,202);const body=await retried.json() as any;assert.equal(body.pendingSync,true);assert.equal(body.request.id,accepted.request.id);assert.ok(!body.club.isTaken);assert.equal(firestoreReads,0);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}

 const healthy=global.fetch;try{global.fetch=async()=>{throw new Error('Redis unavailable');};await assert.rejects(requestDurableClubClaim('claim-new-user',clubs[1],season));}finally{global.fetch=healthy;resetUpstashClient();}
}finally{db.collection=originalCollection;}
console.log('PASS actual Redis: 12 concurrent requests -> one durable reservation, same-user retry, one pending club per user, restart recovery, no Firestore/confirmed owner during quota, Redis failure rejects acceptance');
await db.collection(COLLECTIONS.USERS).doc(actor).set({id:actor,telegramId:'700123',isSuspended:false});
await db.collection('club_admissions').doc(season).set({enabled:false,stage:-1});
firestoreCircuitBreaker.forceState('OPEN');firestoreCircuitBreaker.setCooldown(0);
await processPendingMutations(); // exercise reserved HALF_OPEN probe through actual transaction
firestoreCircuitBreaker.setCooldown(60000);
assert.equal((await getClubClaimReceipt(actor,season))?.status,'SYNCED');
assert.equal((await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${season}_${clubs[0]}`).get()).data()?.userId,actor);
await processPendingMutations();assert.equal((await getClubClaimReceipt(actor,season))?.status,'SYNCED');
db.collection=(()=>{throw new Error('Quota after successful commit');}) as any;
try { assert.equal((await getUserActiveClubFromReadModel(actor,season))?.id,clubs[0],'Committed owner is published durably before synced receipt'); }finally{db.collection=originalCollection;}
console.log('PASS actual Redis + original Firestore transaction: half-open recovery, exact owner, synced receipt and idempotent replay');
// A previously free cached club may have been assigned while disconnected: authoritative conflict is terminal.
await redisSetRaw(ReadModelKeys.clubsWithOwners(season),{data:catalog});
const conflict=await requestDurableClubClaim('claim-conflict-user',clubs[1],season);
await db.collection(COLLECTIONS.USERS).doc('claim-conflict-user').set({id:'claim-conflict-user',isSuspended:false});
await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${season}_${clubs[1]}`).set({userId:'other-real-owner',status:'active',clubId:clubs[1],seasonId:season});
firestoreCircuitBreaker.forceState('CLOSED');await processPendingMutations();
assert.equal((await getClubClaimReceipt('claim-conflict-user',season))?.status,'FAILED');
assert.equal((await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${season}_${clubs[1]}`).get()).data()?.userId,'other-real-owner');
await client.zadd(OUTBOX_KEYS.pending(),{score:Date.now(),member:conflict.request.id});await processPendingMutations();
assert.equal((await getClubClaimReceipt('claim-conflict-user',season))?.status,'FAILED');
// Permission changes while pending are checked inside the original claim transaction.
await requestDurableClubClaim('claim-suspended',clubs[2],season);
await db.collection(COLLECTIONS.USERS).doc('claim-suspended').set({id:'claim-suspended',isSuspended:true});
firestoreCircuitBreaker.forceState('CLOSED');await processPendingMutations();
assert.equal((await getClubClaimReceipt('claim-suspended',season))?.status,'FAILED');
assert.equal((await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${season}_${clubs[2]}`).get()).exists,false);
console.log('PASS authoritative occupied-club conflict and revoked user become terminal; no ownership overwritten, no fake success or endless retry');
firestoreCircuitBreaker.forceState('CLOSED');

await client.del(OUTBOX_KEYS.pending());await client.set(OUTBOX_KEYS.pending(),'invalid-type');
try { await assert.rejects(requestDurableClubClaim('claim-type-user',clubs[2],season)); assert.equal(await client.get(CLUB_CLAIM_KEYS.latest(season,'claim-type-user')),null,'Wrong outbox key type cannot leave a reservation without replay data'); }finally{await client.del(OUTBOX_KEYS.pending());}
console.log('PASS actual Redis: invalid outbox type rejects atomically without orphan reservation');
