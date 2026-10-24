import assert from 'node:assert/strict';
import { planNaturalAdminRequest } from '../services/telegramAiNaturalAdminPlanner';
import { getConversationIntent } from '../services/telegramAiConversationCommands';
import { bindMatchdaySnapshot, matchdayDuration } from '../services/telegramAiMatchdayLanguage';
import { inspectAiAdminOutcome } from '../services/telegramAiAdminOutcome';
import { parseAiPlanRevision, reviseAiAdminPlan } from '../services/telegramAiPlanRevision';
import { notifyOutstandingMatchdayOwners, type MatchdayReminderDependencies } from '../services/matchdayReminderService';
import { getFirestoreDb } from '../firebase/admin';
import { advanceCompetitionMatchdayFirestore } from '../firebase/firestoreStore';
import type { AdminPlan } from '../services/telegramAiAdminCatalog';

const comp = {id:'comp-premier-league-2026',name:'Premier League',type:'LEAGUE',leagueId:'league-premier-league',seasonId:'season-2026-27',currentMatchday:10,updatedAt:'2026-10-20T00:00:00Z'};
const comps = [comp,{...comp,id:'comp-la-liga-2026',name:'La Liga',leagueId:'league-la-liga'}];
const deps:any = {read:async(q:any)=>({data:q.dataset==='competitions'?comps:[],complete:true,total:q.dataset==='competitions'?comps.length:0}),users:async()=>[{id:'user-12345',username:'actual_owner'}]};
const cases:Array<[string,string,any]> = [
 ['APL 11-turni 2 kunga ochgin','matchday_control',{action:'OPEN',matchday:11,durationHours:48}],
 ['APL joriy turni yopib qoy','matchday_control',{action:'LOCK',matchday:10}],
 ['APL 10-turni 6 soatga chozgin','matchday_control',{action:'EXTEND',matchday:10,durationHours:6}],
 ['APL keyingi turni ochgin','matchday_advance',{}],
 ['APL 10-tur oyini tugamaganlarga eslat','matchday_remind',{matchday:10}],
 ['APL keyingi turga 1 kunga otkaz','matchday_advance',{durationHours:24}],
 ['APL 10-turni 30 soatga qayta boshla','matchday_control',{action:'RESTART',matchday:10,durationHours:30}],
 ['APL 10-turda hisob kiritmaganlarga eslatma yubor','matchday_remind',{matchday:10}],
 ['APL joriy turda oynamaganlarga bildirishnoma jonat','matchday_remind',{matchday:10}],
 ['APL hozir nechanchi tur?','matchday_status',{}],
 ['APL 10-tur ochiqmi?','matchday_status',{}],
];
for (const [text,action,body] of cases) {
 assert.equal(getConversationIntent(text),'admin',text);
 const plan=await planNaturalAdminRequest(text,deps);
 assert.equal(plan?.action,action,text);assert.equal(plan?.targetId,comp.id,text);assert.deepEqual(plan?.body,body,text);
}
for (const text of ['APL 11-turni 0 soatga ochgin','APL 11-turni -2 soatga ochgin','APL 11-turni −2 soatga ochgin','APL 11-turni - 2 soatga ochgin','APL 11-turni yigirma soatga ochgin','APL 11-turni ochgin yoki yop','APL 11-turni 31 kunga ochgin','APL 11-turni yarim kunga ochgin','APL 11-turni 1 kun 30 soatga ochgin','APL 20-turni ochgin','APL 10-tur eslatma yuborma','APL joriy turni yopib qoyma','APL 10-turni 6 soatga chozma','APL 10-turni berkitma','APL 10-turni qayta boshlama','APL 10-turga eslatmang','APL va La Liga 10-turni ochgin','APL 11-tur keyingi turga otkaz'])
 await assert.rejects(planNaturalAdminRequest(text,deps),/CLARIFY/,text);
assert.equal(await planNaturalAdminRequest('APL 11-turni ochma',deps),null);
assert.equal(matchdayDuration('APL 11-turni 2 kunga och'),48);
await assert.rejects(planNaturalAdminRequest('APL 11-turni ochgin',{...deps,read:async()=>({data:[comp],complete:false})}),/CLARIFY/);
assert.notEqual(getConversationIntent('Agar APL 11-turni ochsam nima boladi?'),'admin');
const next=bindMatchdaySnapshot({action:'matchday_advance',targetId:comp.id,body:{durationHours:24}},comp);
assert.deepEqual(next.body,{durationHours:24,expectedCurrentMatchday:10,expectedUpdatedAt:comp.updatedAt,seasonId:comp.seasonId});
assert.deepEqual(parseAiPlanRevision('yoq 2 kun bolsin'),{kind:'hours',value:48});
assert.equal(reviseAiAdminPlan(next,{kind:'hours',value:48}).body.durationHours,48);

const scoped=await planNaturalAdminRequest('APL hammaga “La Liga 11-turni oching” deb bildirishnoma yubor',deps);
assert.equal(scoped?.body.targetAudience,'LEAGUE_OWNERS');assert.equal(scoped?.body.targetLeagueId,comp.leagueId);
assert.equal(scoped?.body.body,'La Liga 11-turni oching');
const one=await planNaturalAdminRequest('@actual_owner ga “APL 11-tur ochildi” deb xabar yubor',deps);
assert.deepEqual(one?.body.selectedUserIds,['user-12345']);
for (const text of ['APL va La Liga hammaga “Salom” deb xabar yubor','APL @actual_owner ga “Salom” deb xabar yubor','@actual_owner hammaga “Salom” deb xabar yubor','“@actual_owner Salom” deb xabar yubor'])
 await assert.rejects(planNaturalAdminRequest(text,deps),/CLARIFY/,text);

