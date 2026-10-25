import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {teamLeaguePreviewRouter} from '../routes/teamLeaguePreview.routes';
import {makeTeamSchedule} from '../../lib/teamLeagueEngine';
import {hydrateTeamTransport} from '../../lib/teamLeaguePreviewApi';
import type {PreviewTeam,TeamLeague} from '../../types/teamLeaguePreview';
export async function verifyTeamTournamentAdmin(failNextCommit:()=>void){
 const db=getFirestoreDb(),prior=await db.collection('users').where('telegramId','==','5209126900').get(),saved=prior.docs.map(d=>({id:d.id,data:d.data()}));for(const d of prior.docs)await d.ref.delete();
 const user=(id:string,tg:string,admin=false)=>({id,telegramId:tg,username:id,firstName:id,isAdmin:admin,isSuspended:false,createdAt:'',updatedAt:''});const owner=user('user-tournament-owner','5209126900'),admin=user('user-tournament-admin','882001'),other=user('user-tournament-other','882002'),global=user('user-tournament-global','882003',true);for(const u of [owner,admin,other,global])await db.collection('users').doc(u.id).set(u);
 const app=express();app.use(express.json());app.use(authMiddleware);app.use('/api/team-leagues-preview',teamLeaguePreviewRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const host=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=async(path:string,body?:any,actor=admin)=>{const r=await fetch(host+'/api/team-leagues-preview'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+createSessionToken(actor),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json() as any};};
 const teams:PreviewTeam[]=Array.from({length:4},(_,i)=>({id:`tp_tournament_team${i}`,ownerId:owner.id,name:'Tournament Team '+i,logo:'',members:[{id:`tp_tournament_player${i}`,name:'Player '+i}],captainMemberId:`tp_tournament_player${i}`,membershipRequired:false,version:1,updatedAt:''}));for(const t of teams)await db.collection('team_league_preview_teams').doc(t.id).set(t);
 const input={id:'tp_tournament_champions',name:'Teamlar Chempionlar ligasi',description:'League and playoffs',competitionType:'CHAMPIONS_LEAGUE',format:'LEAGUE_AND_PLAYOFF',qualifiers:2,teamIds:teams.map(t=>t.id),starterCount:1,rounds:1,version:0,adminUserId:admin.id};
 try{
  assert.equal((await call('/administrators/resolve?reference='+admin.id,undefined,owner)).body.data.id,admin.id);assert.equal((await call('/administrators/resolve?reference='+owner.id)).status,403);
  assert.equal((await call('/leagues',input,global)).status,403,'A global admin cannot create or appoint tournament admins');
  assert.equal((await call('/leagues',{...input,adminUserId:'user-missing'},owner)).status,403);
  assert.equal((await call('/leagues',{...input,format:'LEAGUE'},owner)).status,400,'Champions League type uses league plus playoffs');
  let created=await call('/leagues',input,owner);assert.equal(created.status,200,JSON.stringify(created.body));let league=created.body.data as TeamLeague;assert.equal(league.adminUserId,admin.id);assert.equal(league.ownerId,owner.id);assert.equal(league.competitionType,'CHAMPIONS_LEAGUE');
  assert.ok((await call('/membership')).body.data.managedLeagues.some((l:TeamLeague)=>l.id===league.id));assert.equal((await call('/membership',undefined,other)).body.data.managedLeagues.length,0);
  const managed='/managed/leagues/'+league.id;
  assert.equal((await call(managed,undefined,other)).status,403);assert.equal((await call(managed,undefined,global)).status,403);assert.equal((await call(managed+'/teams',undefined,other)).status,403);
  assert.equal((await call('/published/leagues/'+league.id,undefined,other)).status,404,'Assigned drafts stay private');
  assert.equal((await call(managed+'/update',{...input,version:league.version,adminUserId:other.id})).status,403,'Assigned admin cannot escalate or transfer their role');
  assert.equal((await call('/leagues/'+league.id+'/administrator',{adminUserId:other.id,version:league.version})).status,403);
  assert.equal((await call('/teams',{id:teams[0].id})).status,403);assert.equal((await call('/tickets/grant',{targetUserId:other.id,amount:1,requestId:'forbidden-turnir-ticket'})).status,403);assert.equal((await call('/leagues/'+league.id+'/delete',{version:league.version})).status,403);
  const {adminUserId,...editing}=input;let edited=await call(managed+'/update',{...editing,name:'Edited Champions League',version:league.version});assert.equal(edited.status,200,JSON.stringify(edited.body));league=edited.body.data;
  const extra={...teams[0],id:'tp_tournament_extrateam'};await db.collection('team_league_preview_teams').doc(extra.id).set(extra);assert.equal((await call(managed+'/update',{...editing,teamIds:[...input.teamIds,extra.id],version:league.version})).status,403,'Assigned role does not expose unrelated private teams');
  await db.collection('team_league_preview_leagues').doc(league.id).update({membershipRequired:false});
  await db.collection('users').doc(admin.id).update({isSuspended:true});assert.equal((await call(managed+'/actions',{action:'START',version:league.version})).status,403,'Fresh actor suspension defeats an existing signed token');await db.collection('users').doc(admin.id).update({isSuspended:false});
  const act=async(body:any)=>{const r=await call(managed+'/actions',{...body,version:league.version});assert.equal(r.status,200,JSON.stringify(r.body));league=r.body.data;};await act({action:'START'});
  assert.equal((await call(managed+'/update',{...editing,version:league.version})).status,409,'Started rules stay locked');
  assert.equal((await call('/published/leagues/'+league.id,undefined,other)).body.data.competitionType,'CHAMPIONS_LEAGUE');assert.equal((await call('/published/leagues/'+league.id,undefined,other)).body.data.adminUserId,undefined,'Public records do not disclose admin account IDs');
  let played=0;while(league.status==='ACTIVE'){
   const fixtures=league.fixtures.filter(f=>f.round===league.currentRound);
   for(const fixture of fixtures){for(const side of ['home','away'] as const){const tid=side==='home'?fixture.homeTeamId:fixture.awayTeamId;await act({action:'LINEUP',fixtureId:fixture.id,side,lineup:{starters:[league.teams[tid].members[0].id],reserves:[]}});}await act({action:'PAIR',fixtureId:fixture.id});const bout=league.fixtures.find(f=>f.id===fixture.id)!.bouts[0];await act({action:'SCORE',fixtureId:fixture.id,boutId:bout.id,homeScore:2,awayScore:0});played++;}
   if(league.status==='ACTIVE')await act({action:'NEXT'});assert.ok(played<=7);
  }assert.equal(played,7);assert.equal(league.status,'COMPLETED');assert.equal(league.fixtures.filter(f=>f.stage==='PLAYOFF').length,1);assert.ok(league.audit.every(a=>a.actorId===admin.id));
  failNextCommit();assert.ok((await call('/leagues/'+league.id+'/administrator',{adminUserId:other.id,version:league.version},owner)).status>=500);assert.equal((await db.collection('team_league_preview_leagues').doc(league.id).get()).data().adminUserId,admin.id,'Failed SQL transaction does not change delegation');
  assert.equal((await call('/leagues/'+league.id+'/administrator',{adminUserId:other.id,version:league.version-1},owner)).status,409);
  const reassigned=await call('/leagues/'+league.id+'/administrator',{adminUserId:other.id,version:league.version},owner);assert.equal(reassigned.status,200);league=reassigned.body.data;
  assert.equal((await call(managed)).status,403);assert.equal((await call(managed+'/actions',{action:'CANCEL',version:league.version})).status,403);assert.equal((await call(managed,undefined,other)).status,200);assert.equal((await call('/membership')).body.data.managedLeagues.some((l:TeamLeague)=>l.id===league.id),false);
  const large={...league,id:'tp_tournament_large',status:'ACTIVE',currentRound:1,fixtures:makeTeamSchedule('tp_tournament_large',Array.from({length:20},(_,i)=>`tp_tournament_id${i}`),1),adminUserId:admin.id};await db.collection('team_league_preview_leagues').doc(large.id).set(large);
  const page=await call('/managed/leagues/'+large.id);assert.ok(page.body.data.fixturePage.next);const hydrated=await hydrateTeamTransport(page.body.data,async next=>(await call(next)).body.data);assert.equal(hydrated.fixtures.length,190,'Assigned 20-team league hydrates every fixture page');
  const first=await call('/managed/leagues/'+large.id),next=first.body.data.fixturePage.next;await db.collection('team_league_preview_leagues').doc(large.id).update({adminUserId:other.id,version:large.version+1});assert.equal((await call(next)).status,403,'Cached fixture pages cannot bypass revoked assignment');
  console.log('PASS Team tournament administrators: owner assignment/lookup, private draft discovery, scoped admin actions, Champions League league-to-final lifecycle, actor audit, global/team admin isolation, role revocation/suspension, rollback, started-rule locks and fresh ACL on paginated fixtures');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));for(const u of [owner,admin,other,global])await db.collection('users').doc(u.id).delete();for(const row of saved)await db.collection('users').doc(row.id).set(row.data);}
}
