import assert from 'node:assert/strict';
import express from 'express';
import {adminNotificationsRouter} from '../routes/adminNotifications.routes';
import {runDeadlineSweep} from '../services/matchOperationsV4Service';
import {getFirestoreDb} from '../firebase/admin';
import {CURRENT_SEASON_ID as season} from '../../lib/seasonParticipationPolicy';
import {loadLeagueBacklog,leagueBacklogMessage,processLeagueBacklogReminders,freshLeagueReminder,reminderDay,BACKLOG_STATE_COLLECTION} from '../services/leagueBacklogReminders';
import {enqueueSmartTelegramNotification} from '../services/smartNotificationService';
import {getNotificationStore} from '../services/postgresNotificationStore';
import {KEY_PREFIX} from '../readModel/readModelStore';
import {processNotificationQueue} from '../services/telegramNotificationQueue';

export async function verifyLeagueBacklogReminders(){
  const db=getFirestoreDb();
  const previous={provider:process.env.DATABASE_PROVIDER,namespace:process.env.SUPABASE_DATA_NAMESPACE,token:process.env.TELEGRAM_BOT_TOKEN};
  const competitionId='backlog-audit-league',home='backlog-home',away='backlog-away';
  // Use today's noon in Tashkent; the production worker's clock is not changed.
  const now=Date.parse(reminderDay()+'T07:00:00Z');
  try{
    process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
    assert.equal(await processLeagueBacklogReminders({now}),false,'Preview never creates jobs');
    process.env.SUPABASE_DATA_NAMESPACE='production';
    await db.collection('competitions').doc(competitionId).set({seasonId:season,type:'LEAGUE',currentMatchday:19,name:'La Liga audit',status:'active'});
    for(const [id,username] of [[home,'audit_home'],[away,'audit_away']])await db.collection('users').doc(id).set({telegramId:id===home?'700001':'700002',username,firstName:'<script>&',isSuspended:false});
    for(const [clubId,userId] of [['backlog-club-home',home],['backlog-club-away',away]])await db.collection('club_occupancies').doc(`${season}_${clubId}`).set({seasonId:season,clubId,userId,status:'active'});
    for(let i=1;i<=7;i++)await db.collection('fixtures').doc('backlog-game-'+i).set({seasonId:season,competitionId,matchday:i,homeClubId:'backlog-club-home',awayClubId:'backlog-club-away',status:i===7?'PENDING_CONFIRMATION':'SCHEDULED',homeOwnerId:'historical-wrong-owner'});
    for(const [id,status,matchday] of [['confirmed','CONFIRMED',8],['postponed','POSTPONED',9],['disputed','DISPUTED',10],['cancelled','CANCELLED',11],['future','SCHEDULED',20]] as const)await db.collection('fixtures').doc('backlog-'+id).set({seasonId:season,competitionId,matchday,homeClubId:'backlog-club-home',awayClubId:'backlog-club-away',status});
    let data=(await loadLeagueBacklog(competitionId,season))!;
    assert.equal(data.fixtures.length,7,'Current round 19 retains seven old unfinished matches, excluding terminal, postponed, disputed and future fixtures');
    const message=leagueBacklogMessage(data,home)!;
    assert.match(message.body,/<b>7<\/b>/);assert.match(message.body,/1-tur/);assert.match(message.body,/7-tur/);assert.match(message.body,/tasdiqlanishi kutilmoqda/);
    assert.equal(message.replyMarkup.inline_keyboard.filter(r=>r[0].url==='https://t.me/audit_away').length,1,'One usable opponent contact, not seven duplicate buttons');
    assert.ok(message.body.length<3900);assert.equal(leagueBacklogMessage(data,'historical-wrong-owner'),null);
    assert.equal(await processLeagueBacklogReminders({now:Date.parse(reminderDay()+'T22:00:00Z')}),false,'Nighttime does not enqueue');
    const state=db.collection(BACKLOG_STATE_COLLECTION).doc(season);await state.delete();
    // Isolate this synthetic league from other native-suite fixtures without touching their scores.
    let failOnce=true,events=0;
    const enqueue:typeof enqueueSmartTelegramNotification=async params=>{
      if(params.userId===home&&failOnce){failOnce=false;throw Error('SYNTHETIC_ENQUEUE_OUTAGE');}
      events++;return enqueueSmartTelegramNotification(params);
    };
    // Other native audits may have leagues; seed the completed list for this run.
    const all=await db.collection('competitions').where('seasonId','==',season).get();
    await state.set({day:reminderDay(now),completed:all.docs.filter(d=>d.id!==competitionId).map(d=>d.id),cursors:{},queued:0,skipped:0,status:'PENDING'});
    await assert.rejects(processLeagueBacklogReminders({now,enqueue}),/SYNTHETIC_ENQUEUE_OUTAGE/);
    assert.equal((await state.get()).data()?.status,'RETRY_PENDING');
    for(let i=0;i<6;i++)if(!await processLeagueBacklogReminders({now,enqueue}))break;
    assert.equal((await state.get()).data()?.status,'DONE');assert.equal(events,2,'Partial failure resumes without re-enqueueing successful player');
    assert.equal(await processLeagueBacklogReminders({now,enqueue}),false);assert.equal(events,2,'Repeated daily worker is a no-op');
    const queue:any[]=await getNotificationStore()!.get(`${KEY_PREFIX}:telegram:queue`)||[];
    const jobs=queue.filter(j=>j.leagueReminder?.competitionId===competitionId);assert.equal(jobs.length,2,'One durable digest per current owner');
    assert.equal(await enqueueSmartTelegramNotification({userId:home,seasonId:season,eventId:`matchday-open:backlog:${competitionId}:${reminderDay(now)}`,...message,deferDrain:true}),false,'Lost checkpoint retry uses stable queue dedupe');
    // A source read outage is known to precede Telegram dispatch and must remain retryable.
    const collection=db.collection.bind(db);
    (db as any).collection=(name:string)=>{if(name==='competitions')throw Error('SYNTHETIC_FRESHNESS_OUTAGE');return collection(name);};
    try { await processNotificationQueue(25); } finally { (db as any).collection=collection; }
    const deferred:any[]=await getNotificationStore()!.get(`${KEY_PREFIX}:telegram:queue`)||[];
    assert.equal(deferred.filter(j=>j.leagueReminder?.competitionId===competitionId && j.requiresRecipientLookup).length,2);
    await getNotificationStore()!.set(`${KEY_PREFIX}:telegram:queue`,deferred.map(j=>j.leagueReminder?.competitionId===competitionId?{...j,availableAt:0}:j));
    // Dispatch must use fresh results/occupancy, never stale queued content.
    for(let i=1;i<=6;i++)await db.collection('fixtures').doc('backlog-game-'+i).update({status:'CONFIRMED'});
    const guard={competitionId,seasonId:season,day:reminderDay()};
    assert.match((await freshLeagueReminder(guard,home))!.body,/<b>1<\/b>/);
    await db.collection('club_occupancies').doc(`${season}_backlog-club-home`).update({userId:'new-backlog-owner'});
    assert.equal(await freshLeagueReminder(guard,home),null,'Transferred club cannot send old-owner digest');
    await db.collection('users').doc(away).update({username:'',firstName:'<script>&'});
    data=(await loadLeagueBacklog(competitionId,season))!;
    const fallback=leagueBacklogMessage(data,away)!;assert.ok(fallback.replyMarkup.inline_keyboard.some(r=>r[0].url==='https://t.me/efleagueuz'),'Missing username retains group/admin fallback');
    assert.equal(await freshLeagueReminder({...guard,day:'2000-01-01'},away),null,'Previous-day queued digests expire');
    await db.collection('fixtures').doc('backlog-game-7').update({status:'CONFIRMED'});
    assert.equal(await freshLeagueReminder(guard,away),null,'Finished games suppress waiting digest');
    // Real queue drain, with no network delivery possible: both queued digests are now obsolete.
    // Native integration has a mocked Telegram transport for unrelated prior jobs.
    await processNotificationQueue(25);
    const receipts:any=await getNotificationStore()!.hgetall(`${KEY_PREFIX}:telegram:broadcasts`);
    for(const j of jobs)assert.equal(receipts[j.broadcastId].recipients[0].error,'REMINDER_OBSOLETE');
    await db.collection('fixtures').doc('backlog-game-7').update({status:'SCHEDULED'});
    const latest=(await freshLeagueReminder(guard,away))!;
    await enqueueSmartTelegramNotification({userId:away,seasonId:season,eventId:`matchday-open:backlog:${competitionId}:dispatch-audit:${guard.day}`,...latest,deferDrain:true,leagueReminder:guard});
    const originalFetch=globalThis.fetch;const delivered:any[]=[];
    process.env.TELEGRAM_BOT_TOKEN='123456:isolated-token';
    globalThis.fetch=(async(input:any,init:any)=>{if(!String(input).startsWith('https://api.telegram.org/'))return originalFetch(input,init);delivered.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true,result:{message_id:1}}));}) as typeof fetch;
    try{await processNotificationQueue(25);}finally{globalThis.fetch=originalFetch;}
    assert.equal(delivered.length,1);assert.match(delivered[0].text,/<b>1<\/b>/);assert.ok(!delivered[0].text.includes('backlog-game-1'));
    await db.collection('users').doc('backlog-health-admin').set({isAdmin:true,isSuspended:false,telegramId:'700009'});
    const app=express();app.use((req,_res,next)=>{if(req.headers['x-test-user'])req.user={id:String(req.headers['x-test-user'])} as any;next();});app.use('/admin',adminNotificationsRouter);
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
    const url=`http://127.0.0.1:${(server.address() as any).port}/admin/league-reminder-health`;
    try{
      assert.equal((await fetch(url)).status,401);
      assert.equal((await fetch(url,{headers:{'x-test-user':home}})).status,403);
      const response=await fetch(url,{headers:{'x-test-user':'backlog-health-admin'}});assert.equal(response.status,200);
      const health=await response.json();assert.equal(health.delivery.sent,1);assert.equal(health.delivery.skipped,2);assert.equal(health.delivery.pending,0);
      assert.ok(!JSON.stringify(health).includes('700002'));assert.equal(health.cursors,undefined,'Health endpoint never exposes private recipients');
    }finally{server.close();}
    const deadlineSeason='backlog-deadline-audit';
    await db.collection('match_deadlines').doc('partial-deadline').set({fixtureId:'partial-deadline',seasonId:deadlineSeason,deadlineAt:new Date(Date.now()-1000).toISOString()});
    await runDeadlineSweep(deadlineSeason,true,async()=>({attempted:true,queued:1,failed:1}));
    assert.equal((await db.collection('match_deadlines').doc('partial-deadline').get()).data()?.overdueSentAt,undefined,'Partial enqueue failure must not acknowledge both owners');
    await runDeadlineSweep(deadlineSeason,true,async()=>({attempted:true,queued:1,failed:0}));
    assert.ok((await db.collection('match_deadlines').doc('partial-deadline').get()).data()?.overdueSentAt,'Recovered recipient finishes deadline reminder');
    console.log('PASS league backlog: 19th round/seven old games, pending scores, contact fallback, ownership, preview/night guards, durable partial recovery, daily dedupe and fresh dispatch suppression; no result or Telegram production access');
  }finally{
    for(const [name,value] of Object.entries({DATABASE_PROVIDER:previous.provider,SUPABASE_DATA_NAMESPACE:previous.namespace,TELEGRAM_BOT_TOKEN:previous.token}))if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
}
if(process.argv[1]?.endsWith('leagueBacklogReminderRegressionTest.ts'))await verifyLeagueBacklogReminders();
