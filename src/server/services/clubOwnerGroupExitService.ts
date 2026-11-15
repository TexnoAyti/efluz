import {getFirestoreDb} from '../firebase/admin';
import {sendTelegramMessage} from './telegramBotService';
import {PRIMARY_OWNER_TELEGRAM_ID} from './telegramAiConfigService';

type ExitState='left'|'kicked'|'returned';
type OwnerClub={seasonId:string;clubId:string;clubName:string};
type ExitEntry={
 id:string;telegramId:string;userId:string;name:string;username:string;
 state:ExitState;exitedAt:string;returnedAt?:string;group:string;
 clubs:OwnerClub[];lastUpdateId:number;notifiedAt?:string;personalNotifiedAt?:string;
};
const COLLECTION='club_owner_group_exits';
const member=(m:any)=>Boolean(m&&(['creator','administrator','member'].includes(m.status)||(m.status==='restricted'&&m.is_member===true)));
const departing=(m:any)=>m?.status==='left'||m?.status==='kicked'||(m?.status==='restricted'&&m?.is_member===false);
const expectedGroup=()=>String(process.env.TELEGRAM_GROUP_USERNAME||'@efleagueuz').replace(/^@/,'').toLowerCase();
function eventData(update:any){
 const change=update?.chat_member;
 const service=update?.message?.left_chat_member||update?.message?.new_chat_members?.length ? update.message : null;
 const chat=change?.chat||service?.chat;
 if(!chat||String(chat.username||'').toLowerCase()!==expectedGroup() || !['group','supergroup'].includes(chat.type))return null;
 if(change){
  const user=change.new_chat_member?.user;
  if(!Number.isSafeInteger(user?.id)||user.is_bot)return null;
  const old=change.old_chat_member,next=change.new_chat_member;
  if(member(old)&&departing(next))return {user,state:next.status==='kicked'?'kicked' as const:'left' as const,at:change.date};
  if(!member(old)&&member(next))return {user,state:'returned' as const,at:change.date};
  return null;
 }
 const user=service?.left_chat_member||service?.new_chat_members?.[0];
 if(!Number.isSafeInteger(user?.id)||user.is_bot)return null;
 return {user,state:service?.left_chat_member?'left' as const:'returned' as const,at:service.date};
}

export async function handleClubOwnerGroupExit(update:any):Promise<'ignored'|'recorded'|'returned'|'not_owner'>{
 const evt=eventData(update);
 if(!evt)return 'ignored';
 const db=getFirestoreDb(),telegramId=String(evt.user.id),userId='user-'+telegramId;
 const ref=db.collection(COLLECTION).doc(telegramId);
 const previous=await ref.get(),existing=previous.data() as ExitEntry|undefined;
 if(existing&&existing.lastUpdateId>=update.update_id)return 'ignored';
 if(evt.state==='returned'){
  if(existing){
   await ref.set({...existing,state:'returned',returnedAt:new Date(evt.at*1000).toISOString(),lastUpdateId:update.update_id});
  }
  return 'returned';
 }
 // The group has many members; only current EFLUZ club owners belong in this report.
 const occupied=await db.collection('club_occupancies').where('userId','==',userId).get();
 const active=occupied.docs.map(x=>x.data() as any).filter(x=>x.clubId&&x.seasonId&&(!x.status||x.status==='active'));
 if(!active.length)return 'not_owner';
 const clubs:OwnerClub[]=await Promise.all(active.slice(0,12).map(async x=>{
  const club=await db.collection('clubs').doc(String(x.clubId)).get();
  return {seasonId:String(x.seasonId),clubId:String(x.clubId),clubName:String(club.data()?.name||x.clubId).slice(0,90)};
 }));
 const name=String([evt.user.first_name,evt.user.last_name].filter(Boolean).join(' ')||evt.user.username||telegramId).slice(0,90);
 const now=new Date((Number.isFinite(evt.at)?evt.at:Date.now()/1000)*1000).toISOString();
 const record:ExitEntry={id:telegramId,telegramId,userId,name,username:String(evt.user.username||'').slice(0,70),
  group:expectedGroup(),state:evt.state,exitedAt:now,clubs,lastUpdateId:update.update_id};
 // Avoid duplicate alerts when Telegram repeats a service message and a member update.
 if(existing?.state===evt.state&&Date.parse(now)-Date.parse(existing.exitedAt)<60_000)return 'ignored';
 await ref.set(record);
 const detail=clubs.map(x=>x.clubName+' ('+x.seasonId.replace('season-','')+')').join(', ');
 const label=evt.state==='kicked'?'guruhdan chiqarildi':'guruhdan chiqdi';
 const message='EFLUZ · Klub egasi '+label+'\n\n'+name+
  (record.username?' (@'+record.username+')':'')+'\nKlub: '+detail+
  '\nVaqt: '+now+'\nGuruh: @'+expectedGroup()+
  '\n\nKlub egaligi avtomatik bekor qilinmadi.';
 // Record first. If delivery fails, it remains available in the admin endpoint.
 if(PRIMARY_OWNER_TELEGRAM_ID&&process.env.FIREBASE_FORCE_LOCAL_FALLBACK!=='true'){
  const sent=await sendTelegramMessage(PRIMARY_OWNER_TELEGRAM_ID,message,{parse_mode:null});
  if(sent.ok)await ref.set({notifiedAt:new Date().toISOString()},{merge:true});
  else console.warn('[CLUB_OWNER_EXIT_ALERT_UNDELIVERED]',{userId});
 }
 // Direct messages are initiated only for known club owners. Telegram may
 // reject users who have not started the bot or have blocked it.
 const personalText='EFLUZ · Guruhga qaytish eslatmasi\\n\\n'+
  'Siz EFLUZ klub egasi sifatida @'+expectedGroup()+' guruhida hozir a’zo emassiz.\\n'+
  'Klubingiz: '+detail+'\\n\\n'+
  'Uchrashuvlar, joriy tur va muhim e’lonlarni o‘tkazib yubormaslik uchun guruhga qayting.\\n'+
  'Klubingiz avtomatik olib qo‘yilmadi.';
 const personal=await sendTelegramMessage(telegramId,personalText,{
  parse_mode:null,
  reply_markup:{inline_keyboard:[[{text:'Guruhga qaytish',url:'https://t.me/'+expectedGroup()}]]},
 });
 if(personal.ok)await ref.set({personalNotifiedAt:new Date().toISOString()},{merge:true});
 else console.warn('[CLUB_OWNER_EXIT_DM_UNDELIVERED]',{userId,errorCode:personal.error_code||null});
 return 'recorded';
}

export async function listClubOwnerGroupExits(){
 const snap=await getFirestoreDb().collection(COLLECTION).get();
 return (snap.docs.map(d=>d.data() as ExitEntry)
  .filter(x=>x.state==='left'||x.state==='kicked')
  .sort((a,b)=>b.exitedAt.localeCompare(a.exitedAt))
  .slice(0,150).map(x=>({name:x.name,username:x.username,telegramId:x.telegramId,
   userId:x.userId,clubs:x.clubs,state:x.state,exitedAt:x.exitedAt,group:x.group,notified:!!x.notifiedAt})));
}
