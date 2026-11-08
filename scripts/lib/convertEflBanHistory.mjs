// Immutable source history for moderator bans and Telegram callback controls.
// IMPORTANT: import MUST NOT re-send callback buttons, apply old bans or
// release clubs. Current effective bans are imported separately.
const valid=s=>typeof s==='string'&&s.length>0&&s.length<=240;
function timestamp(value){
 if(typeof value!=='string')throw Error('INVALID_BAN_HISTORY_TIME');
 const n=Date.parse(value);
 if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_BAN_HISTORY_TIME');
 return n;
}
function docs(source,root){
 const list=source[root]??[],seen=new Set();
 if(!Array.isArray(list))throw Error('INVALID_BAN_HISTORY_COLLECTION');
 return list.map(doc=>{
  if(!doc||!valid(doc.document_id)||seen.has(doc.document_id)||
     !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data))
   throw Error('INVALID_BAN_HISTORY_DOCUMENT');
  seen.add(doc.document_id);
  return {id:doc.document_id,data:doc.data};
 });
}
export function convertEflBanHistory(source){
 const users=new Set((source.users??[]).map(doc=>doc.document_id));
 const auditRows=docs(source,'club_selection_ban_audit').map(({id,data})=>{
  if(!valid(data.userId)||!users.has(data.userId)||
     !valid(data.telegramId)||typeof data.isBanned!=='boolean'||
     typeof data.previousIsBanned!=='boolean'||
     typeof data.reason!=='string'||typeof data.actorId!=='string'||
     !Number.isSafeInteger(data.revision)||data.revision<0||
     (data.releasedClubs!==undefined&&!Array.isArray(data.releasedClubs)))
   throw Error('INVALID_BAN_AUDIT_HISTORY');
  return {id,user_id:data.userId,telegram_id:data.telegramId,
   is_banned:data.isBanned,previous_is_banned:data.previousIsBanned,
   revision:data.revision,updated_at:timestamp(data.updatedAt),
   source_record:data,replay_policy:'HISTORICAL_ONLY'};
 });
 const controlRows=docs(source,'club_selection_ban_controls').map(({id,data})=>{
  if(!valid(data.targetId)||!users.has(data.targetId)||
     !valid(data.targetTelegramId)||typeof data.consumed!=='boolean'||
     typeof data.isBanned!=='boolean'||typeof data.reason!=='string'||
     !Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0||
     !Number.isSafeInteger(data.expiresAt)||data.expiresAt<0||
     !Number.isSafeInteger(data.chatId)||
     !Number.isSafeInteger(data.deliveredMessageId)||
     !Number.isSafeInteger(data.threadId)||
     (data.releasedClubs!==undefined&&!Array.isArray(data.releasedClubs)))
   throw Error('INVALID_BAN_CONTROL_HISTORY');
  return {id,target_user_id:data.targetId,
   expected_revision:data.expectedRevision,originally_consumed:data.consumed,
   expires_at:data.expiresAt,
   source_record:data,replay_policy:'HISTORICAL_ONLY'};
 });
 return {rows:{banAuditHistory:auditRows,banControlHistory:controlRows},
  report:{audits:auditRows.length,controls:controlRows.length,
   callbackReplayEnabled:false,bansApplied:false,clubsReleased:false,
   cutoverReady:false}};
}
