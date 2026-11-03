import assert from 'node:assert/strict';
import {getFirestoreDb} from '../firebase/admin';
import {initDatabase} from '../db';
import {submitFixtureResultFirestore,refreshFixtureMatchdayRules} from '../firebase/firestoreStore';
import {backlogResultAllowed,readBacklogResultAccess} from '../services/backlogResultEntry';
import {loadLeagueBacklog,backlogCompetitionEnabled} from '../services/leagueBacklogReminders';
import {requestBacklogReminders,BACKLOG_REQUESTS} from '../services/backlogReminderRequests';
import {planNaturalAdminRequest} from '../services/telegramAiNaturalAdminPlanner';
import {assertSingleNaturalAdminRequest} from '../services/telegramAiAdminLanguage';
import {inspectAiAdminOutcome} from '../services/telegramAiAdminOutcome';
import express from 'express';
import {fixturesRouter} from '../routes/fixtures.routes';
import {adminNotificationsRouter} from '../routes/adminNotifications.routes';
import {setSeasonLifecycleOverride} from '../services/seasonLifecycleService';

export async function verifyAllCompetitionBacklog(){
  await initDatabase();const db=getFirestoreDb(),seasonId='season-2026-27',competitionId='backlog-entry-audit';
  const comp={id:competitionId,seasonId,type:'LEAGUE',name:'Backlog entry audit',status:'active',currentMatchday:19,resultEntryThroughMatchday:19,isMatchdayOpen:true,adminOverrideStatus:'AUTO',nextMatchdayOpenAt:'2026-01-01T00:00:00Z'};
  await db.collection('competitions').doc(competitionId).set(comp);
  const base={competitionId,seasonId,matchday:1,status:'SCHEDULED',homeClubId:'backlog-entry-home-club',awayClubId:'backlog-entry-away-club',scheduledAt:new Date().toISOString(),createdAt:new Date().toISOString()};
  const users=['backlog-entry-home','backlog-entry-away','backlog-entry-outsider'];
  for(const [i,id] of users.entries()){
    await db.collection('users').doc(id).set({id,isAdmin:false,isSuspended:false});
    await db.collection('user_memberships').doc(`${seasonId}_${id}`).set({userId:id,seasonId,status:'active',clubId:i===0?base.homeClubId:i===1?base.awayClubId:'backlog-entry-outsider-club'});
  }
  for(const round of [1,2,3,20])await db.collection('fixtures').doc('backlog-entry-'+round).set({...base,id:'backlog-entry-'+round,matchday:round});
  assert.ok(backlogResultAllowed(base,comp));
  for(const status of ['CONFIRMED','CANCELLED','DISPUTED','POSTPONED'])assert.equal(backlogResultAllowed({...base,status},comp),false);
  assert.equal(backlogResultAllowed({...base,matchday:20},comp),false);
  assert.equal(backlogResultAllowed(base,{...comp,seasonId:'season-other'}),false);
  assert.equal(backlogResultAllowed(base,{...comp,adminOverrideStatus:'PAUSED'}),false);
  assert.equal(backlogResultAllowed(base,comp,{overrideStatus:'FORCE_LOCKED'}),false);
  assert.equal(backlogResultAllowed(base,comp,{overrideStatus:'FORCE_OPEN',expiresAt:'2026-01-01T00:00:00Z',isOpen:true}),true,'Natural expiry does not remove unfinished games');
  const fixture=(await db.collection('fixtures').doc('backlog-entry-1').get()).data()!;
  assert.ok(await readBacklogResultAccess(fixture));
  const presentation=await refreshFixtureMatchdayRules([{...fixture,id:'backlog-entry-1'} as any],seasonId);
  assert.equal(presentation[0].isPlayable,true,'My Games exposes the same permission as submission');
  assert.equal((await submitFixtureResultFirestore(users[0],'backlog-entry-1',2,1)).status,'PENDING_CONFIRMATION');
  assert.equal((await submitFixtureResultFirestore(users[0],'backlog-entry-2',3,1)).status,'PENDING_CONFIRMATION','A second older game can be entered independently');
  assert.equal((await submitFixtureResultFirestore(users[1],'backlog-entry-1',2,1)).status,'CONFIRMED','Opponent consensus remains required');
  await assert.rejects(submitFixtureResultFirestore(users[0],'backlog-entry-1',9,0));
  await assert.rejects(submitFixtureResultFirestore(users[2],'backlog-entry-3',1,0),/own either|RESULT_NOT_PARTICIPANT/);
  await assert.rejects(submitFixtureResultFirestore(users[0],'backlog-entry-20',1,0),/MATCHDAY_LOCKED/);
  const lock=db.collection('matchday_locks').doc(`${seasonId}:${competitionId}:3`);
  await lock.set({seasonId,competitionId,matchday:3,overrideStatus:'FORCE_LOCKED',isOpen:false,isLocked:true});
  await assert.rejects(submitFixtureResultFirestore(users[0],'backlog-entry-3',1,0),/MATCHDAY_LOCKED/);
  await lock.delete();
  const transaction=db.runTransaction.bind(db);let race=true;
  (db as any).runTransaction=async(callback:any,...args:any[])=>{
    if(race){race=false;await db.collection('competitions').doc(competitionId).update({adminOverrideStatus:'PAUSED'});}
    return (transaction as any)(callback,...args);
  };
  try{await assert.rejects(submitFixtureResultFirestore(users[0],'backlog-entry-3',1,0),/holati o‘zgardi/);}
  finally{(db as any).runTransaction=transaction;await db.collection('competitions').doc(competitionId).update({adminOverrideStatus:'AUTO'});}
  assert.equal((await db.collection('fixtures').doc('backlog-entry-3').get()).data()?.status,'SCHEDULED','Concurrent admin pause cannot be bypassed');
  await db.collection('fixtures').doc('backlog-entry-18').set({...base,matchday:18});
  await db.collection('fixtures').doc('backlog-entry-proof-19').set({...base,matchday:19,status:'CONFIRMED'});
  await db.collection('competitions').doc(competitionId).update({currentMatchday:17,resultEntryThroughMatchday:17});
  const bounded=(await loadLeagueBacklog(competitionId,seasonId))!;
  assert.equal(bounded.reachedMatchday,17);assert.ok(!bounded.fixtures.some(f=>Number(f.matchday)>17),'Explicit owner-confirmed round boundary wins over imported later results');
  await db.collection('competitions').doc(competitionId).set(comp);
  for(const [id,type] of [['backlog-cup-audit','KNOCKOUT'],['backlog-super-audit','SUPER_CUP']] as const){
    await db.collection('competitions').doc(id).set({id,seasonId,type,status:'active',name:id,currentMatchday:1});
    await db.collection('fixtures').doc(id+'-ready').set({...base,competitionId:id,matchday:2});
    await db.collection('fixtures').doc(id+'-future').set({...base,competitionId:id,matchday:3,homeClubId:'TBD'});
    assert.equal((await loadLeagueBacklog(id,seasonId))?.fixtures.length,1,'Ready cup games are included without inventing future participants');
  }
  assert.equal(backlogCompetitionEnabled({...comp,type:'SUPER_CUP',status:'upcoming'}),false);
  const euro='backlog-champions-league-audit';
  await db.collection('competitions').doc(euro).set({...comp,id:euro,type:'EUROPEAN_LEAGUE_PHASE'});
  await db.collection('fixtures').doc(euro+'-game').set({...base,competitionId:euro,europeanDrawId:'published-audit'});
  assert.equal((await loadLeagueBacklog(euro,seasonId))?.fixtures.length,0,'Unpublished European draws never produce reminders');
  await db.collection('competitions').doc(euro).update({europeanQualificationMode:'final',europeanQualificationToken:'audit-final',europeanDrawQualificationToken:'audit-final',europeanDrawId:'published-audit'});
  assert.equal((await loadLeagueBacklog(euro,seasonId))?.fixtures.length,1);
  const catalog=[{id:'comp-la-liga-2026',name:'La Liga',type:'LEAGUE'},{id:'comp-copa-del-rey-2026',name:'Copa del Rey',type:'KNOCKOUT'}];
  const deps={read:async()=>({data:catalog,complete:true,total:catalog.length}),users:async()=>[]};
  for(const [text,category] of [['Barcha chempionatlarga eslatma yubor','ALL'],['Barcha kuboklarga eslatma yubor','CUPS'],['Barcha ligalar va kuboklarga eslatma yubor','ALL'],['Barcha chempionatlar va kuboklarga eslatma yubor','ALL']] as const){
    const plan=await planNaturalAdminRequest(text,deps);assert.equal(plan?.action,'backlog_remind');assert.equal(plan?.body.category,category);
  }
  const named=await planNaturalAdminRequest('La Liga qolgan o‘yinlariga eslatma yubor',deps);
  assert.equal(named?.body.competitionId,'comp-la-liga-2026');
  assert.throws(()=>assertSingleNaturalAdminRequest('Barcha kuboklarga eslatma yuborma'),/CLARIFY/);
  const receipt=await requestBacklogReminders({category:'CUPS'},'backlog-audit-admin');
  assert.equal((await requestBacklogReminders({category:'CUPS'},'backlog-audit-admin')).requestId,receipt.requestId,'Retries reuse the same durable daily request');
  assert.equal((await db.collection(BACKLOG_REQUESTS).doc(receipt.requestId).get()).data()?.status,'PENDING');
  assert.equal(inspectAiAdminOutcome({action:'backlog_remind',body:{category:'CUPS'}} as any,receipt).state,'queued','AI cannot claim Telegram delivery from an enqueue receipt');
  await db.collection('users').doc('backlog-entry-admin').set({id:'backlog-entry-admin',isAdmin:true,isSuspended:false});
  const app=express();app.use(express.json());app.use((req,_res,next)=>{const id=req.get('x-test-user');if(id)req.user={id} as any;next();});
  app.use('/api/fixtures',fixturesRouter);app.use('/api/admin/notifications',adminNotificationsRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url=`http://127.0.0.1:${(server.address() as any).port}`;
  try{
    const compRef=db.collection('competitions').doc('comp-la-liga-2026'),oldComp=(await compRef.get()).data();
    const lifecycleRef=db.collection('season_lifecycle_controls').doc(seasonId),oldLifecycle=(await lifecycleRef.get()).data();
    await compRef.set({...comp,id:'comp-la-liga-2026'});
    await setSeasonLifecycleOverride(seasonId,'DOMESTIC_CUPS','Backlog HTTP audit','backlog-entry-admin');
    await db.collection('fixtures').doc('backlog-entry-http').set({...base,id:'backlog-entry-http',competitionId:'comp-la-liga-2026'});
    try{
      const response=await fetch(url+'/api/fixtures/backlog-entry-http/result',{method:'POST',headers:{'content-type':'application/json','x-test-user':users[0]},body:JSON.stringify({homeScore:2,awayScore:0})});
      const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.fixture.status,'PENDING_CONFIRMATION','Historical result entry also works through the real HTTP/lifecycle route');
    }finally{
      if(oldComp)await compRef.set(oldComp);else await compRef.delete();
      if(oldLifecycle)await lifecycleRef.set(oldLifecycle);else await lifecycleRef.delete();
    }
    const path=url+'/api/admin/notifications/backlog-reminders',payload={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({category:'CUPS'})};
    assert.equal((await fetch(path,payload)).status,401);
    assert.equal((await fetch(path,{...payload,headers:{...payload.headers,'x-test-user':users[0]}})).status,403);
    assert.equal((await fetch(path,{...payload,headers:{...payload.headers,'x-test-user':'backlog-entry-admin'}})).status,202);
    assert.equal((await fetch(path,{...payload,headers:{...payload.headers,'x-test-user':'backlog-entry-admin'},body:JSON.stringify({category:'ALL',userId:users[0]})})).status,400);
  }finally{server.close();}
  console.log('PASS all competition backlog: cup/Super Cup/European publication, multiple older results, ownership/consensus/future/holds/race guards, AI scoped requests and durable daily idempotence');
}
if(process.argv[1]?.endsWith('allCompetitionBacklogAudit.ts'))await verifyAllCompetitionBacklog();
