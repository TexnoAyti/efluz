import type {User} from '../../types';
import {listUzeflifeTopicQueue} from '../services/telegramTopicResults';
import {Router} from 'express';
import {getFirestoreDb} from '../firebase/admin';
import {scheduleUNotices} from '../services/uzeflifeNotifications';
import {requireAuth} from '../middleware/authMiddleware';
import {getAuthoritativeUserForAuthorization} from '../firebase/firestoreStore';
import {readUState,publicUState,mutateUState,checkUSubscriptions,uPermissions,uError} from '../services/uzeflifeService';
import {canExportUzeflifeImage} from '../../lib/uzeflifeImage';
import {createTournamentImageDownloadService} from '../services/tournamentImageDownload';
const imageDownloads=createTournamentImageDownloadService();
async function viewState(user?:User){const state=await readUState();const topicResults=user&&uPermissions(state,user).includes('results')?await listUzeflifeTopicQueue(state).catch(()=>[]):[];return {...publicUState(state,user),topicResults};}
export const uzeflifeRouter=Router();
uzeflifeRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
// Refresh account identity/suspension on every authenticated request; no stale admin claims.
uzeflifeRouter.use(async(req,res,next)=>{try{if(req.user){const u=await getAuthoritativeUserForAuthorization(req.user.id);if(!u||u.isSuspended){res.status(403).json({ok:false,error:'Akkauntga kirish cheklangan.'});return;}req.user=u;}next();}catch{res.status(503).json({ok:false,error:'Akkauntni tekshirish imkonsiz.'});}});
uzeflifeRouter.get('/',async(req,res)=>{try{res.json({ok:true,...await viewState(req.user)});if(req.user)scheduleUNotices();}catch{res.status(503).json({ok:false,error:'Turnirni yuklab bo‘lmadi.'});}});
uzeflifeRouter.get('/history/:id',async(req,res)=>{
 try{if(!/^uzeflife-[a-f0-9-]{36}$/.test(req.params.id))throw uError('Turnir tarixi topilmadi.',404);const snap=await getFirestoreDb().collection('uzeflife_history').doc(req.params.id).get();if(!snap.exists)throw uError('Turnir tarixi topilmadi.',404);res.json({ok:true,archive:snap.data()});}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Tarixni yuklab bo‘lmadi.'});}
});
uzeflifeRouter.get('/evidence/:id',requireAuth,async(req,res)=>{
 try{const state=await readUState(),m=state.matches.find(m=>m.dispute?.evidenceId===req.params.id);if(!m||(!uPermissions(state,req.user!).includes('results')&&![m.home,m.away].includes(req.user!.id)))throw uError('Skrinshotga ruxsat yo‘q.',403);const record=(await getFirestoreDb().collection('uzeflife_evidence').doc(req.params.id).get()).data();if(!record||record.matchId!==m.id)throw uError('Skrinshot topilmadi.',404);res.setHeader('Content-Type','image/jpeg');res.setHeader('X-Content-Type-Options','nosniff');res.send(Buffer.from(record.jpegBase64,'base64'));}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Skrinshotni yuklab bo‘lmadi.'});}
});
uzeflifeRouter.post('/subscription-check',requireAuth,async(req,res)=>{try{const missing=await checkUSubscriptions(await readUState(),req.user!);res.json({ok:true,subscribed:missing.length===0,channels:missing});}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.message});}});
// Tournament roles are independent of global platform administration.
uzeflifeRouter.post('/image-export',requireAuth,async(req,res)=>{
 try{
  if(!canExportUzeflifeImage(uPermissions(await readUState(),req.user!)))throw uError('Rasmni faqat o‘yinlar yoki natijalar vakolati bor admin yuklab olishi mumkin.',403);
  const download=await imageDownloads.create(req.body?.pngBase64,req.body?.filename);
  res.json({ok:true,...download});
 }catch(e:any){const invalid=String(e.message).startsWith('INVALID_');res.status(e.statusCode||(invalid?400:503)).json({ok:false,error:e.statusCode?e.message:invalid?'PNG rasm ma’lumotlari noto‘g‘ri.':'Rasmni saqlashga tayyorlab bo‘lmadi. Qayta urinib ko‘ring.'});}
});
// AI uses this fixed destination through the ordinary authenticated, owner-only gateway.
uzeflifeRouter.post('/publish-round',requireAuth,async(req,res)=>{
 try{
  const {isPrimaryOwner}=await import('../services/customTournamentTicketService');
  if(!isPrimaryOwner(req.user!.telegramId))throw uError('Kanalga e’lonni faqat asosiy admin yubora oladi.',403);
  const state=await readUState(),round=req.body?.round;
  if(state.format!=='LEAGUE'||state.status!=='playing'||!Number.isInteger(round)||round!==state.round||!state.matches.some(m=>m.round===round))throw uError('Faqat boshlangan liganing joriy turi e’lon qilinadi.',409);
  if(!Number.isInteger(req.body?.expectedRevision)||req.body.expectedRevision!==state.revision)throw uError('Turnir yangilangan. E’lonni qayta tasdiqlang.',409);
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token)throw uError('Telegram bot tokeni sozlanmagan.',503);
  const db=getFirestoreDb(),ref=db.collection('uzeflife_channel_posts').doc('round-'+round);
  try{await ref.create({round,channel:'@uzeflife_turner',state:'sending',requestedBy:req.user!.id,at:new Date().toISOString()});}
  catch(e:any){if(e?.code===6||/ALREADY_EXISTS/i.test(String(e?.message||'')))throw uError('Bu tur e’loni avval yuborilgan yoki yuborish jarayonida. Takror yuborilmadi.',409);throw e;}
  const caption='🏆 <b>UZEFLIFE - '+round+' tur o‘yinlari ma’lum</b>\n\n⚠️ <b>Deadline:</b>\n1 kun\n\n📃 <b>Reglament:</b>\nhttps://t.me/efluz_cards/16\n\n📊 <b>Natijalar bu yerga tashlanadi:</b>\nhttps://t.me/efleagueuz/8989\n\n👉 @uzeflife_turner';
  try{
   const {renderUzeflifeRoundPages}=await import('../services/uzeflifeRoundImages');
   const pages=await renderUzeflifeRoundPages(state,round);
   const total=state.matches.filter(m=>m.round===round).length;
   if(pages.reduce((n,p)=>n+p.count,0)!==total)throw new Error('O‘yinlar to‘liq rasmga aylantirilmadi.');
   const allIds:number[]=[];
   for(let start=0;start<pages.length;start+=10){
    const batch=pages.slice(start,start+10),form=new FormData();
    form.set('chat_id','@uzeflife_turner');
    const media=batch.map((page,index)=>{
     const key='page'+index;
     form.append(key,new Blob([new Uint8Array(page.buffer)],{type:'image/png'}),'uzeflife-'+round+'-'+page.first+'.png');
     return {type:'photo',media:'attach://'+key,...(start===0&&index===0?{caption,parse_mode:'HTML'}:{})};
    });
    form.set('media',JSON.stringify(media));
    const response=await fetch('https://api.telegram.org/bot'+token+'/sendMediaGroup',{method:'POST',body:form,signal:AbortSignal.timeout(20000)});
    const result=await response.json() as any;
    if(!response.ok||!result.ok||!Array.isArray(result.result)||result.result.length!==batch.length||result.result.some((m:any)=>!m.message_id))throw new Error(String(result.description||'Telegram albomi tasdiqlanmadi.'));
    const ids=result.result.map((m:any)=>m.message_id as number);allIds.push(...ids);
    await ref.set({round,channel:'@uzeflife_turner',state:'sending',requestedBy:req.user!.id,at:new Date().toISOString(),sentPages:start+batch.length,totalPages:pages.length,telegramMessageIds:allIds});
   }
   await ref.set({round,channel:'@uzeflife_turner',state:'sent',telegramMessageIds:allIds,matchCount:total,imageCount:pages.length,requestedBy:req.user!.id,at:new Date().toISOString()});
   res.json({ok:true,round,channel:'@uzeflife_turner',matchCount:total,imageCount:pages.length,messageIds:allIds});
  }catch(e:any){
   // Preserve the reservation if delivery is uncertain: never blindly double-post.
   await ref.set({round,channel:'@uzeflife_turner',state:'unverified',error:String(e.message||e).slice(0,200),at:new Date().toISOString()}).catch(()=>{});
   throw uError('Kanalga yuborish tasdiqlanmadi. Takror yuborishdan oldin kanalni tekshiring.',503);
  }
 }catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'E’lonni yuborib bo‘lmadi.'});}
});
uzeflifeRouter.post('/:action',requireAuth,async(req,res)=>{try{await mutateUState(req.user!,req.params.action,req.body);res.json({ok:true,...await viewState(req.user)});}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Amalni saqlab bo‘lmadi. Qayta urinib ko‘ring.',channels:e.channels});}});
