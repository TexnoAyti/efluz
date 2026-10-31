import {sweepCustomCompetitionDeadlines,writeCustomLifecycleNotices} from '../services/customCompetitionNotices';
import {writeTeamLeagueNotices} from '../services/teamCompetitionNotices';
import assert from 'node:assert/strict';
import {getFirestoreDb} from '../firebase/admin';
import {COMPETITION_OUTBOX,noticeHash,noticeGuard,writeCompetitionNotices,processCompetitionNotices,type CompetitionNotice} from '../services/competitionNotices';
import {getLiveUserNotifications} from '../services/liveNotifications';
export async function verifyCompetitionNotices(failNextCommit:()=>void){
 const db=getFirestoreDb(),actor={id:'user-notice-audit',telegramId:'882001',firstName:'Notice audit',username:'noticeaudit',isSuspended:false};await db.collection('users').doc(actor.id).set(actor);
 const source=db.collection('el_clasico_events').doc('notification-audit');await source.set({status:'ACTIVE',score:1});
 const base:CompetitionNotice={userId:actor.id,title:'Event testi',body:'Real <Madrid> & Barcelona',url:'https://t.me/efluzbot?startapp=el_clasico',entityType:'team-event',entityId:'el-clasico',guard:noticeGuard('el_clasico_events','notification-audit',['score'],{score:1})};
 const put=async(key:string,notices:CompetitionNotice[]= [base])=>{await db.runTransaction(async tx=>writeCompetitionNotices(tx,key,notices));return noticeHash([key,0]);};
 const process=async(id:string,send:(p:any)=>Promise<boolean>,limit=40)=>processCompetitionNotices(limit,send,Date.now()+10000,id);
 const sent:any[]=[];const send=async(p:any)=>{sent.push(p);return true;};
 const count=async()=> (await db.collection('notifications').where('userId','==',actor.id).get()).size;
 try{
  const id=await put('audit-once');await process(id,send);await process(id,send);assert.equal(sent.length,1);assert.equal(await count(),1);assert.ok(sent[0].body.includes('&lt;Madrid&gt; &amp;'));assert.equal(sent[0].deferDrain,true);assert.equal(sent[0].replyMarkup.inline_keyboard[0][0].url,base.url);
  const retry=await put('audit-failure');await assert.rejects(process(retry,async()=>{throw Error('isolated enqueue outage');}));const row=(await db.collection('notifications').where('userId','==',actor.id).get()).docs.find(d=>d.id!==('competition-'+noticeHash([id,0,actor.id])))!;await row.ref.update({isRead:true});await process(retry,send);assert.equal((await row.ref.get()).data()?.isRead,true,'Retry preserves read status');assert.equal(await count(),2);
  const race=await put('audit-parallel');let enqueues=0;await Promise.all([process(race,async()=>{enqueues++;return true;}),process(race,async()=>{enqueues++;return true;})]);assert.equal(enqueues,1,'Only the current lease may deliver');
  const stale=await put('audit-stale');await source.update({score:2});const before=await count();await process(stale,send);assert.equal(await count(),before,'Obsolete scores cannot create visible notifications');await source.update({score:1});
  const suspended=await put('audit-suspended');await db.collection('users').doc(actor.id).update({isSuspended:true});await process(suspended,send);assert.equal(await count(),before);await db.collection('users').doc(actor.id).update({isSuspended:false});
  const cursor=await put('audit-cursor',[base,{...base,title:'Second'}]);await process(cursor,send,1);assert.equal((await db.collection(COMPETITION_OUTBOX).doc(cursor).get()).data()?.cursor,1);await process(cursor,send,1);assert.equal((await db.collection(COMPETITION_OUTBOX).doc(cursor).get()).data()?.status,'done');
  const rollback=noticeHash(['audit-rollback',0]);failNextCommit();await assert.rejects(db.runTransaction(async tx=>{tx.set(source,{status:'ACTIVE',score:99});writeCompetitionNotices(tx,'audit-rollback',[base]);}));assert.equal((await source.get()).data()?.score,1);assert.equal((await db.collection(COMPETITION_OUTBOX).doc(rollback).get()).exists,false,'A failed domain commit creates no notification intent');
  const live=await getLiveUserNotifications(actor.id);assert.equal(live.length,5);assert.ok(live.some(n=>n.isRead));assert.ok(live.every(n=>n.entityType==='team-event'&&n.userId===actor.id));
  const other={...actor,id:'user-notice-opponent',telegramId:'882002'};await db.collection('users').doc(other.id).set(other);
  const league:any={id:'tp_notices_audit',name:'Team notices',ownerId:actor.id,teamIds:['tp_team_audit_a','tp_team_audit_b'],teams:{tp_team_audit_a:{id:'tp_team_audit_a',name:'Team A',members:[{id:'memberA',userId:actor.id,verified:true,name:'Player A'}]},tp_team_audit_b:{id:'tp_team_audit_b',name:'Team B',members:[{id:'memberB',userId:other.id,verified:true,name:'Player B'}]}},status:'ACTIVE',currentRound:1,totalRounds:1,version:1,fixtures:[{id:'notice_fixture',round:1,homeTeamId:'tp_team_audit_a',awayTeamId:'tp_team_audit_b',bouts:[{id:'bout',homeMemberId:'memberA',awayMemberId:'memberB',homeScore:null,awayScore:null}]}]};
  let teamNotices:any[]=[];await db.runTransaction(async tx=>{teamNotices=writeTeamLeagueNotices(tx,{...league,status:'DRAFT',fixtures:[]},league,'START');tx.set(db.collection('team_league_preview_leagues').doc(league.id),league);});assert.equal(teamNotices.filter(n=>n.title.includes('Raqibingiz')).length,2);assert.ok(teamNotices.some(n=>n.userId===actor.id&&n.body.includes('Player B')));
  const pairing=teamNotices.filter(n=>n.title.includes('Raqibingiz'));
  league.fixtures[0].bouts[0].pendingResult={homeScore:1,awayScore:0,submittedBy:actor.id};
  await db.collection('team_league_preview_leagues').doc(league.id).set(league);
  let delivered=0;const sendPair=async()=>{delivered++;return true;};
  const pairId=await put('team-pair-after-proposal',pairing);await process(pairId,sendPair);assert.equal(delivered,2,'Score proposals cannot invalidate the opponent announcement');
  league.fixtures[0].bouts[0].homeMemberId='replacement';await db.collection('team_league_preview_leagues').doc(league.id).set(league);
  await process(await put('team-old-pair',pairing),sendPair);assert.equal(delivered,2,'Replacing a player still invalidates the old opponent notice');
  league.fixtures[0].bouts[0].homeMemberId='memberA';league.status='CANCELLED';await db.collection('team_league_preview_leagues').doc(league.id).set(league);
  await process(await put('team-cancelled-pair',pairing),sendPair);assert.equal(delivered,2,'Cancelled tournaments never announce opponents');
  const ct:any={id:'ct_notice_audit',name:'Custom audit',organizerUserId:actor.id,assistantAdminIds:['user-notice-helper'],inviteToken:'noticeinvite',status:'IN_PROGRESS',updatedAt:new Date().toISOString()};const fixture:any={id:'cf_notice_audit',tournamentId:ct.id,homeUserId:actor.id,awayUserId:other.id,homeClubId:'club-a',awayClubId:'club-b',homeClubName:'Club A',awayClubName:'Club B',status:'SCHEDULED',roundOrMatchday:1,deadlineAt:new Date(Date.now()+3600000).toISOString()};
  let custom:any[]=[];await db.runTransaction(async tx=>{custom=writeCustomLifecycleNotices(tx,{...ct,status:'REGISTRATION_OPEN'},ct,[],[fixture],[{userId:actor.id,status:'REGISTERED'},{userId:other.id,status:'REGISTERED'}] as any);tx.set(db.collection('custom_tournaments').doc(ct.id),ct);tx.set(db.collection('custom_tournament_fixtures').doc(fixture.id),fixture);});assert.equal(custom.filter(n=>n.title.includes('Raqibingiz')).length,2);assert.ok(custom.every(n=>n.url.startsWith('https://t.me/efluzbot?startapp=ct1_')));assert.ok(custom.some(n=>n.userId==='user-notice-helper'&&n.guards?.some((g:any)=>g.paths.includes('assistantAdminIds'))),'Private administrator messages recheck the current assignment');
  const customPair=custom.filter(n=>n.title.includes('Raqibingiz'));
  await db.collection('custom_tournament_fixtures').doc(fixture.id).update({status:'PENDING_CONFIRMATION',homeScore:2,awayScore:1});
  await process(await put('custom-pair-after-score',customPair),sendPair);assert.equal(delivered,4,'Custom opponents survive a pending result');
  await db.collection('custom_tournament_fixtures').doc(fixture.id).set(fixture);
  await db.collection('competition_notification_worker').doc('deadlines').set({nextAt:0});const now=Date.now();await sweepCustomCompetitionDeadlines(now);const reminderKey='custom-deadline:'+fixture.id+':'+fixture.deadlineAt+':reminder',reminderRef=db.collection(COMPETITION_OUTBOX).doc(noticeHash([reminderKey,0]));const reminder=(await reminderRef.get()).data();assert.equal(reminder?.notices.length,2);await process(reminderRef.id,send);await sweepCustomCompetitionDeadlines(now+6000);assert.equal((await reminderRef.get()).data()?.status,'done','Repeated sweeps do not recreate delivered reminders');
  await sweepCustomCompetitionDeadlines(now+7200000);assert.ok((await db.collection(COMPETITION_OUTBOX).doc(noticeHash(['custom-deadline:'+fixture.id+':'+fixture.deadlineAt+':overdue',0])).get()).exists,'A separate overdue alert is durable');
  await db.collection('users').doc(other.id).delete();await db.collection('custom_tournaments').doc(ct.id).delete();await db.collection('custom_tournament_fixtures').doc(fixture.id).delete();
  // The bot queue must remain available when the live in-app projection fails.
  const projection=await put('audit-projection-failure');const collectionBefore=db.collection;
  (db as any).collection=function(name:string){const ref=collectionBefore.call(db,name);return name==='notifications'?new Proxy(ref,{get(target,key){if(key==='where')return ()=>{throw Error('isolated projection outage');};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}}):ref;};
  let queuedBeforeProjection=false;
  try{await assert.rejects(process(projection,async()=>{queuedBeforeProjection=true;return true;}),AggregateError);}finally{(db as any).collection=collectionBefore;}
  assert.equal(queuedBeforeProjection,true,'Telegram was queued before the projection failed');assert.equal((await db.collection(COMPETITION_OUTBOX).doc(projection).get()).data()?.cursor,0,'Failed projection remains resumable');
  await process(projection,send);
  const bad=await put('audit-isolated-bad',[{...base,title:'Fail isolated job'}]),good=await put('audit-isolated-good',[{...base,title:'Deliver other job'}]);
  for(const id of [bad,good])await db.collection(COMPETITION_OUTBOX).doc(id).update({createdAt:'1900-01-01T00:00:00.000Z'});
  const attempted:string[]=[];
  await assert.rejects(processCompetitionNotices(40,async p=>{attempted.push(p.title);if(p.title==='Fail isolated job')throw Error('isolated delivery outage');return true;},Date.now()+15000),AggregateError);
  assert.ok(attempted.includes('Deliver other job'),'One failed job cannot starve another tournament');
  assert.equal((await db.collection(COMPETITION_OUTBOX).doc(good).get()).data()?.status,'done');
  await process(bad,send);
  console.log('PASS competition notifications HTTP/native PostgreSQL: durable atomic intents, lease concurrency, escaped Telegram text, stable deep links, delivery retry, read preservation, stale and suspended suppression, bounded cursors and fresh in-app reads');
 }finally{await source.delete();await db.collection('users').doc(actor.id).delete();}
}
