import {setClubSelectionBan} from '../services/clubSelectionBan';
import {claimClubAtomicFirestore,adminAssignClubFirestore} from '../firebase/firestoreStore';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {clubsRouter} from '../routes/clubs.routes';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {getUpstashClient} from '../readModel/readModelStore';
import {SEED_CLUBS} from '../db/seed';

/** Real signed HTTP controller with native PostgreSQL writes; Telegram transport is mocked by the caller. */
export async function verifyPostgresClubClaimHttp(failNextCommit:()=>void,failNextBanCommit:()=>void) {
  const db=getFirestoreDb(), season='season-2026-27';
  const candidates=SEED_CLUBS.slice(4,9);
  for(const club of candidates) await db.collection('clubs').doc(club.id).set({...club,logo:club.logoUrl,isActive:true});
  await db.collection('club_admissions').doc(season).set({enabled:false});
  const actors=Array.from({length:5},(_,i)=>({id:`user-${810001+i}`,telegramId:String(810001+i),firstName:'Isolated',lastName:'',username:'',photoUrl:'',isAdmin:false,isSuspended:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
  for(const actor of actors)await db.collection('users').doc(actor.id).set(actor);
  process.env.SESSION_SECRET='isolated-club-claim-http-secret-32bytes';
  process.env.TELEGRAM_BOT_TOKEN='isolated-claim-test';
  process.env.UPSTASH_REDIS_REST_URL='https://redis-forbidden.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN='isolated-token';
  assert.equal(getUpstashClient(),null);
  const app=express();app.use(express.json());app.use(authMiddleware);app.use('/api/clubs',clubsRouter);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const claim=async(i:number,clubId:string)=>{
    const response=await fetch(`${base}/api/clubs/${clubId}/claim`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${createSessionToken(actors[i])}`},body:JSON.stringify({seasonId:season})});
    return {status:response.status,body:await response.json() as any};
  };
  try {
    const first=await claim(0,candidates[0].id);
    assert.equal(first.status,200,JSON.stringify(first.body));
    assert.equal(first.body.success,true);assert.equal(first.body.pendingSync,false);
    assert.equal(first.body.request,undefined,'A committed PostgreSQL claim is not a queued Redis receipt');
    for(const collection of ['club_occupancies','club_memberships'])assert.equal((await db.collection(collection).doc(`${season}_${candidates[0].id}`).get()).data()?.userId,actors[0].id);
    assert.equal((await db.collection('user_memberships').doc(`${season}_${actors[0].id}`).get()).data()?.clubId,candidates[0].id);
    assert.equal((await db.collection('clubs').doc(candidates[0].id).get()).data()?.claimedByUserId,actors[0].id);
    assert.equal((await claim(0,candidates[0].id)).status,200,'Retry is idempotent');
    assert.equal((await claim(0,candidates[1].id)).status,409,'Ordinary user still cannot claim a second club');
    const parallel=await Promise.all([1,2].map(i=>claim(i,candidates[1].id)));
    assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409],'One durable winner for simultaneous claims');
    const winner=parallel[0].status===200?1:2;
    assert.equal((await db.collection('club_occupancies').doc(`${season}_${candidates[1].id}`).get()).data()?.userId,actors[winner].id);
    await db.collection('club_admissions').doc(season).set({enabled:true,stage:5});
    assert.equal((await claim(3,candidates[2].id)).status,409,'Closed admission is enforced transactionally');
    await db.collection('club_admissions').doc(season).set({enabled:false});
    failNextCommit();
    const rejected=await claim(3,candidates[2].id);assert.ok(rejected.status>=500,JSON.stringify(rejected));
    for(const collection of ['club_occupancies','club_memberships'])assert.equal((await db.collection(collection).doc(`${season}_${candidates[2].id}`).get()).exists,false,'Failed commit cannot acknowledge or partially write a claim');
    assert.equal((await db.collection('user_memberships').doc(`${season}_${actors[3].id}`).get()).exists,false);
    assert.equal((await db.collection('clubs').doc(candidates[2].id).get()).data()?.claimedByUserId,undefined);
    assert.equal((await claim(3,candidates[2].id)).status,200,'Successful retry after unavailable persistence');
    await db.collection('users').doc(actors[4].id).update({isSuspended:true});
    const suspended=await claim(4,candidates[3].id);
    assert.equal(suspended.status,409);assert.equal(suspended.body.code,'CLAIM_AUTHORIZATION_REVOKED','Suspension is rechecked in the claim transaction even with an older signed token');
    const ownerId='user-5209126900',savedOwner=(await db.collection('users').doc(ownerId).get()).data();
    await db.collection('users').doc(ownerId).set({id:ownerId,telegramId:'5209126900',isAdmin:true,isSuspended:false});
    try{
      await db.collection('users').doc(actors[4].id).update({isSuspended:false});
      const body={isBanned:true,reason:'O‘yinlarni o‘ynamadi',requestId:'native-club-ban-0001'};
      failNextBanCommit();await assert.rejects(setClubSelectionBan(ownerId,actors[4].id,body));assert.equal((await db.collection('club_selection_bans').doc(actors[4].id).get()).exists,false,'SQL failure rolls back ban and audit');
      await setClubSelectionBan(ownerId,actors[4].id,body);await setClubSelectionBan(ownerId,actors[4].id,body);
      assert.equal((await db.collection('club_selection_bans').doc(actors[4].id).get()).data().revision,1,'Ban retries apply once');
      const banned=await claim(4,candidates[3].id);assert.equal(banned.status,409);assert.equal(banned.body.code,'CLUB_SELECTION_BANNED','Old signed sessions cannot bypass the authoritative ban');
      await assert.rejects(claimClubAtomicFirestore(actors[4].id,candidates[3].id,season),(e:any)=>e.code==='CLUB_SELECTION_BANNED','Direct/replayed claims are also blocked without options');
      await assert.rejects(adminAssignClubFirestore(ownerId,candidates[3].id,actors[4].id,season),(e:any)=>e.code==='CLUB_SELECTION_BANNED','Administrator assignment cannot bypass the ban');
      assert.equal((await db.collection('club_occupancies').doc(`${season}_${candidates[3].id}`).get()).exists,false);
      await assert.rejects(setClubSelectionBan(actors[0].id,actors[4].id,{...body,requestId:'foreign-club-ban'}),(e:any)=>e.statusCode===403);
      await setClubSelectionBan(ownerId,actors[4].id,{isBanned:false,requestId:'native-club-unban-0001'});
      assert.equal((await claim(4,candidates[3].id)).status,200,'Unban restores selection');
    }finally{if(savedOwner)await db.collection('users').doc(ownerId).set(savedOwner);else await db.collection('users').doc(ownerId).delete();}
    const status=await fetch(`${base}/api/clubs/claim-status`,{headers:{authorization:`Bearer ${createSessionToken(actors[0])}`}});
    assert.equal(status.status,200);assert.deepEqual(await status.json(),{request:null});
    console.log('PASS signed club HTTP + native PostgreSQL: no Redis/snapshot requirement, committed 200 response, four durable records, retries, simultaneous exclusion, club limit, admission, suspension, failed-commit rollback and recovery.');
  } finally {server.close();delete process.env.TELEGRAM_BOT_TOKEN;}
}
