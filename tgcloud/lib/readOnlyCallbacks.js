import {handleReadOnlyBotCommand} from './readOnlyBotCommands.js';

// Each callback maps to a fixed, private, read-only command. Nothing in
// callback data can select a different player, season or Telegram chat.
const allowed={
 'efl:myclub':'/myclub',
 'efl:myfixtures':'/myfixtures',
 'efl:leagues':'/leagues',
 'efl:cups':'/cups',
 'efl:uzeflife':'/uzeflife',
 'efl:bracket':'/bracket',
 'efl:teams':'/teams',
 'efl:inbox':'/inbox'
};
export async function handleReadOnlyCallback(db,query){
 if(!query||typeof query.id!=='string'||query.id.length>160)return null;
 if(query.data!=='efl:status'&&!Object.hasOwn(allowed,query.data))return null;
 const from=query.from,chat=query.message?.chat;
 if(!from||!Number.isSafeInteger(from.id)||from.id<=0||from.is_bot||
    !chat||chat.type!=='private'||!Number.isSafeInteger(chat.id)||
    String(chat.id)!==String(from.id))return null;
 if(query.data==='efl:status')
  return {answer:{callback_query_id:query.id,
   text:'EFLUZ Serverless sinov rejimi. Production hali o‘zgarmagan.',show_alert:false}};
 const message=await handleReadOnlyBotCommand(db,{
  text:allowed[query.data],from,chat
 });
 if(!message)return null;
 return {answer:{callback_query_id:query.id,
   text:'Ma’lumot shaxsiy chatga yuborildi.',show_alert:false},message};
}
