import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {handleAiAdminCommand,rememberDeliveredAdminPlan} from '../services/telegramAiAdminService';
import {setTestConfigOverride,DEFAULT_AI_CONFIG} from '../services/telegramAiConfigService';
import {detectNaturalAdminAction,assertSingleNaturalAdminRequest} from '../services/telegramAiAdminLanguage';
import {inspectAiAdminOutcome} from '../services/telegramAiAdminOutcome';
import {executeAiAdminRoute} from '../services/telegramAiAdminGateway';
await initDatabase();const db=getFirestoreDb(),owner=5209126900,target='user-870100';
await db.collection('users').doc('user-'+owner).set({id:'user-'+owner,telegramId:String(owner),username:'primary_owner',isAdmin:true,isSuspended:false});
await db.collection('users').doc(target).set({id:target,telegramId:'870100',username:'inactive_player',firstName:'Inactive',isAdmin:false,isSuspended:false});
setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true});const signal=new AbortController().signal;
let updateId=940000;const payload=(text:string)=>({updateId:++updateId,messageId:updateId,chatId:owner,threadId:0,fromUser:{id:owner},text});
try{
 for(const text of ['@inactive_player ga klub tanlashga ban ber','@inactive_player ni banla','@inactive_player ga ban ber. Sabab: o‘ynamadi','@inactive_player banini olib tashla'])assert.equal(detectNaturalAdminAction(text),'club_selection_ban');
 assert.throws(()=>assertSingleNaturalAdminRequest('@inactive_player ga ban berma'),/CLARIFY/);
 const base=payload('@inactive_player ga klub tanlashga ban ber. Sabab: o‘yinlarni o‘ynamadi'),preview=await handleAiAdminCommand(base,signal),token=/\/ai_confirm ([a-f0-9]{24})/.exec(preview)?.[1];assert.ok(token,preview);assert.match(preview,/@inactive_player/);assert.match(preview,/klub tanlashga ban/);
 assert.equal((await db.collection('club_selection_bans').doc(target).get()).exists,false,'Planning does not ban');
 await rememberDeliveredAdminPlan(base,preview,940020,signal);const result=await handleAiAdminCommand(payload('/ai_confirm '+token),signal);assert.match(result,/ban saqlandi/i,result);assert.equal((await db.collection('club_selection_bans').doc(target).get()).data().isBanned,true);
 const unbanBase=payload('@inactive_player klub tanlash banini olib tashla'),unban=await handleAiAdminCommand(unbanBase,signal),unbanToken=/\/ai_confirm ([a-f0-9]{24})/.exec(unban)?.[1];assert.ok(unbanToken,unban);await rememberDeliveredAdminPlan(unbanBase,unban,940030,signal);assert.match(await handleAiAdminCommand(payload('/ai_confirm '+unbanToken),signal),/ban.*olib tashlandi/i);assert.equal((await db.collection('club_selection_bans').doc(target).get()).data().isBanned,false);
 await handleAiAdminCommand(payload('/ai_confirm '+token),signal);assert.equal((await db.collection('club_selection_bans').doc(target).get()).data().isBanned,false,'Replayed old confirmation cannot reban');
 await assert.rejects(executeAiAdminRoute({action:'club_selection_ban',targetId:target,body:{isBanned:true}},7573478198,'delegate-club-ban'),/asosiy admin/);
 assert.equal(inspectAiAdminOutcome({action:'club_selection_ban',targetId:target,body:{isBanned:true}},{success:true,ban:{userId:'wrong',isBanned:true,revision:1}}).state,'unverified');
 console.log('PASS natural AI club selection ban/unban: exact account, no model, delivered owner confirmation, receipt validation, replay and delegate exclusion; no Telegram sends');
}finally{setTestConfigOverride(null);}
