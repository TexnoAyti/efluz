import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {teamLeaguePreviewRouter} from '../routes/teamLeaguePreview.routes';
import {actOnTeamLeague} from '../services/teamLeaguePreview';
import type {TeamLeague} from '../../types/teamLeaguePreview';
export async function verifyTeamPlayerMatches(){
 const db=getFirestoreDb(),id='tp_player_audit_123',ref=db.collection('team_league_preview_leagues').doc(id);
 const users=['home','away','outside','owner'].map((side,i)=>({id:'team-player-audit-'+side,telegramId:i===3?'5209126900':String(990100+i),username:i===0?'home_audit':'',firstName:side,isSuspended:false}));
 for(const u of users)await db.collection('users').doc(u.id).set(u);
 const member=(i:number)=>({id:'member'+i,name:users[i].firstName,userId:users[i].id,verified:true});
 const league:TeamLeague={id,ownerId:users[3].id,name:'Player audit',teamIds:['home','away'],starterCount:1,rounds:1,format:'LEAGUE',status:'ACTIVE',currentRound:1,totalRounds:1,version:1,updatedAt:'',audit:[],teams:{home:{id:'home',name:'Home',members:[member(0)],captainMemberId:'member0'},away:{id:'away',name:'Away',members:[member(1)],captainMemberId:'member1'}},fixtures:[{id:'fixture',round:1,stage:'LEAGUE',homeTeamId:'home',awayTeamId:'away',homeLineup:{starters:['member0'],reserves:[]},awayLineup:{starters:['member1'],reserves:[]},bouts:[{id:'bout',homeMemberId:'member0',awayMemberId:'member1',homeScore:null,awayScore:null}]}]};
 await ref.set(league);
 const app=express();app.use(express.json());app.use(authMiddleware);app.use('/api/team-leagues-preview',teamLeaguePreviewRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const host=`http://127.0.0.1:${(server.address() as any).port}/api/team-leagues-preview/player/leagues/${id}/matches`;
 const call=async(i:number,body?:any)=>{const r=await fetch(host,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:'Bearer '+createSessionToken(users[i] as any)},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json() as any};};
 const input=(version:number,action='SUBMIT_RESULT')=>({version,action,fixtureId:'fixture',boutId:'bout',homeScore:0,awayScore:2});
 try{
  const outsider=await call(2);assert.equal(outsider.status,200,JSON.stringify(outsider));assert.equal(outsider.body.data.matches.length,0);
  const home=(await call(0)).body.data;assert.equal(home.matches[0].contactUrl,'tg://user?id=990101');
  assert.equal((await call(1)).body.data.matches[0].contactUrl,'https://t.me/home_audit');
  assert.equal((await call(2,input(1))).status,403);
  assert.equal((await call(0,{...input(1),homeScore:-1})).status,400);
  assert.equal((await call(0,input(1))).status,200);
  assert.equal((await ref.get()).data()?.fixtures[0].bouts[0].homeScore,null);
  assert.equal((await call(0,input(2,'CONFIRM_RESULT'))).status,403);
  assert.equal((await call(1,input(1,'CONFIRM_RESULT'))).status,409);
  await assert.rejects(()=>actOnTeamLeague(users[3].id,id,{action:'RESET',version:2,fixtureId:'fixture'}),/Natijalar bor/);
  assert.equal((await call(1,input(2,'DISPUTE_RESULT'))).status,200);
  assert.equal((await call(0,input(3))).status,200);
  const race=await Promise.all([call(1,input(4,'CONFIRM_RESULT')),call(1,input(4,'CONFIRM_RESULT'))]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const result=(await ref.get()).data()!;assert.equal(result.status,'COMPLETED');assert.equal(result.fixtures[0].bouts[0].homeScore,0);assert.equal(result.fixtures[0].bouts[0].awayScore,2);assert.equal(result.fixtures[0].bouts[0].pendingResult,undefined);
  console.log('PASS team player HTTP: own-match privacy, Telegram links, score bounds, outsider/self-confirm ACL, stale versions, pending reset guard, dispute/resubmit and concurrent exactly-once completion');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await ref.delete();for(const u of users)await db.collection('users').doc(u.id).delete();}
}
