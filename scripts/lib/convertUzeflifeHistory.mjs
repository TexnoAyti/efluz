// Historical UZEFLIFE audit and notification queue migration.
// This is a forensic archive, not a live notification outbox.
// Old leases, retries and delivery cursors MUST NOT be resumed on import.
function string(value){return typeof value==='string'&&value.length>0&&value.length<=240;}
function millis(value){
 if(typeof value!=='string')throw Error('INVALID_UZEFLIFE_HISTORY_TIME');
 const date=Date.parse(value);
 if(!Number.isSafeInteger(date)||date<0)throw Error('INVALID_UZEFLIFE_HISTORY_TIME');
 return date;
}
function docs(collections,name){
 const source=collections[name]??[];
 if(!Array.isArray(source))throw Error('INVALID_UZEFLIFE_HISTORY_COLLECTION');
 const seen=new Set();
 return source.map(doc=>{
  if(!doc||!string(doc.document_id)||seen.has(doc.document_id)||
    !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data))
   throw Error('INVALID_UZEFLIFE_HISTORY_DOCUMENT');
  seen.add(doc.document_id);
  return {id:doc.document_id,data:doc.data};
 });
}
export function convertUzeflifeHistory(collections){
 const audits=docs(collections,'uzeflife_audit');
 const notices=docs(collections,'uzeflife_notifications');
 const auditHistory=audits.map(({id,data})=>{
  if(!string(data.action)||!string(data.actor)||
   !Number.isSafeInteger(data.revision)||data.revision<0||
   (data.details!==undefined&&(!data.details||typeof data.details!=='object'||
     Array.isArray(data.details))))
   throw Error('INVALID_UZEFLIFE_AUDIT');
  return {id,action:data.action,actor:data.actor,revision:data.revision,
   occurred_at:millis(data.at),details:data.details??{},source_record:data};
 });
 const noticeHistory=notices.map(({id,data})=>{
  if(!string(data.status)||!Number.isSafeInteger(data.cursor)||data.cursor<0||
     !Number.isSafeInteger(data.deliveryVersion)||data.deliveryVersion<0||
     !Array.isArray(data.notices)||!Array.isArray(data.retryIndices)||
     !Number.isSafeInteger(data.leaseUntil)||data.leaseUntil<0||
     typeof data.lease!=='string')
   throw Error('INVALID_UZEFLIFE_NOTICE_HISTORY');
  return {id,source_status:data.status,created_at:millis(data.createdAt),
   notice_count:data.notices.length,source_record:data,
   replay_policy:'HISTORICAL_ONLY'};
 });
 return {rows:{uzeflifeAuditHistory:auditHistory,uzeflifeNoticeHistory:noticeHistory},
  report:{uzeflifeAuditHistory:auditHistory.length,
   uzeflifeNoticeHistory:noticeHistory.length,
   notificationReplayEnabled:false,liveLeaseRestored:false,cutoverReady:false}};
}
