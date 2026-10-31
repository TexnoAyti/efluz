import {getFirestoreDb} from '../firebase/admin';
import {renderUzeflifeRoundPages} from './uzeflifeRoundImages';
import type {UState} from '../../types/uzeflife';

const CHANNEL='@uzeflife_turner';
/** Auto-post first league round once, independent of admin UI or AI. Each Telegram album is durable. */
export async function autoPublishUzeflifeFirstRound():Promise<boolean>{
 if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE==='preview')return false;
 const token=process.env.TELEGRAM_BOT_TOKEN;
 if(!token)return false;
 const db=getFirestoreDb(),state=(await db.collection('uzeflife').doc('championship').get()).data() as UState|undefined;
 if(!state||state.format!=='LEAGUE'||state.status!=='playing'||state.round!==1)return false;
 const games=state.matches.filter(m=>m.round===1);
 if(games.length!==121)return false;
 const ref=db.collection('uzeflife_channel_posts').doc('round-1');
 const previous=await ref.get();
 if(previous.exists)return false; // Sent, in flight or uncertain: never duplicate.
 try{await ref.create({round:1,channel:CHANNEL,state:'sending',startedAt:new Date().toISOString(),sentPages:0,totalPages:16,source:'automatic'});}
 catch(e:any){if(e?.code===6||/ALREADY_EXISTS/i.test(String(e?.message||'')))return false;throw e;}
 const caption='🏆 <b>UZEFLIFE - 1 tur o‘yinlari ma’lum</b>\n\n⚠️ <b>Deadline:</b>\n1 kun\n\n📃 <b>Reglament:</b>\nhttps://t.me/efluz_cards/16\n\n📊 <b>Natijalar bu yerga tashlanadi:</b>\nhttps://t.me/efleagueuz/8989\n\n👉 @uzeflife_turner';
 const ids:number[]=[];
 try{
  const pages=await renderUzeflifeRoundPages(state,1);
  if(pages.length!==16||pages.reduce((n,p)=>n+p.count,0)!==121)throw Error('INCOMPLETE_ROUND_IMAGE_PAGES');
  for(let start=0;start<pages.length;start+=10){
   const batch=pages.slice(start,start+10),form=new FormData();
   form.set('chat_id',CHANNEL);
   const media=batch.map((page,i)=>{
    const key='page'+i;
    form.append(key,new Blob([new Uint8Array(page.buffer)],{type:'image/png'}),'uze-1-'+page.first+'.png');
    return {type:'photo',media:'attach://'+key,caption,parse_mode:'HTML'};
   });
   form.set('media',JSON.stringify(media));
   const response=await fetch('https://api.telegram.org/bot'+token+'/sendMediaGroup',{method:'POST',body:form,signal:AbortSignal.timeout(20000)});
   const data=await response.json() as any;
   if(!response.ok||!data.ok||!Array.isArray(data.result)||data.result.length!==batch.length||data.result.some((m:any)=>!Number.isInteger(m.message_id)))throw Error(String(data.description||'TELEGRAM_ALBUM_NOT_CONFIRMED'));
   ids.push(...data.result.map((m:any)=>m.message_id));
   await ref.set({round:1,channel:CHANNEL,state:'sending',source:'automatic',sentPages:start+batch.length,totalPages:16,telegramMessageIds:ids,at:new Date().toISOString()});
  }
  await ref.set({round:1,channel:CHANNEL,state:'sent',source:'automatic',sentPages:16,totalPages:16,matchCount:121,telegramMessageIds:ids,at:new Date().toISOString()});
 }catch(e:any){
  await ref.set({round:1,channel:CHANNEL,state:'unverified',source:'automatic',sentPages:ids.length,telegramMessageIds:ids,error:String(e?.message||e).slice(0,250),at:new Date().toISOString()}).catch(()=>{});
  console.warn('[UZEFLIFE_FIRST_ROUND_CHANNEL_POST_UNVERIFIED]',e?.message);
 }
 return false;
}
