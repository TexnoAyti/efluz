import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {mutateSeasonAwards,readSeasonAwards} from '../services/seasonAwardsService';
import {seasonAwardsRouter} from '../routes/seasonAwards.routes';
import {awardWeek,awardPlayers,awardStandings,awardTiedWinners} from '../../lib/seasonAwards';
import {SEED_CLUBS} from '../db/seed';
import type {User,Fixture} from '../../types';
import type {AwardElection} from '../../types/seasonAwards';
export async function verifySeasonAwards(){
 const db=getFirestoreDb(),season='season-2097-98',ref=db.collection('season_awards').doc(season),now=Date.now(),week=awardWeek(now);
 const users=Array.from({length:22},(_,i)=>({id:'award-user-'+i,telegramId:String(961000+i),username:'award_player_'+i,firstName:'Award Player',isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''} as User));
 const admin={...users[0],id:'award-admin',telegramId:'961100',isAdmin:true},scope={...users[1],isAdmin:true,adminPermissions:{scope:'LEAGUES',leagueIds:['league-premier-league']}} as User;
 users[1]=scope;for(const u of [...users,admin])await db.collection('users').doc(u.id).set(u);
 const clubs=SEED_CLUBS.slice(0,24),rows:Fixture[]=[];
 for(let i=0;i<20;i++)await db.collection('club_occupancies').doc(season+'_'+clubs[i].id).set({seasonId:season,clubId:clubs[i].id,userId:users[i].id,status:'active',claimedAt:new Date(week.from-30*86400000).toISOString()});
 await db.collection('club_occupancies').doc(season+'_'+clubs[20].id).set({seasonId:season,clubId:clubs[20].id,userId:users[0].id,status:'active'});
 for(let r=0;r<3;r++)for(let i=0;i<20;i++){
  const away=(i+1)%20,f={id:`awards-f-${r}-${i}`,seasonId:season,competitionId:'comp-premier-league-2026',matchday:r+1,homeClubId:clubs[i].id,awayClubId:clubs[away].id,homeOwnerId:users[i].id,awayOwnerId:users[away].id,status:'CONFIRMED',homeScore:i%5,awayScore:1,homePenaltyScore:20,awayPenaltyScore:10,resultConfirmedAt:new Date(r===2?week.from-3600000:now-1000).toISOString(),scheduledAt:'',createdAt:'',updatedAt:''} as Fixture;rows.push(f);await db.collection('fixtures').doc(f.id).set(f);
 }
 const state=async()=>(await ref.get()).data() as AwardElection;
 try{
  assert.equal(new Date(awardWeek(Date.parse('2026-11-01T20:00:00Z')).from).toISOString(),'2026-11-01T19:00:00.000Z');
  const transfer=awardPlayers([{...rows[0],homeOwnerId:users[0].id,homeScore:4}], [{clubId:clubs[0].id,userId:users[20].id,claimedAt:new Date(now+1000).toISOString()}],users);
  assert.equal(transfer.players.find(p=>p.id===users[0].id)?.goals,4);assert.ok(!transfer.players.some(p=>p.id===users[20].id));
  const unknown=awardPlayers([{...rows[0],homeOwnerId:undefined,homeScore:4}], [{clubId:clubs[0].id,userId:users[20].id,claimedAt:new Date(now+1000).toISOString()}],users);assert.ok(!unknown.players.some(p=>p.id===users[20].id));
  const justScores=awardPlayers([...rows,{...rows[0],id:'pending',status:'PENDING_CONFIRMATION',homeScore:99}],[],users);assert.equal(justScores.players.find(p=>p.id===users[0].id)?.goals,3,'Penalties and pending scores do not inflate goals');
  const preview=await readSeasonAwards(season);assert.equal(preview.election.nominees.length,10);assert.equal(preview.election.id,'');assert.ok(preview.weekly.previousLeaders.length);
  await assert.rejects(mutateSeasonAwards(season,{...users[0],isAdmin:true},{action:'PREPARE',version:0,minMatches:3}),/admin/);
  await assert.rejects(mutateSeasonAwards(season,scope,{action:'PREPARE',version:0,minMatches:3}),/admin/);
  await mutateSeasonAwards(season,admin,{action:'PREPARE',version:0,minMatches:3});let e=await state();assert.equal(e.nominees.length,10);const originalIds=e.nominees.map(p=>p.id);
  await mutateSeasonAwards(season,admin,{action:'OPEN',version:e.version,closesAt:new Date(now+3600000).toISOString()});e=await state();assert.equal(e.jury.length,20,'A multi-club owner is one voter');
  const vote=(u:User,ranking=originalIds)=>mutateSeasonAwards(season,u,{action:'VOTE',electionId:e.id,ranking});
  await assert.rejects(vote(users[20]),/klub/);await assert.rejects(vote(users[0],Array(10).fill(originalIds[0])),/takrorlamasdan/);
  await assert.rejects(vote(users[0],[...originalIds.slice(1),'foreign-user']),/takrorlamasdan/);
  await assert.rejects(mutateSeasonAwards(season,admin,{action:'PREPARE',version:e.version,minMatches:1}),/nomzodlar/);
  await db.collection('users').doc('award-alias').set({...users[0],id:'award-alias'});await assert.rejects(vote(users[0]),/klub/);await db.collection('users').doc('award-alias').delete();
  await db.collection('users').doc(users[0].id).update({isSuspended:true});await assert.rejects(vote(users[0]),/vakolati/);await db.collection('users').doc(users[0].id).update({isSuspended:false});
  const deadlineBefore=(await state()).closesAt;await ref.update({closesAt:new Date(now-1000).toISOString()});await assert.rejects(vote(users[0]),/yopilgan/);await ref.update({closesAt:deadlineBefore});
  await vote(users[0]);await vote(users[0]);assert.equal(Object.keys((await state()).ballots).length,1,'Repeat vote updates the same Telegram ballot');
  await Promise.all([vote(users[0]),vote(users[1],[...originalIds].reverse())]);e=await state();assert.equal(Object.keys(e.ballots).length,2);assert.deepEqual(e.nominees.map(p=>p.id),originalIds);
  const hidden=await readSeasonAwards(season,users[2]);assert.deepEqual(hidden.results,[]);assert.deepEqual(hidden.myRanking,[]);assert.ok(!('ballots' in hidden.election)&&!('jury' in hidden.election));assert.ok(!JSON.stringify(hidden).includes(users[0].telegramId));
  await db.collection('club_occupancies').doc(season+'_'+clubs[21].id).set({seasonId:season,clubId:clubs[21].id,userId:users[20].id,status:'active'});await assert.rejects(vote(users[20]),/klub/,'A club acquired after opening cannot create another voter');
  await assert.rejects(mutateSeasonAwards(season,admin,{action:'PUBLISH',version:e.version}),/tugashi/);
  await mutateSeasonAwards(season,admin,{action:'CLOSE',version:e.version});e=await state();await assert.rejects(vote(users[0]),/yopilgan/);
  const tied=awardTiedWinners(awardStandings(e));assert.equal(tied.length,2);await assert.rejects(mutateSeasonAwards(season,admin,{action:'PUBLISH',version:e.version}),/Tenglik/);
  await assert.rejects(mutateSeasonAwards(season,admin,{action:'PUBLISH',version:e.version,tieWinner:originalIds[1],reason:'Qaror sababi'}),/Tenglik/);
  await mutateSeasonAwards(season,admin,{action:'PUBLISH',version:e.version,tieWinner:tied[0],reason:'Tenglik tashkilotchi tomonidan hal qilindi'});const publicView=await readSeasonAwards(season);assert.deepEqual(publicView.winners,[tied[0]]);assert.equal(publicView.results[0].points,16);
  await assert.rejects(mutateSeasonAwards(season,admin,{action:'OPEN',version:(await state()).version,closesAt:new Date(now+3600000).toISOString()}),/ochib bo‘lmaydi/);
  const app=express();app.use(express.json());app.use('/awards',seasonAwardsRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{const url=`http://127.0.0.1:${(server.address() as any).port}/awards/${season}`;assert.equal((await fetch(url)).status,200);assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'VOTE',electionId:e.id,ranking:originalIds})})).status,401);assert.equal((await fetch(url.replace(season,'invalid'))).status,400);}finally{await new Promise<void>(r=>server.close(()=>r()));}
  console.log('PASS season awards: automatic unique TOP-10, first-ten points/countback tie, golden boot without penalties/pending results, Tashkent weeks, historical ownership, full-admin ACL, frozen jury/list, one Telegram ballot/multiple clubs, suspension/duplicate/outsider denial, concurrent votes, private ballots/hidden totals, deadline/close/publish and tie-only adjudication, HTTP validation.');
 }finally{
  await ref.delete();for(const f of rows)await db.collection('fixtures').doc(f.id).delete();for(const u of [...users,admin])await db.collection('users').doc(u.id).delete();await db.collection('users').doc('award-alias').delete();
  for(const row of (await db.collection('club_occupancies').where('seasonId','==',season).get()).docs)await row.ref.delete();for(const row of (await db.collection('season_awards_audit').where('seasonId','==',season).get()).docs)await row.ref.delete();
 }
}
