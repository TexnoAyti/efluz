import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {teamLeaguePreviewRouter} from '../routes/teamLeaguePreview.routes';
import {clearTelegramMembershipCache} from '../services/telegramBotService';
import {CLASICO_COLLECTION} from '../services/elClasicoService';
export async function verifyElClasico(failNextCommit:()=>void){
 const db=getFirestoreDb(),ref=db.collection(CLASICO_COLLECTION).doc('el-clasico'),prior=(await ref.get()).data();await ref.delete();
 const users=Array.from({length:25},(_,i)=>({id:'user-clasico-'+i,telegramId:String(881000+i),username:'clasico'+i,firstName:'Player '+i,isAdmin:i===23,isSuspended:false,createdAt:'',updatedAt:''}));
 const owner={...users[24],isAdmin:true,telegramId:'5209126900'};for(const u of users)await db.collection('users').doc(u.id).set(u);await db.collection('users').doc(owner.id).set(owner);
 const savedToken=process.env.TELEGRAM_BOT_TOKEN,before=globalThis.fetch,group=new Map<string,string>();process.env.TELEGRAM_BOT_TOKEN='isolated-claim-test';
 globalThis.fetch=(async(input:any,init:any)=>{const url=new URL(String(input));if(url.origin==='https://api.telegram.org'&&url.pathname.endsWith('/getChatMember')){const status=group.get(url.searchParams.get('user_id')||'')||'member';return status==='unavailable'?Response.json({ok:false,description:'isolated unavailable'}):Response.json({ok:true,result:{status}});}return before(input,init);}) as typeof fetch;
 const app=express();app.use(express.json());app.use(authMiddleware);app.use('/api/team-leagues-preview',teamLeaguePreviewRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const host=`http://127.0.0.1:${(server.address() as any).port}/api/team-leagues-preview/events/el-clasico`;
 const call=async(actor:any=users[0],body?:any,suffix='')=>{const r=await fetch(host+suffix,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(actor?{authorization:'Bearer '+createSessionToken(actor)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json() as any};};
 try{
  assert.equal((await call(null)).status,401);assert.equal((await call()).body.data.event.version,0);assert.equal((await call()).body.data.canManage,false);
  group.set(users[0].telegramId,'left');
  for(const suffix of ['/subscription','/actions']){const r=await call(users[0],suffix==='/actions'?{action:'JOIN',side:'REAL',userId:users[1].id}:{},suffix);assert.equal(r.status,403);assert.equal(r.body.code,'TEAM_GROUP_REQUIRED');}
  group.set(users[0].telegramId,'unavailable');assert.equal((await call(users[0],{},'/subscription')).status,503);
  group.set(users[0].telegramId,'member');assert.equal((await call(users[0],{},'/subscription')).status,200);
  group.set(users[0].telegramId,'left');assert.equal((await call(users[0],{action:'JOIN',side:'REAL'},'/actions')).status,403,'A prior eligibility check cannot bypass a fresh subscription check');group.set(users[0].telegramId,'member');
  const act=(u:any,body:any)=>call(u,body,'/actions');
  assert.equal((await act(users[0],{action:'START',version:0})).status,403);assert.equal((await act(users[23],{action:'SCORE',version:0})).status,403,'A global admin token cannot replace the fresh owner identity');
  assert.equal((await act(users[0],{action:'JOIN',side:'OTHER'})).status,400);
  assert.equal((await act(users[0],{action:'JOIN',side:'REAL',userId:users[1].id})).status,200);let event=(await call()).body.data.event;assert.equal(event.players[0].userId,users[0].id);
  const v=event.version;assert.equal((await act(users[0],{action:'JOIN',side:'REAL'})).body.data.event.version,v,'Same-side retry is idempotent');
  await act(users[0],{action:'JOIN',side:'BARCA'});event=(await call()).body.data.event;assert.equal(event.players.length,1);assert.equal(event.players[0].side,'BARCA');
  await act(users[0],{action:'LEAVE'});assert.equal((await call()).body.data.event.players.length,0);
  for(const u of users.slice(0,10))assert.equal((await act(u,{action:'JOIN',side:'REAL'})).status,200);
  const race=await Promise.all(users.slice(10,12).map(u=>act(u,{action:'JOIN',side:'REAL'})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409],'The final side slot cannot be overbooked');
  event=(await call()).body.data.event;assert.equal(event.players.length,11);
  const remaining=users.slice(0,23).filter(u=>!event.players.some((p:any)=>p.userId===u.id));
  for(const u of remaining.slice(0,11))assert.equal((await act(u,{action:'JOIN',side:'BARCA'})).status,200);
  event=(await call()).body.data.event;assert.equal(event.players.length,22);assert.equal(new Set(event.players.map((p:any)=>p.userId)).size,22);
  assert.equal((await act(remaining[0],{action:'JOIN',side:'REAL'})).status,409);assert.equal((await call()).body.data.event.players.length,22,'Failed switch preserves existing slot');
  assert.equal((await act(owner,{action:'START',version:event.version-1})).status,409);
  group.set(event.players[0].userId===users[0].id?users[0].telegramId:users.find(u=>u.id===event.players[0].userId)!.telegramId,'left');assert.equal((await act(owner,{action:'START',version:event.version})).status,403);group.clear();
  failNextCommit();assert.equal((await act(owner,{action:'START',version:event.version})).status,500);assert.equal((await call()).body.data.event.status,'REGISTRATION','Failed commit leaves no partial pairs');
  const started=await act(owner,{action:'START',version:event.version});assert.equal(started.status,200,JSON.stringify(started.body));event=started.body.data.event;assert.equal(event.bouts.length,11);assert.equal(new Set(event.bouts.flatMap((b:any)=>[b.homeUserId,b.awayUserId])).size,22);
  assert.equal((await act(users[0],{action:'LEAVE'})).status,409);assert.equal((await act(users[23],{action:'JOIN',side:'REAL'})).status,409);
  assert.equal((await act(users[0],{action:'SCORE',version:event.version,boutId:1,homeScore:9,awayScore:0})).status,403);
  assert.equal((await act(owner,{action:'SCORE',version:event.version,boutId:1,homeScore:'2',awayScore:0})).status,400);
  for(const b of event.bouts){const r=await act(owner,{action:'SCORE',version:event.version,boutId:b.id,homeScore:2,awayScore:1});assert.equal(r.status,200);event=r.body.data.event;}
  assert.equal(event.status,'COMPLETED');assert.equal((await act(owner,{action:'CANCEL',version:event.version})).status,409);
  assert.equal((await act(owner,{action:'SCORE',version:event.version-1,boutId:1,homeScore:1,awayScore:2})).status,409);
  assert.equal((await call()).body.data.event.bouts[0].homeScore,2);
  console.log('PASS El-Clasico HTTP/native PostgreSQL: fail-closed fresh subscription, authenticated self-selection, concurrent slot cap, atomic switching, owner ACL, roster locking, 11 unique pairs, rollback and completion');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));globalThis.fetch=before;if(savedToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=savedToken;clearTelegramMembershipCache();await ref.delete();if(prior)await ref.set(prior);for(const u of users)await db.collection('users').doc(u.id).delete();}
}
