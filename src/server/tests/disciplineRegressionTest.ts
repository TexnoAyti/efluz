import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { disciplineRouter } from '../routes/discipline.routes';
import { fixturesRouter } from '../routes/fixtures.routes';
import { getDiscipline, issueDisciplineCard, revokeDisciplineCard, assertDisciplineFixtureAllowed } from '../services/disciplineService';
import { submitFixtureResultFirestore, adminEditFixtureResultFirestore } from '../firebase/firestoreStore';

await initDatabase();
const db=getFirestoreDb(),seasonId='season-2026-27',competitionId='comp-discipline';
const admin='user-90001',player='user-90002',opponent='user-90003',scoped='user-90004';
const users=new Map<string,any>();
for(const [id,isAdmin] of [[admin,true],[player,false],[opponent,false],[scoped,true]] as const){
 const user={id,telegramId:id.slice(5),username:id,firstName:id,isAdmin,isSuspended:false,createdAt:'',updatedAt:'',...(id===scoped?{adminPermissions:{scope:'LEAGUES',leagueIds:['league-premier-league']}}:{})};
 users.set(id,user);await db.collection('users').doc(id).set(user);
}
for(const [id,club] of [[player,'club-arsenal'],[opponent,'club-chelsea']]){
 await db.collection('user_memberships').doc(`${seasonId}_${id}`).set({userId:id,seasonId,clubId:club,status:'active'});
 await db.collection('club_occupancies').doc(`${seasonId}_${club}`).set({userId:id,seasonId,clubId:club,status:'active'});
}
await db.collection('competitions').doc(competitionId).set({id:competitionId,seasonId,type:'LEAGUE',name:'Discipline regression',currentMatchday:1,isMatchdayOpen:true,adminOverrideStatus:'AUTO'});
const fixture=(id:string,date:string,status='SCHEDULED')=>({id,seasonId,competitionId,matchday:1,homeClubId:'club-arsenal',awayClubId:'club-chelsea',scheduledAt:date,status,createdAt:date,updatedAt:date});
for(const f of [fixture('discipline-incident','2026-10-01T10:00:00Z','CONFIRMED'),fixture('discipline-next','2026-10-02T10:00:00Z'),fixture('discipline-after','2026-10-03T10:00:00Z')])await db.collection('fixtures').doc(f.id).set(f);
const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=users.get(String(req.headers['x-test-user']));next();});app.use('/api/discipline',disciplineRouter);app.use('/api/fixtures',fixturesRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const call=(path:string,user:string,method='GET',body?:any)=>fetch(base+path,{method,headers:{'content-type':'application/json','x-test-user':user},...(body?{body:JSON.stringify(body)}:{})});
const path=`/api/discipline/users/${player}/cards`;
const yellow={seasonId,color:'YELLOW',reason:'ABUSE',note:'Haqorat uchun ogohlantirish',incidentFixtureId:'discipline-incident',requestId:'11111111-1111-4111-8111-111111111111'};
try{
 assert.equal((await call(`/api/discipline/users/${player}`,'')).status,401);
 assert.equal((await call(path,player,'POST',yellow)).status,403);
 assert.equal((await call(path,scoped,'POST',yellow)).status,403);
 assert.equal((await call(path,admin,'POST',{...yellow,note:''})).status,400);
 const first=await call(path,admin,'POST',yellow);assert.equal(first.status,200,await first.clone().text());
 const yellowCard=(await first.json() as any).card;
 assert.equal((await call(path,admin,'POST',yellow)).status,200,'Safe retry is idempotent');
 assert.equal((await getDiscipline(player,seasonId,true)).length,1);
 assert.equal((await db.collection('notifications').where('userId','==',player).get()).size,1,'A safe retry does not duplicate the in-app warning');
 assert.equal((await getDiscipline(player,seasonId,false))[0].note,'','Free-text details are private');
 assert.equal((await getDiscipline(player,seasonId,true))[0].note,yellow.note);
 await assertDisciplineFixtureAllowed('discipline-next',player);
 const red={...yellow,color:'RED',reason:'NO_SHOW',note:'Vaqtida o‘ynamaslik',requestId:'22222222-2222-4222-8222-222222222222'};
 const issued=await call(path,admin,'POST',red);assert.equal(issued.status,200,await issued.clone().text());const card=(await issued.json() as any).card;
 assert.equal(card.suspensionFixtureId,'discipline-next','Red reserves only the next unplayed fixture');
 const resultPath='/api/fixtures/discipline-next/result';
 for(const user of [player,opponent]){
  const denied=await call(resultPath,user,'POST',{homeScore:3,awayScore:0});assert.equal(denied.status,409,await denied.clone().text());assert.equal((await denied.json() as any).code,'DISCIPLINARY_SUSPENSION');
 }
 assert.equal((await db.collection('result_submissions').where('fixtureId','==','discipline-next').get()).size,0);
 await assertDisciplineFixtureAllowed('discipline-after',player);
 assert.equal((await getDiscipline(player,'season-2027-28',true)).length,0,'Season isolation');
 await revokeDisciplineCard(admin,player,seasonId,card.id,'Admin xatosi tuzatildi');
 await assertDisciplineFixtureAllowed('discipline-next',player);
 assert.equal((await getDiscipline(player,seasonId,true)).find(c=>c.id===card.id)?.status,'REVOKED');
 const redAgain=await issueDisciplineCard(admin,player,seasonId,{...red,color:'RED',reason:'DELAY',requestId:'33333333-3333-4333-8333-333333333333'});
 assert.equal(redAgain.suspensionFixtureId,'discipline-next');
 // A cancelled match does not consume a one-game suspension.
 await db.collection('fixtures').doc('discipline-next').update({status:'CANCELLED'});
 await assert.rejects(assertDisciplineFixtureAllowed('discipline-after',opponent),(e:any)=>e.code==='DISCIPLINARY_SUSPENSION');
 assert.equal((await getDiscipline(player,seasonId,true)).find(c=>c.id===redAgain.id)?.suspensionFixtureId,'discipline-after');
 // Only admin result handling settles the suspended match.
 const settled=await adminEditFixtureResultFirestore(admin,'admin','discipline-after',{homeScore:0,awayScore:3,status:'CONFIRMED',notes:'Bir o‘yinlik chetlatish bo‘yicha admin qarori'});
 assert.equal(settled.fixture.status,'CONFIRMED');
 assert.equal((await getDiscipline(player,seasonId,true)).find(c=>c.id===redAgain.id)?.suspensionStatus,'SERVED');
 // No available schedule: record the red now and bind it to one future game.
 const pending=await issueDisciplineCard(admin,player,seasonId,{...red,color:'RED',reason:'ABUSE',requestId:'44444444-4444-4444-8444-444444444444'});
 assert.equal(pending.suspensionFixtureId,null);
 await db.collection('fixtures').doc('discipline-future').set(fixture('discipline-future','2026-10-04T10:00:00Z'));
 const pendingCheck=await call('/api/discipline/fixtures/discipline-future/check',opponent,'POST');
 assert.equal(pendingCheck.status,200);assert.equal((await pendingCheck.json() as any).blocked,true,'Opening the score form reserves the pending red before any score can be sent');
 assert.equal((await getDiscipline(player,seasonId,true)).find(c=>c.id===pending.id)?.suspensionFixtureId,'discipline-future');
 await revokeDisciplineCard(admin,player,seasonId,pending.id,'Jazo qayta ko‘rib chiqildi');
 // Red issuance between the precheck and consensus transaction must still block.
 const original=db.runTransaction.bind(db);let injected=false;
 (db as any).runTransaction=async(callback:any)=>{if(!injected){injected=true;await db.collection('fixtures').doc('discipline-future').update({disciplinaryHolds:[{cardId:'race-hold',userId:player}]});}return original(callback);};
 try{await assert.rejects(submitFixtureResultFirestore(player,'discipline-future',1,0),(e:any)=>e.code==='DISCIPLINARY_SUSPENSION');}finally{(db as any).runTransaction=original;}
 assert.equal((await db.collection('result_submissions').where('fixtureId','==','discipline-future').get()).size,0);
 // A club transfer must not punish the new owner or let the offender escape.
 await db.collection('fixtures').doc('discipline-future').update({disciplinaryHolds:[]});
 const transferCard=await issueDisciplineCard(admin,player,seasonId,{...red,color:'RED',reason:'ABUSE',requestId:'66666666-6666-4666-8666-666666666666'});
 assert.equal(transferCard.suspensionFixtureId,'discipline-future');
 await db.collection('user_memberships').doc(`${seasonId}_${player}`).update({clubId:'club-liverpool'});
 await db.collection('user_memberships').doc(`${seasonId}_${scoped}`).set({userId:scoped,seasonId,clubId:'club-arsenal',status:'active'});
 await db.collection('club_occupancies').doc(`${seasonId}_club-arsenal`).update({userId:scoped});
 await db.collection('club_occupancies').doc(`${seasonId}_club-liverpool`).set({userId:player,seasonId,clubId:'club-liverpool',status:'active'});
 await db.collection('fixtures').doc('discipline-transferred').set({...fixture('discipline-transferred','2026-10-05T10:00:00Z'),homeClubId:'club-liverpool'});
 await assertDisciplineFixtureAllowed('discipline-future',scoped);
 await assert.rejects(assertDisciplineFixtureAllowed('discipline-transferred',player),(e:any)=>e.code==='DISCIPLINARY_SUSPENSION');
 assert.equal((await getDiscipline(player,seasonId,true)).find(c=>c.id===transferCard.id)?.suspensionFixtureId,'discipline-transferred');
 await assert.rejects(issueDisciplineCard(player,player,seasonId,{...red,incidentFixtureId:null,color:'RED',reason:'ABUSE',requestId:'55555555-5555-4555-8555-555555555555'}),(e:any)=>e.statusCode===403);
 // A stale admin session must not reveal the private explanation after demotion.
 await db.collection('users').doc(admin).update({isAdmin:false});
 const demoted=await call(`/api/discipline/users/${player}?seasonId=${seasonId}`,admin);
 assert.equal(demoted.status,200);assert.ok((await demoted.json() as any).cards.every((card:any)=>!card.note&&!card.createdBy&&!card.revokeReason));
 assert.equal((await call(path,admin,'POST',yellow)).status,403);
 console.log('PASS discipline: authenticated admin-only cards, scoped admin denied, validation/idempotency, private notes, one-game red, both participant result guards, cancellation rebind, admin resolution, served state, future schedules, revocation, seasons and concurrent red guard');
}finally{server.close();}
