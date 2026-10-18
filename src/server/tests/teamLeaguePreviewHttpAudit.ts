import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {createCanvas} from '@napi-rs/canvas';
import {getFirestoreDb} from '../firebase/admin';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {teamLeaguePreviewRouter} from '../routes/teamLeaguePreview.routes';
import {makeTeamSchedule,teamFixtureScore,teamStandings} from '../../lib/teamLeagueEngine';
import type {TeamLeague} from '../../types/teamLeaguePreview';
export async function verifyTeamLeaguePreview(failNextCommit:()=>void){
 for(let n=2;n<=16;n++)for(const legs of [1,2] as const){const ids=Array.from({length:n},(_,i)=>String(i));const schedule=makeTeamSchedule('test',ids,legs);assert.equal(schedule.length,n*(n-1)/2*legs);const pairs=new Map<string,number>();for(const f of schedule){assert.notEqual(f.homeTeamId,f.awayTeamId);const key=[f.homeTeamId,f.awayTeamId].sort().join(':');pairs.set(key,(pairs.get(key)||0)+1);}assert.ok([...pairs.values()].every(v=>v===legs));for(const r of new Set(schedule.map(f=>f.round))){const teams=schedule.filter(f=>f.round===r).flatMap(f=>[f.homeTeamId,f.awayTeamId]);assert.equal(new Set(teams).size,teams.length);}if(legs===2)for(const f of schedule)assert.equal(schedule.filter(g=>g.homeTeamId===f.awayTeamId&&g.awayTeamId===f.homeTeamId).length,1);}
 process.env.SESSION_SECRET='isolated-team-preview-secret-32bytes';const db=getFirestoreDb();
 const owner={id:'team-owner',telegramId:'5209126900',username:'owner',firstName:'Owner',lastName:'',photoUrl:'',isAdmin:true,isSuspended:false,createdAt:'',updatedAt:''},other={...owner,id:'team-other-admin',telegramId:'1234567'};
 await db.collection('users').doc(owner.id).set(owner);await db.collection('users').doc(other.id).set(other);
 const app=express();app.use(express.json({limit:'256kb'}));app.use(authMiddleware);app.use('/api/team-leagues-preview',teamLeaguePreviewRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}/api/team-leagues-preview`;
 const call=async(path='',body?:unknown,actor:any=owner)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(actor?{authorization:`Bearer ${createSessionToken(actor)}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 try{
  assert.equal((await call('',undefined,null)).status,401);assert.equal((await call('',undefined,other)).status,403);assert.equal((await call('',undefined,{...other,telegramId:owner.telegramId})).status,403);
  for(const path of ['/teams','/leagues','/leagues/tp_testleague/actions'])assert.equal((await call(path,{},other)).status,403);
  await db.collection('users').doc(owner.id).update({isSuspended:true});assert.equal((await call()).status,403);await db.collection('users').doc(owner.id).update({isSuspended:false});
  const logo=createCanvas(32,32).toDataURL('image/png');const payload=(index:number)=>({id:`tp_team000${index}`,name:`Test Team ${index}`,logo,members:Array.from({length:3},(_,i)=>({id:`tp_member${index}00${i}`,name:`Player ${index}-${i}`})),captainMemberId:`tp_member${index}000`,version:0});
  assert.equal((await call('/teams',{...payload(0),logo:'data:image/png;base64,bm90cG5n'})).status,400);
  assert.equal((await call('/teams',{...payload(0),captainMemberId:'unknown'})).status,400);
  for(let i=0;i<3;i++){const r=await call('/teams',payload(i));assert.equal(r.status,200,JSON.stringify(r));assert.equal((await call('/teams',payload(i))).body.data.version,1);}
  const draft={id:'tp_testleague',name:'Owner Test League',teamIds:[0,1,2].map(i=>payload(i).id),starterCount:2,rounds:1,version:0};assert.equal((await call('/leagues',{...draft,starterCount:4})).status,400);
  assert.equal((await call('/leagues',draft)).status,200);let league:TeamLeague=(await call('/leagues/'+draft.id)).body.data;
  const act=async(body:any)=>{const r=await call(`/leagues/${league.id}/actions`,{version:league.version,...body});if(r.status===200)league=r.body.data;return r;};
  failNextCommit();assert.ok((await act({action:'START'})).status>=500);assert.equal((await call()).body.data.leagues[0].version,league.version,'Failed transaction did not persist');
  assert.equal((await act({action:'START'})).status,200);assert.equal(league.fixtures.length,3);assert.equal(league.totalRounds,3);
  assert.equal((await call('/teams',{...payload(0),name:'Changed',version:1})).status,409);
  assert.equal((await call('/leagues',{...draft,version:league.version})).status,409);
  assert.equal((await act({action:'NEXT'})).status,409);const future=league.fixtures.find(f=>f.round===2)!;assert.equal((await act({action:'PAIR',fixtureId:future.id})).status,409);
  for(let round=1;round<=3;round++){
   const f=league.fixtures.find(f=>f.round===round)!;
   for(const side of ['home','away'] as const){const team=league.teams[side==='home'?f.homeTeamId:f.awayTeamId];const members=team.members.map(p=>p.id);assert.equal((await act({action:'LINEUP',fixtureId:f.id,side,lineup:{starters:[members[0],members[0]],reserves:[]}})).status,400);assert.equal((await act({action:'LINEUP',fixtureId:f.id,side,lineup:{starters:members.slice(0,2),reserves:members.slice(2)}})).status,200);}
   assert.equal((await act({action:'PAIR',fixtureId:f.id})).status,200);let paired=league.fixtures.find(g=>g.id===f.id)!;assert.equal(new Set(paired.bouts.map(b=>b.homeMemberId)).size,2);assert.equal(new Set(paired.bouts.map(b=>b.awayMemberId)).size,2);assert.equal((await act({action:'PAIR',fixtureId:f.id})).status,409);
   const reserve=paired.homeLineup!.reserves[0];assert.equal((await act({action:'SUBSTITUTE',fixtureId:f.id,boutId:paired.bouts[0].id,side:'home',memberId:reserve})).status,200);paired=league.fixtures.find(g=>g.id===f.id)!;assert.equal(paired.bouts[0].homeMemberId,reserve);
   const version=league.version;const writes=await Promise.all([0,1].map(i=>call(`/leagues/${league.id}/actions`,{action:'SCORE',version,fixtureId:f.id,boutId:paired.bouts[i].id,homeScore:3,awayScore:1})));assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);league=(await call('/leagues/'+league.id)).body.data;
   const unscored=league.fixtures.find(g=>g.id===f.id)!.bouts.find(b=>b.homeScore===null)!;assert.equal((await act({action:'SCORE',fixtureId:f.id,boutId:unscored.id,homeScore:2,awayScore:2})).status,200);
   assert.equal((await act({action:'RESET',fixtureId:f.id})).status,409);assert.equal((await act({action:'SUBSTITUTE',fixtureId:f.id,boutId:paired.bouts[0].id,side:'home',memberId:paired.homeLineup!.reserves[0]})).status,409);
   const score=teamFixtureScore(league.fixtures.find(g=>g.id===f.id)!);assert.deepEqual(score,{home:1,away:0,draws:1,played:2,complete:true});
   if(round<3)assert.equal((await act({action:'NEXT'})).status,200);
  }
  assert.equal(league.status,'COMPLETED');assert.equal(teamStandings(league).reduce((sum,r)=>sum+r.points,0),9);const f=league.fixtures[0];for(const b of f.bouts)assert.equal((await act({action:'SCORE',fixtureId:f.id,boutId:b.id,homeScore:0,awayScore:1})).status,200);assert.equal(teamFixtureScore(league.fixtures[0]).away,2);assert.equal((await call()).body.data.leagues[0].version,league.version);
  const second={...draft,id:'tp_cancelledleague',version:0};assert.equal((await call('/leagues',second)).status,200);league=(await call('/leagues/'+second.id)).body.data;assert.equal((await act({action:'CANCEL'})).status,200);assert.equal((await act({action:'START'})).status,409);
  console.log('PASS owner-only team preview HTTP, PNG/roster validation, all round-robin sizes, native transaction rollback, concurrent result exclusion, captain lineups, reserves, random bijections, rounds, score corrections and standings');
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
