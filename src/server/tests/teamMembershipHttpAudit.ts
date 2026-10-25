import {hydrateTeamTransport} from '../../lib/teamLeaguePreviewApi';
import {clearTeamTransportSnapshots} from '../services/teamTransport';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {teamLeaguePreviewRouter} from '../routes/teamLeaguePreview.routes';
import {telegramRouter} from '../routes/telegram.routes';
import {createMembershipTeam,processTeamInvitationNotices,respondTeamTelegramInvitation} from '../services/teamMembershipService';
import {detectNaturalAdminAction} from '../services/telegramAiAdminLanguage';
import {planNaturalAdminRequest} from '../services/telegramAiNaturalAdminPlanner';
import {assertAdminPlanReady} from '../services/telegramAiAdminPlanReadiness';
import {executeAiAdminRoute} from '../services/telegramAiAdminGateway';
import {makeTeamSchedule} from '../../lib/teamLeagueEngine';
import {TEAM_LEAGUE_MAX_TEAMS,type PreviewTeam,type TeamLeague} from '../../types/teamLeaguePreview';
import {clearTelegramMembershipCache} from '../services/telegramBotService';
export async function verifyTeamMembership(failNextCommit:()=>void){
 const db=getFirestoreDb(),previousOwners=await db.collection('users').where('telegramId','==','5209126900').get();
 const savedOwners=previousOwners.docs.map(d=>({id:d.id,data:d.data()}));for(const row of previousOwners.docs)await row.ref.delete();
 const makeUser=(tg:string,username:string,isAdmin=false)=>({id:'user-'+tg,telegramId:tg,username,firstName:username,lastName:'',photoUrl:'',isAdmin,isSuspended:false,createdAt:'',updatedAt:''});
 const owner=makeUser('5209126900','membershipowner',true),creator=makeUser('870001','teamcreator'),other=makeUser('870002','teamother'),member=makeUser('870003','teammember'),member2=makeUser('870004','teamsecond'),globalAdmin=makeUser('870005','teamforeignadmin',true);
 for(const user of [owner,creator,other,member,member2,globalAdmin])await db.collection('users').doc(user.id).set(user);
 const group=new Map<string,string>(),fetchBefore=globalThis.fetch,envBefore={token:process.env.TELEGRAM_BOT_TOKEN,secret:process.env.TELEGRAM_WEBHOOK_SECRET};
 process.env.TELEGRAM_BOT_TOKEN='isolated-claim-test';process.env.TELEGRAM_WEBHOOK_SECRET='isolated-team-membership-webhook';
 globalThis.fetch=(async(input:any,init:any)=>{const url=new URL(String(input));if(url.origin==='https://api.telegram.org'&&url.pathname.endsWith('/getChatMember')){const status=group.get(url.searchParams.get('user_id')||'')||'member';return status==='unavailable'?Response.json({ok:false,description:'upstream unavailable'}):Response.json({ok:true,result:{status}});}return fetchBefore(input,init);}) as typeof fetch;
 const app=express();app.use(express.json({limit:'256kb'}));app.use(authMiddleware);app.use('/api/team-leagues-preview',teamLeaguePreviewRouter);app.use('/api/telegram',telegramRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const host=`http://127.0.0.1:${(server.address() as any).port}`;
 const call=async(path:string,body?:unknown,actor:any=creator)=>{const r=await fetch(host+'/api/team-leagues-preview'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(actor?{authorization:'Bearer '+createSessionToken(actor)}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,cache:r.headers.get('cache-control'),body:await r.json() as any};};
 const ticket=(target:any,amount:number,key:string,kind='grant',actor:any=owner)=>call('/tickets/'+kind,{targetUserId:target.id,amount,requestId:key},actor);
 const payload={name:'Membership Test Team',logo:'',requestId:'create-team-atomic-0001'};
 try{
  assert.equal((await call('/membership',undefined,null)).status,401);
  assert.equal((await call('/membership')).cache,'no-store');assert.equal((await call('/membership')).body.data.tickets.balance,0);
  assert.equal((await call('/membership/teams',payload)).status,402);
  const legacyOwnerTeam:PreviewTeam={id:'tp_ownerlegacy01',ownerId:owner.id,name:'Owner legacy team',logo:'',members:[{id:'tp_ownerlegacyplayer',name:'Legacy player'}],captainMemberId:'tp_ownerlegacyplayer',version:1,updatedAt:new Date().toISOString()};
  await db.collection('team_league_preview_teams').doc(legacyOwnerTeam.id).set(legacyOwnerTeam);
  assert.ok((await call('/membership',undefined,owner)).body.data.teams.some((t:PreviewTeam)=>t.id===legacyOwnerTeam.id),'Owner-created teams without adminUserId appear in My teams');
  assert.equal((await call('/membership/teams/'+legacyOwnerTeam.id,undefined,owner)).status,200,'Visible legacy team opens its owner manager');
  assert.equal((await call('/membership')).body.data.teams.some((t:PreviewTeam)=>t.id===legacyOwnerTeam.id),false,'Another user never receives an owner-only team');
  await db.collection('team_league_preview_teams').doc(legacyOwnerTeam.id).delete();
  for(const actor of [creator,globalAdmin])assert.equal((await ticket(creator,1,'forbidden-ticket-0001','grant',actor)).status,403);
  assert.equal((await ticket(creator,0,'invalid-amount-0001')).status,400);assert.equal((await ticket(creator,-1,'negative-amount-0001')).status,400);
  const grants=await Promise.all([ticket(creator,3,'grant-creator-0001'),ticket(creator,3,'grant-creator-0001')]);assert.ok(grants.every(r=>r.status===200));assert.equal((await call('/membership')).body.data.tickets.balance,3,'Repeated grant credits once');
  assert.equal((await ticket(other,3,'grant-creator-0001')).status,409,'Grant request is bound to one recipient');
  assert.equal((await ticket(creator,4,'grant-creator-0001')).status,409,'Idempotency key binds target, type and amount');
  assert.equal((await ticket(creator,4,'revoke-excess-0001','revoke')).status,409);
  assert.equal((await ticket(creator,1,'revoke-one-0001','revoke')).status,200);assert.equal((await call('/membership')).body.data.tickets.balance,2);
  group.set(creator.telegramId,'left');assert.equal((await call('/membership/teams',payload)).status,403);assert.equal((await call('/membership')).body.data.tickets.balance,2);
  group.set(creator.telegramId,'unavailable');assert.equal((await call('/membership/teams',payload)).status,503,'Fail-open Telegram responses cannot authorize team creation');
  group.set(creator.telegramId,'member');
  const savedToken=process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_BOT_TOKEN;assert.equal((await call('/membership/teams',payload)).status,503,'Missing production Telegram configuration is fail-closed');process.env.TELEGRAM_BOT_TOKEN=savedToken;
  failNextCommit();assert.ok((await call('/membership/teams',payload)).status>=500);assert.equal((await call('/membership')).body.data.tickets.balance,2,'Native SQL failed team write restores debit and receipt');
  const created=await Promise.all([call('/membership/teams',payload),call('/membership/teams',payload)]);assert.ok(created.every(r=>r.status===200),JSON.stringify(created));let team=created[0].body.data as PreviewTeam;
  assert.equal(created[1].body.data.id,team.id,'One team per repeated create request');assert.equal(team.adminUserId,creator.id);assert.equal(team.members[0].userId,creator.id);assert.equal(team.members[0].verified,true);assert.equal((await call('/membership')).body.data.tickets.balance,1);
  assert.equal((await call('/membership')).body.data.teams.filter((t:PreviewTeam)=>t.id===team.id).length,1,'Creator/admin/member indexes deduplicate their team');
  assert.equal((await call('/membership/teams',{...payload,name:'Changed payload'})).status,409);
  const competingCreates=await Promise.all([call('/membership/teams',{...payload,requestId:'competing-create-one'}),call('/membership/teams',{...payload,requestId:'competing-create-two'})]);assert.deepEqual(competingCreates.map(r=>r.status).sort(),[409,409]);assert.ok(competingCreates.every(r=>r.body.code==='TEAM_MEMBER_ALREADY_ASSIGNED'));assert.equal((await call('/membership')).body.data.tickets.balance,1,'Existing membership blocks another team without spending tickets');
  assert.equal((await call('/membership/teams/'+team.id,undefined,other)).status,403);
  assert.equal((await call('/membership/teams/'+team.id,undefined,globalAdmin)).status,403);
  assert.equal((await call('/leagues',{id:'tp_unauthorizedleague'},creator)).status,403);
  assert.equal((await call('/published/teams/'+team.id,undefined,other)).status,404,'Unpublished unrelated teams stay private');
  assert.equal((await call('/published/teams/'+team.id)).body.data.canManageTeam,true,'Creator can manage from their unpublished profile');
  const send=async(target:any,key:string,legacyMemberId?:string)=>call(`/membership/teams/${team.id}/invitations`,{targetUserId:target.id,requestId:key,legacyMemberId});
  assert.equal((await call(`/membership/teams/${team.id}/invitations`,{targetUserId:member.id,requestId:'foreign-invite-0001'},other)).status,403);
  const invited=await Promise.all([send(member,'invite-first-0001'),send(member,'invite-second-0001')]);assert.ok(invited.every(r=>r.status===200));assert.equal(invited[0].body.data.id,invited[1].body.data.id,'Concurrent invitations deduplicate across request IDs');const inv=invited[0].body.data;
  assert.equal((await call('/published/teams/'+team.id,undefined,member)).status,200,'Invitee can see team before deciding');
  assert.equal((await call('/membership',undefined,member)).body.data.invitations.length,1);
  assert.equal((await call(`/membership/invitations/${inv.id}/respond`,{accept:true},other)).status,403);
  assert.equal((await call(`/membership/invitations/${inv.id}/respond`,{accept:'false'},member)).status,400,'Boolean values are validated rather than coerced');
  await db.collection('team_membership_invitations').doc(inv.id).update({teamName:'<b>escaped team</b>'});
  let queued:any[]=[];await processTeamInvitationNotices(15,async params=>{queued.push(params);return true;});await processTeamInvitationNotices(15,async params=>{queued.push(params);return true;});assert.equal(queued.filter(p=>p.eventId==='team-invite:'+inv.id).length,1);assert.ok(queued.find(p=>p.eventId==='team-invite:'+inv.id).replyMarkup.inline_keyboard.flat().some((b:any)=>b.text==='Team profilini ochish'));
  assert.ok(queued.find(p=>p.eventId==='team-invite:'+inv.id).body.includes('&lt;b&gt;escaped team&lt;/b&gt;'));
  assert.ok(queued.every(p=>p.replyMarkup.inline_keyboard.flat().every((b:any)=>!b.callback_data||Buffer.byteLength(b.callback_data)<=64)));
  group.set(member.telegramId,'left');assert.equal((await call(`/membership/invitations/${inv.id}/respond`,{accept:true},member)).status,403);
  group.set(member.telegramId,'unavailable');assert.equal((await call(`/membership/invitations/${inv.id}/respond`,{accept:true},member)).status,503);
  group.set(member.telegramId,'member');
  failNextCommit();assert.ok((await call(`/membership/invitations/${inv.id}/respond`,{accept:true},member)).status>=500);assert.equal((await call('/membership/teams/'+team.id)).body.data.team.members.length,1);assert.equal((await db.collection('team_membership_invitations').doc(inv.id).get()).data().status,'PENDING');
  const joins=await Promise.all([call(`/membership/invitations/${inv.id}/respond`,{accept:true},member),call(`/membership/invitations/${inv.id}/respond`,{accept:true},member)]);assert.ok(joins.every(r=>r.status===200));team=(await call('/membership/teams/'+team.id)).body.data.team;assert.equal(team.members.filter(m=>m.userId===member.id).length,1);
  assert.equal((await call('/membership',undefined,member)).body.data.teams.some((t:any)=>t.id===team.id),true,'Confirmed members see their own team');
  assert.equal((await call('/membership/teams/'+team.id,undefined,member)).status,403,'Membership does not grant administrator rights');assert.equal((await call('/published/teams/'+team.id,undefined,member)).body.data.canManageTeam,false);
  const canceled=(await send(member2,'invite-cancel-0001')).body.data;assert.equal((await call(`/membership/invitations/${canceled.id}/cancel`,{})).status,200);assert.equal((await call(`/membership/invitations/${canceled.id}/respond`,{accept:true},member2)).status,409);
  const expired=(await send(member2,'invite-expire-0001')).body.data;await db.collection('team_membership_invitations').doc(expired.id).update({expiresAt:new Date(0).toISOString()});assert.equal((await call(`/membership/invitations/${expired.id}/respond`,{accept:true},member2)).status,409);const renewed=(await send(member2,'invite-renew-0001')).body.data;assert.notEqual(renewed.id,expired.id);
  // Telegram callbacks use the authoritative recipient, never the callback's message/chat owner.
  await assert.rejects(respondTeamTelegramInvitation(Number(other.telegramId),renewed.id,true),(e:any)=>e.statusCode===403);
  await respondTeamTelegramInvitation(Number(member2.telegramId),renewed.id,true);team=(await call('/membership/teams/'+team.id)).body.data.team;assert.equal(team.members.length,3);
  const webhookInvite=(await send(other,'invite-webhook-0001')).body.data;
  const webhook=await fetch(host+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':process.env.TELEGRAM_WEBHOOK_SECRET!},body:JSON.stringify({update_id:870001,callback_query:{id:'membership-callback',from:{id:Number(other.telegramId),first_name:'Other'},data:'team_invite:accept:'+webhookInvite.id,message:{message_id:1,chat:{id:Number(other.telegramId),type:'private'}}}})});assert.equal(webhook.status,200);assert.equal((await db.collection('team_membership_invitations').doc(webhookInvite.id).get()).data().status,'ACCEPTED');
  const race=(await send(globalAdmin,'invite-cancel-race-0001')).body.data;const raceResults=await Promise.all([call(`/membership/invitations/${race.id}/cancel`,{}),call(`/membership/invitations/${race.id}/respond`,{accept:true},globalAdmin)]);assert.deepEqual(raceResults.map(r=>r.status).sort(),[200,409]);const raceStatus=(await db.collection('team_membership_invitations').doc(race.id).get()).data().status;assert.equal((await call('/membership/teams/'+team.id)).body.data.team.members.some((m:any)=>m.userId===globalAdmin.id),raceStatus==='ACCEPTED');
  for(const tg of ['870006','870007']){const user=makeUser(tg,'concurrent'+tg);await db.collection('users').doc(user.id).set(user);}const newUsers=['870006','870007'].map(tg=>makeUser(tg,'concurrent'+tg));const parallelInvites=await Promise.all(newUsers.map((user,i)=>send(user,'parallel-invite-000'+i)));const parallelJoins=await Promise.all(newUsers.map((user,i)=>call(`/membership/invitations/${parallelInvites[i].body.data.id}/respond`,{accept:true},user)));assert.ok(parallelJoins.every(r=>r.status===200));const mergedRoster=(await call('/membership/teams/'+team.id)).body.data.team.members;assert.ok(newUsers.every(user=>mergedRoster.some((m:any)=>m.userId===user.id)),'Concurrent joins from different people never overwrite each other');
  // Account suspension and team administration revocation defeat stale signed sessions.
  await db.collection('users').doc(creator.id).update({isSuspended:true});assert.equal((await call('/membership/teams/'+team.id)).status,403);await db.collection('users').doc(creator.id).update({isSuspended:false});
  team=(await call('/membership/teams/'+team.id)).body.data.team;assert.equal((await call(`/membership/teams/${team.id}/update`,{adminUserId:other.id,version:team.version})).status,403);assert.equal((await call(`/membership/teams/${team.id}/update`,{adminUserId:other.id,version:team.version},owner)).status,200);assert.equal((await call('/membership/teams/'+team.id)).status,403);const transferred=(await call('/membership/teams/'+team.id,undefined,other)).body.data.team;assert.equal((await call(`/membership/teams/${team.id}/update`,{adminUserId:creator.id,version:transferred.version},owner)).status,200);
  // Link a legacy slot while preserving its member ID and historical snapshot.
  const legacyId='tp_membershiplegacy',legacyMember='tp_membershipslot';await db.collection('team_league_preview_teams').doc(legacyId).set({id:legacyId,ownerId:owner.id,name:'Legacy team',logo:'',members:[{id:legacyMember,name:'Old manual name'}],captainMemberId:legacyMember,version:1,updatedAt:''});
  assert.equal((await call(`/membership/teams/${legacyId}/invitations`,{targetUserId:other.id,requestId:'already-member-invite'},owner)).status,409);
  team=(await call('/membership/teams/'+team.id)).body.data.team;
  assert.equal((await call(`/membership/teams/${team.id}/update`,{version:team.version,removeMemberId:team.members.find(m=>m.userId===other.id)!.id})).status,200,'Removing a member permits transfer');
  // Different team documents must still serialize membership for the same account.
  const raceUser=makeUser('870008','singleteamrace'),createRaceUser=makeUser('870009','singlecreaterace');
  for(const user of [raceUser,createRaceUser])await db.collection('users').doc(user.id).set(user);
  const alternateId='tp_singlealternate';await db.collection('team_league_preview_teams').doc(alternateId).set({id:alternateId,ownerId:owner.id,name:'Alternate',logo:'',members:[{id:'tp_alternateslot',name:'Manual captain'}],captainMemberId:'tp_alternateslot',version:1,updatedAt:''});
  const inviteTo=async(id:string,user:any,key:string)=>{const result=await call(`/membership/teams/${id}/invitations`,{targetUserId:user.id,requestId:key},owner);assert.equal(result.status,200,JSON.stringify(result));return result.body.data;};
  const exclusiveInvites=await Promise.all([inviteTo(legacyId,raceUser,'exclusive-legacy-invite'),inviteTo(alternateId,raceUser,'exclusive-alternate-invite')]);
  const exclusiveResults=await Promise.all(exclusiveInvites.map(inv=>call(`/membership/invitations/${inv.id}/respond`,{accept:true},raceUser)));
  assert.deepEqual(exclusiveResults.map(r=>r.status).sort(),[200,409],'Concurrent accepts into different teams allow only one');
  const winner=exclusiveInvites[exclusiveResults.findIndex(r=>r.status===200)],loser=exclusiveInvites[exclusiveResults.findIndex(r=>r.status===409)];
  assert.equal((await db.collection('team_membership_invitations').doc(loser.id).get()).data().status,'PENDING','Failed acceptance never changes the invitation');
  const winningTeam=(await call('/membership/teams/'+winner.teamId,undefined,owner)).body.data.team;
  assert.equal((await call(`/membership/teams/${winner.teamId}/update`,{version:winningTeam.version,removeMemberId:winningTeam.members.find((m:any)=>m.userId===raceUser.id).id},owner)).status,200);
  assert.equal((await call(`/membership/invitations/${loser.id}/respond`,{accept:true},raceUser)).status,200,'Transfer succeeds after removal despite old concurrency guard');
  await ticket(createRaceUser,1,'single-create-race-ticket');const createRaceInvite=await inviteTo(alternateId,createRaceUser,'single-create-race-invite');
  const createRace=await Promise.all([call('/membership/teams',{name:'Race creation',requestId:'single-create-race-key'},createRaceUser),call(`/membership/invitations/${createRaceInvite.id}/respond`,{accept:true},createRaceUser)]);
  assert.deepEqual(createRace.map(r=>r.status).sort(),[200,409],'Creating and joining concurrently cannot yield two teams');
  assert.equal((await call('/membership',undefined,createRaceUser)).body.data.tickets.balance,createRace[0].status===200?0:1,'Blocked creation never consumes a ticket');
  const linked=(await call(`/membership/teams/${legacyId}/invitations`,{targetUserId:other.id,legacyMemberId:legacyMember,requestId:'legacy-link-0001'},owner)).body.data;assert.equal((await call(`/membership/invitations/${linked.id}/respond`,{accept:true},other)).status,200);const legacy=(await db.collection('team_league_preview_teams').doc(legacyId).get()).data() as PreviewTeam;assert.equal(legacy.members[0].id,legacyMember);assert.equal(legacy.members[0].userId,other.id);
  // New leagues require confirmed accounts. Manual rows are never silently verified.
  const manualId='tp_unconfirmedteam';await db.collection('team_league_preview_teams').doc(manualId).set({...legacy,id:manualId,members:[{id:legacyMember,name:'Unconfirmed'}]});
  let league=(await call('/leagues',{id:'tp_membershipleague',name:'Membership league',teamIds:[team.id,manualId],starterCount:1,rounds:1,version:0},owner)).body.data as TeamLeague;
  assert.equal((await call(`/leagues/${league.id}/actions`,{action:'START',version:league.version},owner)).status,409);
  const savedLeague=await call('/leagues',{...league,teamIds:[team.id,legacyId]},owner);assert.equal(savedLeague.status,200);league=savedLeague.body.data;
  const duplicateId='tp_duplicateexisting';await db.collection('team_league_preview_teams').doc(duplicateId).set({...team,id:duplicateId,memberUserIds:[]});
  assert.equal((await call(`/leagues/${league.id}/actions`,{action:'START',version:league.version},owner)).body.code,'TEAM_MEMBER_ALREADY_ASSIGNED','Existing duplicate rosters cannot start a new tournament even with stale membership indexes');
  await db.collection('team_league_preview_teams').doc(duplicateId).delete();
  const started=await call(`/leagues/${league.id}/actions`,{action:'START',version:league.version},owner);assert.equal(started.status,200,JSON.stringify(started));league=started.body.data;
  const snapshot=structuredClone(league.teams),fixture=league.fixtures[0],creatorSide=fixture.homeTeamId===team.id?'home':'away',creatorMember=team.members.find(m=>m.userId===creator.id)!;
  group.set(creator.telegramId,'left');assert.equal((await call(`/leagues/${league.id}/actions`,{action:'LINEUP',version:league.version,fixtureId:fixture.id,side:creatorSide,lineup:{starters:[creatorMember.id],reserves:[]}},owner)).status,403);
  group.set(creator.telegramId,'member');assert.equal((await call(`/membership/teams/${team.id}/update`,{version:team.version,name:'Must not change active roster'})).status,409);
  const canceledLeague=await call(`/leagues/${league.id}/actions`,{action:'CANCEL',version:league.version},owner);assert.equal(canceledLeague.status,200);
  team=(await call('/membership/teams/'+team.id)).body.data.team;assert.equal((await call(`/membership/teams/${team.id}/update`,{version:team.version,name:'After tournament'})).status,200);assert.deepEqual((await db.collection('team_league_preview_leagues').doc(league.id).get()).data().teams,snapshot,'Current roster/profile edits never rewrite historical snapshots');
  // Real TEAMS backend now accepts a 64-team league; schedule sizes and BYEs match.
  const ids:string[]=[];for(let i=0;i<TEAM_LEAGUE_MAX_TEAMS;i++){const user=makeUser(String(880000+i),'leagueplayer'+i);await db.collection('users').doc(user.id).set(user);const id='tp_largeleague_'+String(i).padStart(3,'0'),mid='tp_largemember_'+String(i).padStart(3,'0');ids.push(id);await db.collection('team_league_preview_teams').doc(id).set({id,ownerId:owner.id,name:'Team '+i,logo:'',members:[{id:mid,name:user.firstName,userId:user.id,verified:true}],captainMemberId:mid,version:1,updatedAt:''});}
  const big=await call('/leagues',{id:'tp_largemembership',name:'64 team league',teamIds:ids,starterCount:1,rounds:1,version:0},owner);assert.equal(big.status,200,JSON.stringify(big));const bigStart=await call('/leagues/'+big.body.data.id+'/actions',{action:'START',version:big.body.data.version},owner);assert.equal(bigStart.status,200,JSON.stringify(bigStart));assert.ok(bigStart.body.data.fixturePage,'Large results are paged below hosting payload limits');assert.ok(bigStart.body.data.fixtures.length<=160);clearTeamTransportSnapshots();const largeLeague=await hydrateTeamTransport<TeamLeague>(bigStart.body.data,async path=>{const page=await call(path,undefined,owner);assert.equal(page.status,200,JSON.stringify(page));return page.body.data;});assert.equal(largeLeague.fixtures.length,2016);assert.equal(largeLeague.totalRounds,63);
  const profileWire=await call('/teams/'+ids[0],undefined,owner);const largeProfile=await hydrateTeamTransport<any>(profileWire.body.data,async path=>{if(path.startsWith('/leagues/')&&path.includes('fixtureOffset=0'))clearTeamTransportSnapshots();const page=await call(path,undefined,owner);assert.equal(page.status,200,JSON.stringify(page));return page.body.data;});assert.equal(largeProfile.leagues[0].fixtures.length,2016);assert.deepEqual(largeProfile.leagues[0].teams[ids[1]].members,[],'Cold-cache profile pagination retains minimized opponent metadata');
  const publicProfileWire=await call('/published/teams/'+ids[0],undefined,creator);assert.equal(publicProfileWire.body.data.canManageTeam,false);const publicProfile=await hydrateTeamTransport<any>(publicProfileWire.body.data,async path=>{if(path.startsWith('/published/leagues/')&&path.includes('fixtureOffset=0'))clearTeamTransportSnapshots();const page=await call(path,undefined,creator);assert.equal(page.status,200,JSON.stringify(page));return page.body.data;});assert.equal(publicProfile.leagues[0].fixtures.length,2016);
  const directory=await call('',undefined,owner);assert.ok(directory.body.data.teamPage);clearTeamTransportSnapshots();const allTeams=await hydrateTeamTransport<{teams:PreviewTeam[]}>(directory.body.data,async path=>{const page=await call(path,undefined,owner);assert.equal(page.status,200,JSON.stringify(page));return page.body.data;});assert.ok(allTeams.teams.length>=64);
  const stale=await call('/leagues/'+largeLeague.id,undefined,owner),nextPage=stale.body.data.fixturePage.next;await call('/leagues/'+largeLeague.id+'/actions',{action:'CANCEL',version:largeLeague.version},owner);assert.equal((await call(nextPage,undefined,owner)).status,409,'Pagination cannot mix versions after a mutation');
  for(const n of [17,32,33,64])for(const rounds of [1,2] as const){const schedule=makeTeamSchedule('tp_largecheck',ids.slice(0,n),rounds);assert.equal(schedule.length,n*(n-1)/2*rounds);for(const round of new Set(schedule.map(f=>f.round))){const row=schedule.filter(f=>f.round===round),teams=row.flatMap(f=>[f.homeTeamId,f.awayTeamId]);assert.equal(new Set(teams).size,teams.length);assert.equal(row.length,Math.floor(n/2));}}
  // Native AI plans bind a verified user and share the exact HTTP owner checks.
  const deps={read:async()=>({data:[]}),users:async()=>[creator,other,member,member2]};
  assert.equal(detectNaturalAdminAction('@teamcreatorga emas, @teamcreator team ochish uchun 1 ticket ber'),'team_ticket_grant');
  for(const [text,action] of [['@teamcreator team ochish uchun 1 ticket ber','team_ticket_grant'],['@teamcreator team ticketini tekshir','team_ticket_check'],['@teamcreator dan 1 team ticketini qaytarib ol','team_ticket_revoke']]){const plan=await planNaturalAdminRequest(text,deps);assert.equal(plan?.action,action);assertAdminPlanReady(plan!);}
  await assert.rejects(planNaturalAdminRequest('@teamcreator team uchun -1 ticket ber',deps),/CLARIFY/);
  const grantPlan=await planNaturalAdminRequest('@teamcreator team ochish uchun 1 ticket ber',deps);const aiBefore=(await call('/membership')).body.data.tickets.balance;
  const result=await executeAiAdminRoute(grantPlan!,Number(owner.telegramId),'team-ai-grant-0001');assert.equal(result.status,200,JSON.stringify(result));await executeAiAdminRoute(grantPlan!,Number(owner.telegramId),'team-ai-grant-0001');assert.equal((await call('/membership')).body.data.tickets.balance,aiBefore+1);
  await assert.rejects(executeAiAdminRoute(grantPlan!,7573478198,'team-ai-forbidden-0001'),/asosiy admin|OWNER_ONLY/);
  console.log('PASS native PostgreSQL TEAMS membership: atomic tickets/team creation, group fail-closed/recheck, cancelled/expired/foreign invitations, concurrent joins, exclusive cross-team membership/create races and transfers, exact roster linking, Telegram callbacks, owner/team-admin revocation, immutable snapshots, real 64-team leagues and AI ticket commands');
 }finally{
  await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));globalThis.fetch=fetchBefore;clearTelegramMembershipCache();
  if(envBefore.token===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=envBefore.token;if(envBefore.secret===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=envBefore.secret;
  await db.collection('users').doc(owner.id).delete();for(const row of savedOwners)await db.collection('users').doc(row.id).set(row.data);
 }
}
