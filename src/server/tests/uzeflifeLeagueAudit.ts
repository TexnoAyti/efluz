import assert from 'node:assert/strict';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState,mutateUState,readUState,applyUAction} from '../services/uzeflifeService';
import {migrateUzeLeagueRegistration} from '../services/uzeflifeLeagueMigration';
import {initialUzeflifeRoster,UZEFLIFE_ROSTER_GROUPS} from '../../data/uzeflifeRoster20261021';
import {createULeagueMatches,uMatchFinished,uLeagueStandings} from '../../lib/uzeflifeLeague';
import {uzeflifeMatchLink} from '../../lib/uzeflifeLinks';
import {uTransitionNotices,validUNotice} from '../services/uzeflifeNotifications';
export async function verifyUzeflifeLeague(){
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),prior=(await ref.get()).data();
 const priorJobs=new Set((await db.collection('uzeflife_notifications').get()).docs.map(d=>d.id));
 const owner:any={id:'uze-league-owner',telegramId:'5209126900',firstName:'Owner'};
 const roster=initialUzeflifeRoster();assert.deepEqual(UZEFLIFE_ROSTER_GROUPS.map(g=>g.length),Array(8).fill(32));assert.equal(roster.filter(r=>r.username).length,242);assert.equal(roster.filter(r=>r.duplicateOf).length,14);assert.equal(roster[32+20].username,null);assert.equal(roster[32+5].username,'Farruxbeeekk');assert.deepEqual(roster[255],{group:8,slot:32,originalUsername:'JAVOHIR_16_07',username:'JAVOHIR_16_07',userId:null});
 const unclaimed=initialUState();unclaimed.format='LEAGUE';unclaimed.roster=structuredClone(roster);unclaimed.status='registration';const ownerForFixtures:any={id:'league-fixture-owner',telegramId:'5209126900',firstName:'Owner'};applyUAction(unclaimed,ownerForFixtures,'generate',{});assert.equal(unclaimed.matches.length,1815);assert.equal(unclaimed.participants.filter(p=>p.status==='approved').length,242);assert.equal(unclaimed.matches.filter(m=>m.round===1).length,121);const first=roster.find(r=>r.username)!;const oldId='uze-slot-'+first.group+'-'+first.slot;assert.ok(unclaimed.matches.some(m=>m.home===oldId||m.away===oldId));const realPlayer:any={id:'newly-linked-player',username:first.username,firstName:'Player',telegramId:'101010101'};applyUAction(unclaimed,realPlayer,'register',{});assert.equal(unclaimed.roster!.find(r=>r.group===first.group&&r.slot===first.slot)?.userId,realPlayer.id);assert.ok(!unclaimed.matches.some(m=>m.home===oldId||m.away===oldId));assert.ok(unclaimed.matches.some(m=>m.home===realPlayer.id||m.away===realPlayer.id));assert.equal(unclaimed.participants.filter(p=>p.status==='approved').length,242);
 const schedule=createULeagueMatches(roster.filter(r=>r.username).map((_,i)=>'p'+i));assert.equal(schedule.length,1815);assert.equal(new Set(schedule.map(m=>[m.home,m.away].sort().join(':'))).size,1815,'No repeated opponents in 15 rounds');
 for(let round=1;round<=15;round++){const games=schedule.filter(m=>m.round===round);assert.equal(games.length,121);assert.equal(new Set(games.flatMap(m=>[m.home,m.away])).size,242);}
 assert.throws(()=>createULeagueMatches(['a','b']));assert.throws(()=>createULeagueMatches(Array.from({length:17},(_,i)=>String(i))));assert.equal(uzeflifeMatchLink('l15m120'),'https://t.me/efluzbot?startapp=uze_l15m120');assert.throws(()=>uzeflifeMatchLink('l16m0'));
 const users=roster.slice(0,16).map((r,i)=>({id:'uze-league-'+i,telegramId:String(884000+i),username:r.username!,firstName:r.username!,isSuspended:false,isAdmin:false,createdAt:'',updatedAt:''}));
 for(const u of [owner,...users])await db.collection('users').doc(u.id).set(u);
 try{
  const empty=initialUState();empty.status='registration';empty.participants=[{id:users[0].id,name:'Pending original application',status:'pending'}];empty.channels=[{id:'@savedchannel',title:'Saved',url:'https://t.me/savedchannel'}];await ref.set(empty);
  const migrated=await migrateUzeLeagueRegistration(db,ref,initialUState);assert.equal(migrated.format,'LEAGUE');assert.equal(migrated.roster?.length,256);assert.deepEqual(migrated.channels,empty.channels);assert.equal(migrated.totalRounds,15);assert.deepEqual(migrated.participants,empty.participants,'The existing pending application is retained during configuration');
  assert.equal((await migrateUzeLeagueRegistration(db,ref,initialUState)).revision,migrated.revision,'Migration is idempotent');
  assert.ok((await db.collection('uzeflife_config_history').doc('league-roster-20261021').get()).exists);
  await mutateUState(owner,'generate',{});assert.equal((await readUState()).matches.length,1815,'All 242 Telegram usernames can be drawn without account claims');
  // Use a small real-account league to exercise all 15 rounds through the same mutation path.
  migrated.roster=migrated.roster!.map((r,i)=>i<16?r:{...r,username:null,userId:null});await ref.set(migrated);
  const outsider={...users[0],id:'outsider',username:'not_listed'};await assert.rejects(()=>mutateUState(outsider,'register',{}),/242 kishilik/);assert.equal((await readUState()).roster?.filter(r=>r.username).length,16,'Test fixture keeps only the sixteen original linked names');
  for(const u of users)await mutateUState(u,'register',{});
  let s=await readUState();assert.equal(s.participants.filter(p=>p.status==='approved').length,16);assert.equal(s.roster![0].userId,users[0].id);assert.equal(s.roster![0].group,1);assert.equal(s.roster![0].slot,1);
  await assert.rejects(()=>mutateUState(users[0],'rosterSlot',{group:2,slot:21,username:'new_player'}),/ruxsat/);
  await assert.rejects(()=>mutateUState(owner,'rosterSlot',{group:2,slot:21,username:users[0].username}),/allaqachon/);
  await assert.rejects(()=>mutateUState(owner,'rosterSlot',{group:2,slot:21,username:'new_player',expectedRevision:s.revision-1}),/yangilandi/);
  await mutateUState(owner,'generate',{});s=await readUState();assert.equal(s.matches.length,120);assert.equal(s.round,1);assert.equal(s.roster![0].username,users[0].username,'Starting never shuffles source slots');
  const m=s.matches[0],home=users.find(u=>u.id===m.home)!,away=users.find(u=>u.id===m.away)!;
  await mutateUState(home,'result',{matchId:m.id,home:2,away:2});s=await readUState();assert.equal(s.matches[0].homeScore,null);assert.equal(uLeagueStandings(s).reduce((n,r)=>n+r.points,0),0,'Pending draws never count');
  await assert.rejects(()=>mutateUState(home,'result',{matchId:m.id,home:2,away:2}),/tasdig/);
  await mutateUState(away,'result',{matchId:m.id,home:2,away:2});s=await readUState();assert.equal(s.matches[0].winner,null);assert.equal(uMatchFinished(s.matches[0]),true);assert.equal(uLeagueStandings(s).find(r=>r.id===home.id)?.points,1);
  await assert.rejects(()=>mutateUState(away,'result',{matchId:m.id,home:2,away:2}),/allaqachon/);
  await assert.rejects(()=>mutateUState(owner,'next',{}),/tugamagan/);
  const before=structuredClone(s);applyUAction(s,owner,'result',{matchId:s.matches[1].id,home:0,away:0,penaltyHome:null,penaltyAway:null});const notices=uTransitionNotices(before,s);assert.ok(notices.some(n=>n.kind==='confirmed'&&n.body.includes('Durang')));assert.ok(notices.filter(n=>n.kind==='confirmed').every(n=>validUNotice(n,s)));assert.ok(!notices.some(n=>n.kind==='opponent'),'Confirmed draw never creates a new opponent');
  await ref.set(s);
  for(let round=1;round<=15;round++){
   s=await readUState();for(const match of s.matches.filter(m=>m.round===round&&!uMatchFinished(m)))applyUAction(s,owner,'result',{matchId:match.id,home:1,away:0,penaltyHome:null,penaltyAway:null});
   await ref.set(s);if(round<15)await mutateUState(owner,'next',{});
  }
  await assert.rejects(()=>mutateUState(owner,'next',{}),/tugamagan/);await mutateUState(owner,'complete',{});s=await readUState();assert.equal(s.status,'completed');assert.equal(s.history![0].matchCount,120);const archive=(await db.collection('uzeflife_history').doc(s.history![0].id).get()).data();assert.equal(archive?.format,'LEAGUE');assert.equal(archive?.totalRounds,15);
  const protectedState=initialUState();protectedState.status='registration';protectedState.participants=[{id:'existing',name:'Do not overwrite',status:'approved'}];await ref.set(protectedState);assert.equal((await migrateUzeLeagueRegistration(db,ref,initialUState)).format,undefined,'Existing entrants are not overwritten by the empty-registration migration');
  console.log('PASS UZEFLIFE league: 256 original slots, 242 unique/14 cleared duplicates, original positions, idempotent empty-state migration, 1815 unique fixtures, roster identity/ACL/version locks, 15 rounds, draw proposals/confirmation/points, notifications and league archive');
 }finally{for(const job of (await db.collection('uzeflife_notifications').get()).docs)if(!priorJobs.has(job.id))await job.ref.delete();if(prior)await ref.set(prior);else await ref.delete();for(const u of [owner,...users])await db.collection('users').doc(u.id).delete();}
}
