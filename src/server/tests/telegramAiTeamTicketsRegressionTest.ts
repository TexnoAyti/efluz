import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {handleAiAdminCommand,rememberDeliveredAdminPlan} from '../services/telegramAiAdminService';
import {setTestConfigOverride,DEFAULT_AI_CONFIG} from '../services/telegramAiConfigService';
import {detectNaturalAdminAction,assertSingleNaturalAdminRequest} from '../services/telegramAiAdminLanguage';
import {planNaturalAdminRequest} from '../services/telegramAiNaturalAdminPlanner';
import {inspectAiAdminOutcome} from '../services/telegramAiAdminOutcome';
await initDatabase();
const db=getFirestoreDb(),owner=5209126900,target={id:'user-1234567',telegramId:'1234567',username:'actual_player',firstName:'Player',isAdmin:false,isSuspended:false};
await db.collection('users').doc('user-'+owner).set({id:'user-'+owner,telegramId:String(owner),username:'owner_admin',firstName:'Owner',isAdmin:true,isSuspended:false});await db.collection('users').doc(target.id).set(target);
setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true});
const base={updateId:900001,messageId:900001,chatId:owner,threadId:0,fromUser:{id:owner},text:'@actual_player team ochish uchun 2 ticket ber'},signal=new AbortController().signal;
try{
 for(const text of ['@actual_player team ochish uchun 2 ticket ber','@actual_player ga 2 ta team ticket ber','@actual_player jamoa ochishi uchun 2 ta chipta ber'])assert.equal(detectNaturalAdminAction(text),'team_ticket_grant');
 assert.throws(()=>assertSingleNaturalAdminRequest('@actual_player team uchun ticket berma'),/CLARIFY/);
 const preview=await handleAiAdminCommand(base,signal),token=/\/ai_confirm ([a-f0-9]{24})/.exec(preview)?.[1];assert.ok(token,preview);assert.match(preview,/team ticket/i);
 await rememberDeliveredAdminPlan(base,preview,900010,signal);const done=await handleAiAdminCommand({...base,updateId:900002,text:'/ai_confirm '+token},signal);assert.match(done,/Balans: 2/,done);
 assert.equal((await db.collection('team_creation_tickets').doc(target.id).get()).data().balance,2);
 await handleAiAdminCommand({...base,updateId:900003,text:'/ai_confirm '+token},signal);assert.equal((await db.collection('team_creation_tickets').doc(target.id).get()).data().balance,2);
 const balance=await handleAiAdminCommand({...base,updateId:900004,text:'@actual_player team ticketini tekshir'},signal);assert.match(balance,/Balans: 2/,balance);
 const revokeBase={...base,updateId:900005,text:'@actual_player dan 1 team ticketini qaytarib ol'},revokePreview=await handleAiAdminCommand(revokeBase,signal),revokeToken=/\/ai_confirm ([a-f0-9]{24})/.exec(revokePreview)?.[1];assert.ok(revokeToken,revokePreview);await rememberDeliveredAdminPlan(revokeBase,revokePreview,900020,signal);const revoked=await handleAiAdminCommand({...base,updateId:900006,text:'/ai_confirm '+revokeToken},signal);assert.match(revoked,/Balans: 1/,revoked);
 assert.equal((await db.collection('team_creation_tickets').doc(target.id).get()).data().balance,1);
 const deps={read:async()=>({data:[]}),users:async()=>[target,{...target,id:'user-7654321'}]};await assert.rejects(planNaturalAdminRequest(base.text,deps),/CLARIFY/);
 for(const phrase of ['@actual_player team ticketidan 2ta ber','@actual_player uchun ikkita team ticket ber'])assert.equal((await planNaturalAdminRequest(phrase,{read:async()=>({data:[]}),users:async()=>[target]}))?.body.amount,2);
 assert.equal((await planNaturalAdminRequest('1234567 team ochish uchun 1 ticket ber',{...deps,users:async()=>[target]}))?.body.targetUserId,target.id);
 const fake={action:'team_ticket_grant',body:{targetUserId:target.id,amount:1}};assert.equal(inspectAiAdminOutcome(fake,{ok:true,data:{account:{userId:'wrong',balance:1},transactionId:'wrong'}}).state,'unverified');
 console.log('PASS full natural AI team ticket grant/check/revoke, exact target, delivered confirmation, replay, ambiguous identity and receipt verification; isolated accounts and no Telegram sends');
}finally{setTestConfigOverride(null);}