const base:any={id:'game-a',competitionId:comp.id,seasonId:comp.seasonId,matchday:10,status:'SCHEDULED',homeClubId:'club-a',awayClubId:'club-b',homeOwnerId:'old-owner',awayOwnerId:'user-away'};
const sent:any[]=[];
const reminders:MatchdayReminderDependencies={fixtures:async()=>[base,{...base,id:'game-done',status:'CONFIRMED'},{...base,id:'postponed',status:'POSTPONED'}],owners:async rows=>rows.map(f=>({...f,homeOwnerId:'new-owner'})),submissions:async()=>[{submittedByUserId:'user-away'}],enqueue:async message=>{sent.push(message);return true;}};
const params={competitionId:comp.id,seasonId:comp.seasonId,matchday:10};
const receipt=await notifyOutstandingMatchdayOwners(params,reminders);
assert.deepEqual(sent.map(m=>m.userId),['new-owner']);assert.equal(receipt.queued,1);assert.equal(receipt.outstandingPlayers,1);
sent.length=0;
await assert.rejects(notifyOutstandingMatchdayOwners(params,{...reminders,fixtures:async()=>[base,{...base,id:'game-b'}],submissions:async id=>{if(id==='game-b')throw Error('READ_FAILED');return [];}}),/READ_FAILED/);
assert.equal(sent.length,0,'All source reads must finish before any enqueue');
await assert.rejects(notifyOutstandingMatchdayOwners(params,{...reminders,owners:async()=>{throw Error('OWNERS_FAILED');}}),/OWNERS_FAILED/);assert.equal(sent.length,0);
const failed=await notifyOutstandingMatchdayOwners(params,{...reminders,submissions:async()=>[],enqueue:async message=>{if(message.userId==='new-owner')throw Error('QUEUE_DOWN');return false;}});
assert.equal(failed.failed,1);assert.equal(failed.skipped,1);assert.equal(failed.queued,0);
const reminderPlan:AdminPlan={action:'matchday_remind',targetId:comp.id,body:{matchday:10}};
assert.equal(inspectAiAdminOutcome(reminderPlan,{success:true,...receipt}).state,'queued');
assert.equal(inspectAiAdminOutcome(reminderPlan,{success:true,...receipt,matchday:11}).state,'unverified');
assert.match(inspectAiAdminOutcome({action:'broadcast',body:{}},{success:true,broadcast:{id:'test',metrics:{totalRecipients:2}}}).message,/navbatga/);
assert.equal(inspectAiAdminOutcome(next,{success:true,competitionId:comp.id,matchday:12,isMatchdayOpen:true}).state,'unverified');
assert.equal(inspectAiAdminOutcome(next,{success:true,competitionId:comp.id,matchday:11,isMatchdayOpen:true}).state,'verified');
assert.equal(inspectAiAdminOutcome(next,{success:true}).state,'unverified');

// Real production owner resolver and submission queries, entirely local Firestore.
const db=getFirestoreDb();
await db.collection('fixtures').doc(base.id).set(base);
await db.collection('club_occupancies').doc(`${comp.seasonId}_club-a`).set({status:'active',userId:'new-owner'});
await db.collection('club_occupancies').doc(`${comp.seasonId}_club-b`).set({status:'released',userId:'stale-away'});
await db.collection('users').doc('new-owner').set({username:'new_owner'});
// Obtain production source functions by invoking the default service with a local snapshot.
const {redisSetRaw,ReadModelKeys}=await import('../readModel/readModelStore');
process.env.DATABASE_PROVIDER='supabase';
await redisSetRaw(ReadModelKeys.competitionFixtures(comp.id,comp.seasonId),{data:[base]});
// No Telegram token configured: default queue skips, so there can be no real messages.
const resolved=await notifyOutstandingMatchdayOwners(params);
assert.equal(resolved.outstandingPlayers,1,'Released/stale owners are removed');
await db.collection('result_submissions').doc('submitted').set({fixtureId:base.id,submittedByUserId:'new-owner'});
assert.equal((await notifyOutstandingMatchdayOwners(params)).outstandingPlayers,0);
await db.collection('fixtures').doc(base.id).update({status:'CONFIRMED'});
assert.equal((await notifyOutstandingMatchdayOwners(params)).unfinishedFixtures,0);
await db.collection('competitions').doc(comp.id).set(comp);
await assert.rejects(advanceCompetitionMatchdayFirestore(comp.id,{expectedCurrentMatchday:9}),/o‘zgardi/);
await assert.rejects(advanceCompetitionMatchdayFirestore(comp.id,{expectedCurrentMatchday:10,expectedUpdatedAt:'old-version'}),/o‘zgardi/);
assert.equal((await db.collection('competitions').doc(comp.id).get()).data()?.currentMatchday,10);
console.log('PASS natural matchday variants, days, status, negation, audience narrowing, exact quoted message, current ownership, submission exclusion, fail-closed reads, queue failures, truthful receipts and stale next-round guards; no external network/messages');
