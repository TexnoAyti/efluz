import {applyBanControl,setClubSelectionBan,prepareMissingOwnerBanControls,markBanControlsDelivered} from '../services/clubSelectionBan';
import {telegramRouter} from '../routes/telegram.routes';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { listMissingGroupClubOwners } from '../services/telegramClubMemberTags';
import { missingOwnersReadPlan,formatMissingGroupOwners,isMissingGroupOwnersRequest } from '../services/telegramAiMissingGroupOwners';
import { getConversationIntent } from '../services/telegramAiConversationCommands';
import { handleAiAdminCommand,setTestAiAdminHooks } from '../services/telegramAiAdminService';
import { executeAiAdminRoute } from '../services/telegramAiAdminGateway';
import { adminAiConfigRouter } from '../routes/adminAiConfig.routes';
import { setTestConfigOverride,DEFAULT_AI_CONFIG } from '../services/telegramAiConfigService';
import { setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { handleTelegramAiMessage,clearTestAiState,setTestAiResponder } from '../services/telegramAiService';
import { clearTestRateLimitState } from '../services/telegramAiRateLimitService';

await initDatabase();process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='production';process.env.VERCEL_ENV='production';process.env.TELEGRAM_BOT_TOKEN='777:missing-owner-test';process.env.TELEGRAM_GROUP_USERNAME='@efleagueuz';
const db=getFirestoreDb(),seasonId='season-2026-27',originalFetch=global.fetch;
await db.collection('seasons').doc(seasonId).set({id:seasonId,status:'active'});
const owner={id:'user-5209126900',telegramId:'5209126900',isAdmin:true,isSuspended:false,username:'primary_owner'};
const delegate={id:'user-7573478198',telegramId:'7573478198',isAdmin:true,isSuspended:false};
await db.collection('users').doc(owner.id).set(owner);await db.collection('users').doc(delegate.id).set(delegate);
const members=new Map<number,any>(),sent:any[]=[];let memberReads=0;
async function seed(id:number,clubId:string,status:string,extra:any={}) {
 await db.collection('users').doc('user-'+id).set({id:'user-'+id,telegramId:String(id),username:'player'+id,firstName:'Player '+id,...extra});
 await db.collection('club_occupancies').doc(`${seasonId}_${clubId}`).set({seasonId,clubId,userId:'user-'+id,status:'active'});
 members.set(id,{status,user:{id},...(status==='restricted'?{is_member:true}:{})});
}
await seed(101,'club-arsenal','left');await seed(101,'club-brentford','left');
await seed(102,'club-man-city','member');await seed(103,'club-real-madrid','kicked');await seed(104,'club-inter','restricted');members.get(104).is_member=false;
await seed(105,'club-milan','administrator');await seed(106,'club-chelsea','restricted');await seed(107,'club-liverpool','error');
await seed(110,'club-leeds','member',{telegramId:null});await seed(111,'club-nottm-forest','left',{username:null});
await seed(112,'club-tottenham','member');await seed(113,'club-everton','member');members.get(113).user.is_bot=true;
await db.collection('club_occupancies').doc('season-2025-26_club-bayern').set({seasonId:'season-2025-26',clubId:'club-bayern',userId:'user-999',status:'active'});
await db.collection('telegram_member_tags').doc('stale-former-owner').set({userId:'user-108',clubId:'club-tottenham',reason:'NOT_IN_GROUP'});
await db.collection('telegram_member_tags').doc('stale-rejoined').set({userId:'user-102',clubId:'club-man-city',reason:'NOT_IN_GROUP'});
global.fetch=async(input:any,init?:any)=>{
 const url=String(input);if(url.startsWith('http://127.0.0.1:'))return originalFetch(input,init);
 assert.match(url,/^https:\/\/api.telegram.org\/bot777:/);
 const method=url.split('/').at(-1),body=JSON.parse(init.body);
 if(method==='answerCallbackQuery')return Response.json({ok:true,result:true});
 if(method==='sendMessage'){assert.equal(body.chat_id,5209126900,'Private roster is sent only to the requesting owner');sent.push(body);return Response.json({ok:true,result:{message_id:8000+sent.length}});}
 assert.equal(method,'getChatMember','Listing never writes a tag, promotes, removes or messages another member');assert.equal(body.chat_id,'@efleagueuz');memberReads++;
 if(body.user_id===777)return Response.json({ok:true,result:{status:'administrator'}});
 assert.ok(members.has(body.user_id),'Only current active-season owners are queried');
 if(members.get(body.user_id).status==='error')return Response.json({ok:false,error_code:400},{status:400});
 return Response.json({ok:true,result:members.get(body.user_id)});
};
setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true,allowedChatId:-1001,allowedThreadId:3503,rateLimitUserPerMin:20});setTestGroundingOverride({competitions:[],clubs:[],fixtures:{},standings:{}});setTestAiAdminHooks();setTestAiResponder(async()=>{throw Error('NO_MODEL_FOR_NATIVE_READ');});
try {
 for(const text of ['Guruhda yo‘q klub egalarini ko‘rsat','Guruhda yoq odamlarni chiqarib ber','Guruhga kirmagan o‘yinchilar kimlar?','Guruhda yoqlarni ko‘rsat']){assert.equal(getConversationIntent(text),'admin',text);assert.equal(missingOwnersReadPlan(text)?.action,'group_missing_owners');}
 for(const text of ['Guruhdan odamlarni chiqar','Guruhda yoq odamlarni klubidan chiqar','Guruhda yoq odamlarni ko‘rsatma','Agar guruhda yoq odamlarni chiqarsam nima bo‘ladi?'])assert.equal(isMissingGroupOwnersRequest(text),false,text);
 assert.equal(missingOwnersReadPlan('Guruhda yoq klub egalari 2-sahifa')?.body.page,2);
 const partial=await listMissingGroupClubOwners();assert.equal(partial.totalOwners,11);assert.equal(partial.totalMissing,4);assert.equal(partial.complete,false);assert.equal(partial.unverifiedOwners,3);
 assert.deepEqual(new Set(partial.owners.map(o=>o.telegramId)),new Set([101,103,104,111]));
 assert.equal(partial.owners.find(o=>o.telegramId===101)?.clubNames.length,2);assert.ok(!partial.owners.some(o=>[102,105,106,108].includes(o.telegramId)),'Rejoined, admin, restricted member and transferred old owner never appear');
 assert.match(formatMissingGroupOwners(partial),/to‘liq emas/);assert.match(formatMissingGroupOwners(partial),/holati tasdiqlanmadi/);
 members.get(107).status='member';members.get(113).user.is_bot=false;await db.collection('users').doc('user-110').update({telegramId:'110'});
 const fresh=await listMissingGroupClubOwners({page:1,limit:2});assert.equal(fresh.complete,true);assert.equal(fresh.owners.length,2);assert.equal(fresh.nextPage,2);
 assert.equal((await listMissingGroupClubOwners({page:2,limit:2})).owners.length,2);
 await assert.rejects(listMissingGroupClubOwners({chat_id:'@othergroup'}));
 members.get(101).status='member';assert.equal((await listMissingGroupClubOwners()).totalMissing,3,'A newly rejoined owner disappears immediately without waiting for tag reconciliation');members.get(101).status='left';
 const plan={action:'group_missing_owners',body:{page:1,limit:20}};
 const actual=await executeAiAdminRoute(plan,5209126900,'isolated-missing-read');assert.equal(actual.status,200);assert.equal(actual.data.totalMissing,4);
 await assert.rejects(executeAiAdminRoute(plan,7573478198,'isolated-delegate'),/asosiy admin/);
 let update=730000;const p=(text:string,extra:any={})=>({chatId:5209126900,threadId:0,fromUser:{id:5209126900},text,updateId:++update,messageId:update,...extra});const signal=new AbortController().signal;
 const reply=await handleAiAdminCommand(p('Guruhda yoq klub egalarini korsat'),signal);assert.match(reply,/Arsenal/);assert.match(reply,/@player101/);assert.match(reply,/Guruhda yo‘q: 4/);assert.ok(!reply.includes('/ai_confirm'));
 const beforeGroup=memberReads;const groupReply=await handleAiAdminCommand(p('Guruhda yoq odamlarni korsat',{chatId:-1001,threadId:3503}),signal);assert.ok(!groupReply.includes('@player101'));assert.equal(memberReads,beforeGroup,'Group does not execute the private roster query');
 clearTestAiState();clearTestRateLimitState();assert.equal((await handleTelegramAiMessage(p('Guruhda yoq odamlarni chiqarib ber'))).replySent,true);assert.match(sent.at(-1).text,/@player101/);assert.equal(sent.at(-1).reply_markup.inline_keyboard.length,4,'Each missing owner gets an account-bound action button');
 const buttons=sent.at(-1).reply_markup.inline_keyboard.flat();assert.ok(buttons.every((b:any)=>Buffer.byteLength(b.callback_data)<=64));assert.equal((await db.collection('club_selection_bans').get()).size,0,'Listing never applies bans');
 const selected=buttons[0],control=(await db.collection('club_selection_ban_controls').doc(selected.callback_data.split(':')[1]).get()).data();
 const callback={id:'ban-callback',data:selected.callback_data,from:{id:5209126900},message:{message_id:8000+sent.length,chat:{id:5209126900,type:'private'}}};
 await assert.rejects(applyBanControl({...callback,from:{id:7573478198}}),(e:any)=>e.statusCode===403);
 await assert.rejects(applyBanControl({...callback,message:{...callback.message,chat:{id:-1001,type:'supergroup'}}}));
 await assert.rejects(applyBanControl({...callback,message:{...callback.message,message_id:9999}}));
 const clicked=await applyBanControl(callback);assert.equal(clicked.isBanned,true);assert.equal(clicked.targetId,control.targetId);assert.ok(clicked.releasedClubs.length>=1,'The button releases current clubs in the same ban transaction');assert.equal((await db.collection('club_selection_bans').get()).size,1,'Only the chosen account is banned');
 assert.equal((await applyBanControl(callback)).replayed,true);
 const newOutput=await prepareMissingOwnerBanControls(p('list'),fresh);assert.ok(newOutput);await assert.rejects(applyBanControl({...callback,data:'clubban:'+newOutput!.tokens[0]}),'Undelivered controls cannot mutate');
 await setClubSelectionBan(owner.id,control.targetId,{isBanned:false,requestId:'remove-list-ban-0001'});assert.equal((await applyBanControl(callback)).replayed,true);assert.equal((await db.collection('club_selection_bans').doc(control.targetId).get()).data().isBanned,false,'Old consumed button cannot reban after unban');
 await markBanControlsDelivered(newOutput!.tokens,8888);await assert.rejects(applyBanControl({...callback,data:'clubban:'+newOutput!.tokens[0],message:{...callback.message,message_id:8888}}),'Stale controls cannot overwrite changed ban state');
 const app=express();app.use((req,_res,next)=>{if(req.headers['x-test-actor']==='owner')req.user=owner as any;else if(req.headers['x-test-actor']==='delegate')req.user=delegate as any;next();});app.use(express.json());app.use('/api/admin/telegram-ai',adminAiConfigRouter);app.use('/api/telegram',telegramRouter);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 try{const url=`http://127.0.0.1:${(server.address() as any).port}/api/admin/telegram-ai/club-member-tags/missing-owners`;const prior=memberReads;
  assert.equal((await originalFetch(url)).status,401);assert.equal((await originalFetch(url,{headers:{'x-test-actor':'delegate'}})).status,403);assert.equal(memberReads,prior);
  process.env.TELEGRAM_WEBHOOK_SECRET='isolated-ban-webhook';
  const freshControls=await prepareMissingOwnerBanControls(p('list'),partial);assert.ok(freshControls);await markBanControlsDelivered(freshControls!.tokens,9000);
  const expiring=freshControls!.tokens[1];await db.collection('club_selection_ban_controls').doc(expiring).update({expiresAt:0});await assert.rejects(applyBanControl({...callback,data:'clubban:'+expiring,message:{...callback.message,message_id:9000}}),'Expired controls cannot mutate');
  await db.collection('users').doc(owner.id).update({isSuspended:true});await assert.rejects(applyBanControl({...callback,data:'clubban:'+freshControls!.tokens[0],message:{...callback.message,message_id:9000}}),(e:any)=>e.statusCode===403);await db.collection('users').doc(owner.id).update({isSuspended:false});
  const hookUrl=`http://127.0.0.1:${(server.address() as any).port}/api/telegram/webhook`;
  const hook=await originalFetch(hookUrl,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':process.env.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify({update_id:++update,callback_query:{...callback,data:'clubban:'+freshControls!.tokens[0],message:{...callback.message,message_id:9000}}})});assert.equal(hook.status,200);assert.equal((await hook.json()).handled,'club_selection_ban');
  const response=await originalFetch(url,{headers:{'x-test-actor':'owner'}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).totalMissing,3,'Banned owners are released and disappear from the current club-owner audit');
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 assert.equal((await db.collection('telegram_member_tags').get()).size,2,'Audit never changes tag records or membership');
 console.log('PASS fresh missing-group owner roster: current season/ownership, deduplicated clubs, admin/member exclusion, rejoin/transfer, partial-error truth, pagination, native no-model planning, protected gateway/HTTP and private Telegram dispatch; no Telegram membership mutations, Telegram mocked');
}finally{global.fetch=originalFetch;setTestAiAdminHooks();setTestConfigOverride(null);setTestGroundingOverride(null);setTestAiResponder(null);clearTestAiState();}
