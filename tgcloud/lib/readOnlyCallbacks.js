import {handleReadOnlyBotCommand} from './readOnlyBotCommands.js';

// Telegram Serverless callbacks are separate update handlers. Only narrow,
// read-only commands are recognized; never evaluate arbitrary callback data.
export async function handleReadOnlyCallback(db,query){
  if(!query || typeof query.id!=='string' || query.id.length>160)return null;
  if(!['efl:status','efl:myclub'].includes(query.data))return null;
  const from=query.from,chat=query.message?.chat;
  if(!from||!Number.isSafeInteger(from.id)||from.id<=0||from.is_bot||
     !chat||chat.type!=='private'||!Number.isSafeInteger(chat.id)||
     String(chat.id)!==String(from.id))return null;
  if(query.data==='efl:status')
    return {answer:{callback_query_id:query.id,text:'EFLUZ Serverless sinov rejimi. Production hali o‘zgarmagan.',show_alert:false}};
  const message=await handleReadOnlyBotCommand(db,{
    text:'/myclub',from,chat
  });
  if(!message)return null;
  return {answer:{callback_query_id:query.id,text:'Klub ma’lumoti shaxsiy chatga yuborildi.',show_alert:false},message};
}
