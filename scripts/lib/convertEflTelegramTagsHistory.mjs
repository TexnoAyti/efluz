// Read-only Telegram member tag history.
// Never invokes Telegram API, adds tags or recreates recurring tag workers.
const valid=x=>typeof x==='string'&&x.length>0&&x.length<=240;
function records(source,root){
 const list=source[root]??[],seen=new Set();
 if(!Array.isArray(list))throw Error('INVALID_TAG_HISTORY_COLLECTION');
 return list.map(doc=>{
  if(!doc||!valid(doc.document_id)||seen.has(doc.document_id)||
   !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data))
   throw Error('INVALID_TAG_HISTORY_DOCUMENT');
  seen.add(doc.document_id);
  return {id:doc.document_id,data:doc.data};
 });
}
export function convertEflTelegramTagsHistory(source){
 const users=new Set((source.users??[]).map(x=>x.document_id));
 const seasons=new Set((source.seasons??[]).map(x=>x.document_id));
 const tags=records(source,'telegram_member_tags').map(({id,data})=>{
  if(!valid(data.userId)||!users.has(data.userId)||
   !valid(data.seasonId)||!seasons.has(data.seasonId)||
   !Number.isSafeInteger(data.telegramId)||data.telegramId<=0||
   typeof data.appliedTag!=='string'||typeof data.managed!=='boolean'||
   typeof data.reason!=='string'||typeof data.scope!=='string'||
   !Number.isSafeInteger(data.nextCheckAt)||data.nextCheckAt<0)
   throw Error('INVALID_TELEGRAM_TAG_HISTORY');
  return {id,user_id:data.userId,season_id:data.seasonId,
   telegram_id:String(data.telegramId),applied_tag:data.appliedTag,
   source_managed:data.managed,source_record:data,
   replay_policy:'HISTORICAL_ONLY'};
 });
 const states=records(source,'telegram_member_tag_state').map(({id,data})=>{
  if(!Object.hasOwn(data,'value')||
     (data.expiresAt!==null&&data.expiresAt!==undefined&&
      (!Number.isSafeInteger(data.expiresAt)||data.expiresAt<0)))
   throw Error('INVALID_TELEGRAM_TAG_STATE');
  return {id,source_value:data.value,source_expires_at:data.expiresAt??null,
   replay_policy:'HISTORICAL_ONLY'};
 });
 return {rows:{telegramTagHistory:tags,telegramTagStateHistory:states},
  report:{taggedMembers:tags.length,tagStates:states.length,
   tagsReapplied:false,timersScheduled:false,cutoverReady:false}};
}
