import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState} from '../services/uzeflifeService';
import {getRoundPostStatus,requestRoundPost,reconcileRoundPost,processRoundPost,sendUzeflifeRoundPages,repairLegacyFirstRoundImages} from '../services/uzeflifeRoundPost';
import {renderUzeflifeRoundPages} from '../services/uzeflifeRoundImages';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {uzeflifeRouter} from '../routes/uzeflife.routes';
import type {UState,UMatch} from '../../types/uzeflife';

export async function verifyUzeflifeRoundPosts(){
 const db=getFirestoreDb(),refs=[db.collection('uzeflife').doc('championship'),...[1,2,3].map(r=>db.collection('uzeflife_channel_posts').doc('round-'+r)),db.collection('uzeflife_channel_post_repairs').doc('first-round-20261101-font-fix')];
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
  const compactReceipt=(await refs[1].get()).data()!;
  assert.equal(typeof compactReceipt.snapshotJson,'string');assert.equal(compactReceipt.snapshot,undefined);
  // Existing nested-snapshot jobs remain readable and compact on the first claim.
  const {snapshotJson,...legacyV2}=compactReceipt;await refs[1].set({...legacyV2,snapshot:JSON.parse(snapshotJson)});
  const collection=db.collection;
  db.collection=((path:string)=>{assert.notEqual(path,'uzeflife','Status polling must not load the complete tournament');return collection.call(db,path);}) as any;
  try{const light=await call('publish-status?round=1');assert.equal(light.status,200);assert.equal(light.data.state,'pending');assert.equal(light.data.matchCount,121);assert.equal('snapshot' in light.data,false);}
  finally{db.collection=collection;}
  await Promise.all([requestRoundPost(state,1,users[0].id),requestRoundPost(state,1,users[0].id)]);
  await Promise.all([processRoundPost(1,{render:fakeRender,send}),processRoundPost(1,{render:fakeRender,send})]);
  assert.equal(attempts,1,'Two workers lease one separately captioned photo once');
  assert.equal(typeof (await refs[1].get()).data()?.snapshotJson,'string');assert.equal((await refs[1].get()).data()?.snapshot,undefined);
  let view=await getRoundPostStatus(state,1);assert.equal(view.sentPages,1);assert.equal(view.state,'pending');
  await processRoundPost(1,{render:fakeRender,send:async()=>{throw Error('isolated connection lost after Telegram may accept');}});
  view=await getRoundPostStatus(state,1);assert.equal(view.state,'unverified');assert.equal(view.sentPages,1);
  await assert.rejects(requestRoundPost(state,1,users[0].id),/tekshirib/);
  await assert.rejects(reconcileRoundPost(state,1,users[0].id,'stale',1),/yangilangan/);
  await assert.rejects(reconcileRoundPost(state,1,users[0].id,view.checkpoint!,3),/noto‘g‘ri/);
  assert.equal((await call('publish-reconcile',{round:1,checkpoint:view.checkpoint,confirmedPages:1,checkedChannel:true},users[1])).status,403);
  assert.equal((await call('publish-reconcile',{round:1,checkpoint:view.checkpoint,confirmedPages:1})).status,400);
  assert.equal((await call('publish-reconcile',{round:1,checkpoint:view.checkpoint,confirmedPages:1,checkedChannel:true})).status,200);
  for(let sent=1;sent<16;sent++){
   await processRoundPost(1,{render:fakeRender,send:async pages=>{assert.equal(pages.length,1);return send(pages);}});
   assert.equal((await getRoundPostStatus(state,1)).sentPages,sent+1);
  }
  view=await getRoundPostStatus(state,1);assert.equal(view.state,'sent');assert.equal(view.sentPages,16);
  assert.equal((await call('publish-round',{round:1,expectedRevision:778})).data.alreadySent,true);
  await processRoundPost(1,{render:fakeRender,send});assert.equal(attempts,16,'A successful round is never reposted');
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
  assert.equal((await getRoundPostStatus(state,2)).state,'pending');
  await processRoundPost(2,{render:fakeRender,send:sendUzeflifeRoundPages});
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
  const legacy={state:'sending',round:1,sentPages:16,totalPages:16,at:'2026-10-31T18:05:20.617Z',telegramMessageIds:Array.from({length:16},(_,i)=>86+i)};
  await refs[1].set(legacy);
  const repairs=await Promise.all([repairLegacyFirstRoundImages(),repairLegacyFirstRoundImages()]);
  assert.equal(repairs.filter(Boolean).length,1,'The owner-authorized legacy replacement resets once under concurrent workers');
  assert.deepEqual((await refs[4].get()).data()?.previous,legacy,'Preserve the original publication receipt');
  view=await getRoundPostStatus(state,1);assert.equal(view.sentPages,0);assert.equal(view.state,'pending');
  await processRoundPost(1,{render:fakeRender,send});
  assert.equal(await repairLegacyFirstRoundImages(),false,'Never reset progress after the replacement starts');
  assert.equal((await getRoundPostStatus(state,1)).sentPages,1);
  for(let i=1;i<16;i++)await processRoundPost(1,{render:fakeRender,send});
  assert.equal((await getRoundPostStatus(state,1)).state,'sent');
  assert.equal(await repairLegacyFirstRoundImages(),false,'A completed replacement never sends again');
  const pngs=await renderUzeflifeRoundPages(state,1);assert.equal(pngs.length,16);assert.equal(pngs.reduce((n,p)=>n+p.count,0),121);assert.ok(pngs.every(p=>p.buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))));
  assert.equal(GlobalFonts.has('Arial'),true,'Use bundled EFL fonts on servers without system fonts');
  assert.equal(new Set(pngs.map(p=>createHash('sha256').update(p.buffer).digest('hex'))).size,16,'Every page contains its own fixtures');
  for(const page of pngs){
   const img=await loadImage(page.buffer),canvas=createCanvas(img.width,img.height),ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
   assert.equal(img.width,1080);
   for(let row=0;row<page.count;row++){
    const pixels=ctx.getImageData(119,234+row*92,320,60).data;let bright=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180&&pixels[i+1]>180&&pixels[i+2]>180&&pixels[i+3]>0)bright++;
    assert.ok(bright>50,'Each fixture must have visible text, not a blank dark rectangle');
   }
  }
  let uploaded=0;const uploadedHashes=new Set<string>(),uploadedCaptions:string[]=[];
  globalThis.fetch=async(input:any,init?:any)=>{
   if(!String(input).startsWith('https://api.telegram.org/'))return originalFetch(input,init);
   assert.ok(String(input).endsWith('/sendPhoto'),'Every image is a separate Telegram message');
   const form=init.body as FormData;assert.equal(form.has('media'),false);
   const file=form.get('photo') as File;assert.ok(file);
   const bytes=Buffer.from(await file.arrayBuffer()),hash=createHash('sha256').update(bytes).digest('hex');
   assert.equal(uploadedHashes.has(hash),false,'Separate posts must not reuse one image');uploadedHashes.add(hash);
   assert.deepEqual(bytes,pngs[uploaded++].buffer);uploadedCaptions.push(String(form.get('caption')));
   return Response.json({ok:true,result:{message_id:44000+uploaded}});
  };
  for(const page of pngs)await sendUzeflifeRoundPages([page],1);
  assert.equal(uploaded,16);assert.equal(uploadedCaptions.length,16);assert.equal(new Set(uploadedCaptions).size,1);
  assert.ok(uploadedCaptions.every(text=>text.includes('1 tur')&&text.includes('https://t.me/efleagueuz/8989')));
  await assert.rejects(sendUzeflifeRoundPages(pngs.slice(0,2),1),/alohida/);
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
