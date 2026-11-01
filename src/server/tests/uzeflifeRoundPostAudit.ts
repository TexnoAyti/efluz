import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState} from '../services/uzeflifeService';
import {getRoundPostStatus,requestRoundPost,reconcileRoundPost,processRoundPost,sendUzeflifeRoundPages} from '../services/uzeflifeRoundPost';
import {renderUzeflifeRoundPages} from '../services/uzeflifeRoundImages';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {uzeflifeRouter} from '../routes/uzeflife.routes';
import type {UState,UMatch} from '../../types/uzeflife';

export async function verifyUzeflifeRoundPosts(){
 const db=getFirestoreDb(),refs=[db.collection('uzeflife').doc('championship'),...[1,2,3].map(r=>db.collection('uzeflife_channel_posts').doc('round-'+r))];
 const before=await Promise.all(refs.map(r=>r.get())),originalFetch=globalThis.fetch,oldToken=process.env.TELEGRAM_BOT_TOKEN,oldSecret=process.env.SESSION_SECRET,oldNodeEnv=process.env.NODE_ENV;
 process.env.NODE_ENV='test';
 process.env.TELEGRAM_BOT_TOKEN='777:isolated-round-post';process.env.SESSION_SECRET='isolated-round-post-session-secret-32bytes';
 const users=[0,1].map(i=>({id:'round-post-user-'+i,telegramId:i?'9890001':'5209126900',username:'round_post_'+i,firstName:'Post '+i,isAdmin:!!i,isSuspended:false,createdAt:'',updatedAt:''}));
 for(const u of users)await db.collection('users').doc(u.id).set(u);
 const state:UState={...initialUState(),format:'LEAGUE',status:'playing',round:3,revision:778,participants:Array.from({length:242},(_,i)=>({id:'post-player-'+i,name:'@post_player_'+i,status:'approved'})),matches:[]};
 for(const [round,count] of [[1,121],[2,9],[3,1]])for(let i=0;i<count;i++)state.matches.push({id:`l${round}m${i}`,round,bracket:0,home:'post-player-'+(i*2),away:'post-player-'+(i*2+1),winner:null,homeScore:null,awayScore:null,penaltyHome:null,penaltyAway:null,proposal:null,scheduledAt:null} satisfies UMatch);
 const fakeRender=async(s:UState,r:number)=>{const games=s.matches.filter(m=>m.round===r);return Array.from({length:Math.ceil(games.length/8)},(_,i)=>({buffer:Buffer.from('isolated PNG'),first:i*8+1,count:Math.min(8,games.length-i*8)}));};
 let attempts=0;
 const send=async(pages:Awaited<ReturnType<typeof fakeRender>>)=>{attempts++;return pages.map(p=>10000+p.first);};
 const app=express();app.use(express.json());app.use(authMiddleware);app.use('/api/uzeflife',uzeflifeRouter);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}/api/uzeflife/`;
 const call=async(path:string,body?:any,user:any=users[0])=>{const r=await originalFetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+createSessionToken(user)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json() as any};};
 try{
  await refs[0].set(state);for(const ref of refs.slice(1))await ref.delete();
  assert.equal((await call('publish-status?round=1',undefined,null)).status,401);
  assert.equal((await call('publish-round',{round:1,expectedRevision:778},users[1])).status,403,'Global admin is not the primary owner');
  assert.equal((await call('publish-round',{round:1,expectedRevision:777})).status,409);
  assert.equal((await call('publish-round',{round:4,expectedRevision:778})).status,409);
  const queued=await call('publish-round',{round:1,expectedRevision:778});assert.equal(queued.status,202);assert.equal(queued.data.totalPages,16);assert.equal(attempts,0,'HTTP enqueue never waits for Telegram');
  await Promise.all([requestRoundPost(state,1,users[0].id),requestRoundPost(state,1,users[0].id)]);
  await Promise.all([processRoundPost(1,{render:fakeRender,send}),processRoundPost(1,{render:fakeRender,send})]);
  assert.equal(attempts,1,'Two workers lease a single album once');
  let view=await getRoundPostStatus(state,1);assert.equal(view.sentPages,10);assert.equal(view.state,'pending');
  await processRoundPost(1,{render:fakeRender,send:async()=>{throw Error('isolated connection lost after Telegram may accept');}});
  view=await getRoundPostStatus(state,1);assert.equal(view.state,'unverified');assert.equal(view.sentPages,10);
  await assert.rejects(requestRoundPost(state,1,users[0].id),/tekshirib/);
  await assert.rejects(reconcileRoundPost(state,1,users[0].id,'stale',10),/yangilangan/);
  await assert.rejects(reconcileRoundPost(state,1,users[0].id,view.checkpoint!,11),/to‘liq/);
  assert.equal((await call('publish-reconcile',{round:1,checkpoint:view.checkpoint,confirmedPages:10,checkedChannel:true},users[1])).status,403);
  assert.equal((await call('publish-reconcile',{round:1,checkpoint:view.checkpoint,confirmedPages:10})).status,400);
  assert.equal((await call('publish-reconcile',{round:1,checkpoint:view.checkpoint,confirmedPages:10,checkedChannel:true})).status,200);
  let remaining=0;await processRoundPost(1,{render:fakeRender,send:async pages=>{remaining=pages.length;return send(pages);}});assert.equal(remaining,6);
  view=await getRoundPostStatus(state,1);assert.equal(view.state,'sent');assert.equal(view.sentPages,16);
  assert.equal((await call('publish-round',{round:1,expectedRevision:778})).data.alreadySent,true);
  await processRoundPost(1,{render:fakeRender,send});assert.equal(attempts,2,'A successful round is never reposted');
  // Definite Telegram rejection is retryable, while every photo shares its round caption.
  let reject=true;const methods:string[]=[],captions:string[]=[];
  globalThis.fetch=async(input:any,init?:any)=>{
   if(!String(input).startsWith('https://api.telegram.org/'))return originalFetch(input,init);
   const form=init.body as FormData;assert.equal(form.get('chat_id'),'@uzeflife_turner');
   if(reject)return Response.json({ok:false,error_code:429,description:'isolated limit'},{status:429});
   methods.push(String(input).split('/').at(-1)!);
   const media=form.get('media')?JSON.parse(String(form.get('media'))):[{caption:form.get('caption')}];captions.push(...media.map((m:any)=>m.caption));
   return Response.json({ok:true,result:media.length===1?{message_id:22000}:media.map((_:any,i:number)=>({message_id:22000+i}))});
  };
  await requestRoundPost(state,2,users[0].id);await processRoundPost(2,{render:fakeRender,send:sendUzeflifeRoundPages});
  assert.equal((await getRoundPostStatus(state,2)).state,'failed');
  reject=false;await requestRoundPost(state,2,users[0].id);await processRoundPost(2,{render:fakeRender,send:sendUzeflifeRoundPages});
  assert.equal((await getRoundPostStatus(state,2)).state,'sent');assert.equal(captions.length,2);assert.equal(captions[0],captions[1]);assert.ok(captions[0].includes('2 tur'));
  await requestRoundPost(state,3,users[0].id);await processRoundPost(3,{render:fakeRender,send:sendUzeflifeRoundPages});assert.equal(methods.at(-1),'sendPhoto');assert.equal((await getRoundPostStatus(state,3)).state,'sent');
  // Telegram accepted the photo, but the database checkpoint failed afterwards.
  await refs[3].delete();await requestRoundPost(state,3,users[0].id);
  const runTransaction=db.runTransaction;let loseCheckpoint=false;
  db.runTransaction=(async function(callback:any,...options:any[]){if(loseCheckpoint){loseCheckpoint=false;throw Error('ISOLATED_ACK_CHECKPOINT_FAILURE');}return (runTransaction as any).call(db,callback,...options);}) as any;
  try{await assert.rejects(processRoundPost(3,{render:fakeRender,send:async pages=>{loseCheckpoint=true;return pages.map(()=>33000);}}),/ACK_CHECKPOINT/);}
  finally{db.runTransaction=runTransaction;}
  assert.equal((await getRoundPostStatus(state,3)).state,'sending');
  await processRoundPost(3,{render:fakeRender,send:async()=>{throw Error('MUST_NOT_RESEND_ACKNOWLEDGED_PHOTO');}});
  await refs[3].update({leaseUntil:Date.now()-1});
  const expired=await getRoundPostStatus(state,3);assert.equal(expired.state,'unverified');
  await reconcileRoundPost(state,3,users[0].id,expired.checkpoint!,1);assert.equal((await getRoundPostStatus(state,3)).state,'sent');
  // Historical uncertain jobs can be repaired without discarding trusted progress.
  await refs[1].set({state:'unverified',round:1,sentPages:10,telegramMessageIds:Array.from({length:10},(_,i)=>i+1)});
  view=await getRoundPostStatus(state,1);assert.equal(view.legacy,true);
  await reconcileRoundPost(state,1,users[0].id,view.checkpoint!,16);assert.equal((await getRoundPostStatus(state,1)).state,'sent');
  const pngs=await renderUzeflifeRoundPages(state,1);assert.equal(pngs.length,16);assert.equal(pngs.reduce((n,p)=>n+p.count,0),121);assert.ok(pngs.every(p=>p.buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))));
  console.log('PASS UZEFLIFE channel posts: owner HTTP ACL, 121 games/16 PNGs, separate rounds, concurrent leases, partial resume, uncertain reconciliation, legacy repair, 429 retry, shared captions and single-photo delivery; no real Telegram messages');
 }finally{
  await new Promise<void>(r=>server.close(()=>r()));globalThis.fetch=originalFetch;
  for(let i=0;i<refs.length;i++){if(before[i].exists)await refs[i].set(before[i].data()!);else await refs[i].delete();}
  for(const u of users)await db.collection('users').doc(u.id).delete();
  if(oldToken===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=oldToken;
  if(oldSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=oldSecret;
  if(oldNodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldNodeEnv;
 }
}
