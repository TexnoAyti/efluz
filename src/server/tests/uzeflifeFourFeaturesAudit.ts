import assert from 'node:assert/strict';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState,readUState,mutateUState} from '../services/uzeflifeService';
import {planUzeflifeTopicResult,prepareUzeflifeTopicResult,rejectUzeflifeTopicResult} from '../services/uzeflifeTopicResults';
import {processUNotices,sweepUDeadlines} from '../services/uzeflifeNotifications';
import {processURoundSummary,uSummaryStatus,reconcileUSummary,uSummaryFingerprint} from '../services/uzeflifeRoundSummary';
import {createULeagueMatches,uMatchFinished,uLeagueStandings} from '../../lib/uzeflifeLeague';
import {uzeflifeMyMatch,uzeflifeOpponentUsername} from '../../lib/uzeflifeMyMatch';
import {renderTournamentImagePng} from '../services/tournamentImageRenderer';
import type {User} from '../../types';
export async function verifyUzeflifeFourFeatures(){
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),prior=(await ref.get()).data();
 const collections=['uzeflife_notifications','uzeflife_round_summaries','uzeflife_worker'];
 const backups=await Promise.all(collections.map(async name=>({name,rows:(await db.collection(name).get()).docs.map(d=>({id:d.id,data:d.data()}))})));
 for(const c of backups)for(const row of c.rows)await db.collection(c.name).doc(row.id).delete();
 const users=Array.from({length:16},(_,i)=>({id:'four-player-'+i,telegramId:String(910000+i),username:'four_player_'+i,firstName:'Four '+i,isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''} as User));
 const admin={...users[0],id:'four-admin',telegramId:'919000',username:'four_admin'};
 const all=[...users,admin];for(const u of all)await db.collection('users').doc(u.id).set(u);
 const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
 try{
  const s=initialUState();s.format='LEAGUE';s.status='playing';s.round=1;s.assistants[admin.id]=['results','announcements'];
  s.participants=users.map(u=>({id:u.id,name:'@'+u.username,status:'approved'}));s.roster=users.map((u,i)=>({group:1,slot:i+1,userId:u.id,username:u.username,originalUsername:u.username}));
  s.matches=createULeagueMatches(users.map(u=>u.id));for(const m of s.matches.filter(m=>m.round===1))m.deadlineAt=new Date(clock+20*3600000).toISOString();await ref.set(s);
  const actor=(id:string)=>users.find(u=>u.id===id)!;const m=s.matches[0],home=actor(m.home!),away=actor(m.away!);
  assert.equal(uzeflifeMyMatch(s,home.id)?.id,m.id);assert.equal(uzeflifeMyMatch(s,'stranger'),null);assert.equal(uzeflifeOpponentUsername(s,away.id),away.username);assert.equal(uzeflifeOpponentUsername(s,null),null);
  const placeholder={...s,roster:[{group:2,slot:3,userId:null,username:'verified_player',originalUsername:'verified_player'}]};assert.equal(uzeflifeOpponentUsername(placeholder,'uze-slot-2-3'),'verified_player');assert.equal(uzeflifeOpponentUsername({...s,roster:[],participants:[{id:'display',name:'Azamat',status:'approved'}]},'display'),null);
  const plan=await planUzeflifeTopicResult('2-1',Number(home.telegramId));assert.ok(plan);await prepareUzeflifeTopicResult(plan.plan,Number(home.telegramId));
  let state=await readUState(),proposal=state.matches[0].proposal!;assert.equal(proposal.by,home.id);assert.equal(state.matches[0].homeScore,null);
  const old=proposal,oldPlan={...plan.plan,body:{...plan.plan.body,expectedFixture:{...plan.plan.body.expectedFixture as any,fingerprint:(await import('../services/uzeflifeTopicResults')).uzeflifeMatchFingerprint(state,state.matches[0])}}};
  await assert.rejects(rejectUzeflifeTopicResult(oldPlan,Number(home.telegramId)),/ruxsat/);await rejectUzeflifeTopicResult(oldPlan,Number(admin.telegramId));assert.equal((await readUState()).matches[0].proposal,null,'Admin rejection clears the durable proposal');
  const resubmit=await planUzeflifeTopicResult('2-1',Number(home.telegramId));await prepareUzeflifeTopicResult(resubmit!.plan,Number(home.telegramId));state=await readUState();proposal=state.matches[0].proposal!;assert.notEqual(proposal.version,old.version);await assert.rejects(mutateUState(away,'confirmResult',{matchId:m.id,expected:old}),/yangilangan/);
  const delivered:any[]=[];while(await processUNotices(50,async p=>{delivered.push(p);return true;})){}
  assert.equal(delivered.filter(p=>p.userId===away.id&&p.body.includes('2:1')&&p.replyMarkup.inline_keyboard[0][0].url.includes(m.id)).length,1,'A superseded proposal cannot send an extra opponent alert');
  await assert.rejects(mutateUState(home,'confirmResult',{matchId:m.id,expected:proposal}),/raqib/);await assert.rejects(mutateUState(users[3],'confirmResult',{matchId:m.id,expected:proposal}),/raqib/);
  await assert.rejects(mutateUState(away,'confirmResult',{matchId:m.id,expected:{...proposal,home:9}}),/yangilangan/);
  await mutateUState(away,'confirmResult',{matchId:m.id,expected:proposal});assert.equal((await readUState()).matches[0].homeScore,2);await assert.rejects(mutateUState(away,'confirmResult',{matchId:m.id,expected:proposal}),/topilmadi/);
  const mismatch=s.matches[1],mh=actor(mismatch.home!),ma=actor(mismatch.away!);
  await mutateUState(mh,'result',{matchId:mismatch.id,home:2,away:0});await mutateUState(ma,'result',{matchId:mismatch.id,home:3,away:0});state=await readUState();const disputed=state.matches.find(x=>x.id===mismatch.id)!;
  assert.equal(disputed.dispute?.status,'open');assert.match(disputed.dispute!.reason,/2:0.*3:0/);assert.equal(disputed.homeScore,null);
  await assert.rejects(mutateUState(admin,'approveResult',{matchId:mismatch.id,expected:disputed.proposal}),/e’tiroz/);
  const sentBefore=delivered.length;while(await processUNotices(50,async p=>{delivered.push(p);return true;})){}assert.ok(delivered.slice(sentBefore).some(p=>p.userId===admin.id&&p.body.includes('mos kelmadi')));
  const pending=s.matches[2];await mutateUState(actor(pending.home!),'result',{matchId:pending.id,home:1,away:0});
  const countJobs=async()=>{const jobs=(await db.collection('uzeflife_notifications').get()).docs;return jobs.flatMap(d=>d.data().notices||[]).filter(n=>n.kind==='reminder'||n.kind==='overdue');};
  await sweepUDeadlines(clock);const initial=await countJobs();assert.equal(initial.length,10);assert.ok(initial.every(n=>n.reminderStage==='24h'&&![m.id,mismatch.id,pending.id].includes(n.matchId)));
  await sweepUDeadlines(clock+15*60000);assert.equal((await countJobs()).length,initial.length);
  clock+=17.5*3600000;await sweepUDeadlines(clock);assert.equal((await countJobs()).filter(n=>n.reminderStage==='3h').length,10);
  clock+=2*3600000;await sweepUDeadlines(clock);assert.equal((await countJobs()).filter(n=>n.reminderStage==='1h').length,10);assert.equal((await countJobs()).length,30,'Each reminder stage retains its own durable job');
  // Opening the next league round must retain reminders for postponed games.
  const postponed=await readUState();postponed.round=2;await ref.set(postponed);
  clock+=3600000;await sweepUDeadlines(clock);
  const overdue=(await countJobs()).filter(n=>n.kind==='overdue');assert.equal(overdue.length,10);
  const oldRoundSent:any[]=[];while(await processUNotices(50,async p=>{oldRoundSent.push(p);return true;})){}
  assert.equal(oldRoundSent.filter(p=>p.title.includes('muddati tugadi')).length,10,'Past-round overdue reminders remain valid at delivery');
  await sweepUDeadlines(clock+15*60000);assert.equal((await countJobs()).filter(n=>n.kind==='overdue').length,10,'Postponed overdue notices do not repeat');
  postponed.round=1;await ref.set(postponed);
  await mutateUState(admin,'resolveDispute',{matchId:mismatch.id,resolution:'Ikkala hisob tekshirildi.'});
  for(const game of (await readUState()).matches.filter(x=>x.round===1&&!uMatchFinished(x)))await mutateUState(admin,'result',{matchId:game.id,home:1,away:0});
  state=await readUState();const jobs=(await db.collection('uzeflife_round_summaries').get()).docs;assert.equal(jobs.length,1);const job=jobs[0],data=job.data(),parts=JSON.parse(data.partsJson);
  const unlinked=structuredClone(state),slot=unlinked.roster!.find(r=>r.userId===home.id)!,placeholderId=`uze-slot-${slot.group}-${slot.slot}`;slot.userId=null;unlinked.participants.find(p=>p.id===home.id)!.id=placeholderId;for(const game of unlinked.matches){if(game.home===home.id)game.home=placeholderId;if(game.away===home.id)game.away=placeholderId;}
  assert.equal(uSummaryFingerprint(unlinked,1),uSummaryFingerprint(state,1),'Account linking preserves the public summary identity');assert.deepEqual(uLeagueStandings(unlinked).map(r=>r.name),uLeagueStandings(state).map(r=>r.name),'Roster tie order survives account linking');
  assert.ok(parts[0].text.includes('gol'));assert.ok(parts.some(p=>p.text.includes('natijalari')));assert.equal(parts.find(p=>p.model).model.rows.length,16);assert.equal(uLeagueStandings(state)[0].points,parts.find(p=>p.model).model.rows[0].stats[7]);
  const png=await renderTournamentImagePng(parts.find(p=>p.model).model);assert.ok(png.length>10000);
  const sent:any[]=[];const send=async part=>{sent.push(part);return 5000+sent.length;};let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});const first=processURoundSummary(async part=>{entered();await gate;return send(part);});await started;assert.equal(await processURoundSummary(send),false,'Another worker cannot claim an in-flight part');release();await first;assert.equal(sent.length,1,'The same part is delivered once');while(await processURoundSummary(send)){}assert.equal(sent.length,data.total);assert.equal((await job.ref.get()).data()?.state,'sent');assert.equal(await processURoundSummary(send),false);
  await mutateUState(admin,'result',{matchId:m.id,home:4,away:1});const versions=(await db.collection('uzeflife_round_summaries').get()).docs;assert.equal(versions.length,2);assert.equal((await job.ref.get()).data()?.cursor,data.total,'A correction never resets a delivered receipt');
  await processURoundSummary(async()=>{throw Error('lost Telegram response');});const uncertain=(await uSummaryStatus()).find(j=>j.state==='unverified')!;assert.ok(uncertain);let retries=0;assert.equal(await processURoundSummary(async()=>{retries++;return 999;}),false);assert.equal(retries,0,'Uncertain external delivery is never blindly repeated');
  await reconcileUSummary(uncertain.id,uncertain.cursor,uncertain.lease!,false);await assert.rejects(reconcileUSummary(uncertain.id,uncertain.cursor,uncertain.lease!,false),/yangilangan/);while(await processURoundSummary(send)){}
  console.log('PASS UZEFLIFE four features: durable topic proposal/opponent notification, self/outsider/stale rejection, opponent confirmation, mismatch/admin barrier, My Game/contact identity, 24h/3h/1h dedupe, complete-round result text/EFL PNG table/leaders, single-claim publication, immutable correction receipts and uncertain-delivery reconciliation; Telegram mocked.');
 }finally{
  Date.now=originalNow;for(const name of collections)for(const d of (await db.collection(name).get()).docs)await d.ref.delete();for(const c of backups)for(const row of c.rows)await db.collection(c.name).doc(row.id).set(row.data);
  if(prior)await ref.set(prior);else await ref.delete();for(const u of all)await db.collection('users').doc(u.id).delete();
 }
}
