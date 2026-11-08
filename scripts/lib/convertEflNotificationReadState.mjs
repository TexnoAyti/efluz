// Migration of durable notification read markers.
// This does not mark anything read or send any notifications.
export function convertEflNotificationReadState(collections){
 const source=collections.notification_read_state??[];
 const users=new Set((collections.users??[]).map(doc=>doc.document_id));
 const seen=new Set();
 if(!Array.isArray(source))throw Error('INVALID_NOTIFICATION_READ_SOURCE');
 const rows=source.map(doc=>{
  if(!doc||typeof doc.document_id!=='string'||!doc.document_id||
     seen.has(doc.document_id)||!users.has(doc.document_id)||
     !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data)||
     !doc.data.state||typeof doc.data.state!=='object'||
     Array.isArray(doc.data.state))
   throw Error('INVALID_NOTIFICATION_READ_RECORD');
  seen.add(doc.document_id);
  const state=doc.data.state;
  if(Object.entries(state).some(([key,value])=>
      typeof key!=='string'||!key||typeof value!=='string'||
      value.length>256))
   throw Error('INVALID_NOTIFICATION_READ_MARKER');
  return {id:doc.document_id,user_id:doc.document_id,state};
 });
 return {rows:{notificationReadState:rows},report:{
  usersWithReadMarkers:rows.length,existingReadMarkersPreserved:true,
  newNotificationsSent:false,cutoverReady:false}};
}
