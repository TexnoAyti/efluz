import {uSummaryStatus,reconcileUSummary} from '../services/uzeflifeRoundSummary';
import {scheduleRoundPost} from '../services/uzeflifeRoundPost';
import type {User} from '../../types';
import type {Request} from 'express';
import type {UState} from '../../types/uzeflife';
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
async function viewState(user?:User,state?:UState){return publicUState(state||await readUState(),user);}
async function refreshUser(req:Request){
 if(!req.user)return;
 let user:User|null;
 try{user=await getAuthoritativeUserForAuthorization(req.user.id);}catch{throw uError('Akkauntni tekshirish imkonsiz.',503);}
 if(!user||user.isSuspended)throw uError('Akkauntga kirish cheklangan.',403);
 req.user=user;
}
export const uzeflifeRouter=Router();
uzeflifeRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
// Refresh account identity/suspension on every authenticated request; no stale admin claims.
uzeflifeRouter.use(async(req,res,next)=>{if(req.method==='GET'&&req.path==='/'){next();return;}try{await refreshUser(req);next();}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.message});}});
let roundPostWakeAt=0;
uzeflifeRouter.get('/',async(req,res)=>{
 // Wake the already-authorized first-round job independently of the large
 // tournament read. The worker cannot create or reset a publication.
 if(Date.now()-roundPostWakeAt>30000){roundPostWakeAt=Date.now();scheduleRoundPost(1);scheduleUNotices();}
 try{
  const [,state]=await Promise.all([refreshUser(req),readUState()]);
  res.json({ok:true,...await viewState(req.user,state)});
 }catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Turnirni yuklab bo‘lmadi.'});}
});
// Optional Telegram proposals belong to the admin queue, not the opening path.
uzeflifeRouter.get('/topic-results',requireAuth,async(req,res)=>{
 try{const state=await readUState();if(!uPermissions(state,req.user!).includes('results'))throw uError('Natijalar navbatiga ruxsat yo‘q.',403);res.json({ok:true,topicResults:await listUzeflifeTopicQueue(state)});}
 catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Telegram natijalarini yuklab bo‘lmadi. Qayta urinib ko‘ring.'});}
});
uzeflifeRouter.get('/summary-status',requireAuth,async(req,res)=>{try{if(!uPermissions(await readUState(),req.user!).includes('announcements'))throw uError('E’lonlarni boshqarishga ruxsat yo‘q.',403);res.json({ok:true,jobs:await uSummaryStatus()});}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.message});}});
uzeflifeRouter.post('/summary-reconcile',requireAuth,async(req,res)=>{try{if(!uPermissions(await readUState(),req.user!).includes('announcements'))throw uError('E’lonlarni boshqarishga ruxsat yo‘q.',403);await reconcileUSummary(req.body.id,req.body.cursor,req.body.lease,req.body.delivered);res.json({ok:true});scheduleUNotices();}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.message});}});
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
// Channel publication is independent of AI and preserves one durable checkpoint per round.
uzeflifeRouter.get('/publish-status',requireAuth,async(req,res)=>{
 try{
  const {isPrimaryOwner}=await import('../services/customTournamentTicketService');
  if(!isPrimaryOwner(req.user!.telegramId))throw uError('Faqat asosiy admin tekshirishi mumkin.',403);
  const round=Number(req.query.round||1);
  const {getSavedRoundPostStatus,scheduleRoundPost}=await import('../services/uzeflifeRoundPost');
  const delivery=await getSavedRoundPostStatus(round);
  res.json({ok:true,...delivery,tokenConfigured:!!process.env.TELEGRAM_BOT_TOKEN});
  if(delivery.state==='pending')scheduleRoundPost(round);
 }catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Yuborish holati olinmadi.'});}
});
uzeflifeRouter.post('/publish-round',requireAuth,async(req,res)=>{
 try{
  const {isPrimaryOwner}=await import('../services/customTournamentTicketService');
  if(!isPrimaryOwner(req.user!.telegramId))throw uError('Kanalga e’lonni faqat asosiy admin yubora oladi.',403);
  const state=await readUState();
  if(!Number.isInteger(req.body?.expectedRevision)||req.body.expectedRevision!==state.revision)throw uError('Turnir yangilangan. E’lonni qayta tasdiqlang.',409);
  const {requestRoundPost,scheduleRoundPost}=await import('../services/uzeflifeRoundPost');
  const delivery=await requestRoundPost(state,req.body?.round,req.user!.id);
  res.status(delivery.state==='sent'?200:202).json({ok:true,...delivery,queued:delivery.state!=='sent',alreadySent:delivery.state==='sent'});
  if(delivery.state==='pending')scheduleRoundPost(delivery.round);
 }catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'E’lonni navbatga qo‘shib bo‘lmadi.'});}
});
uzeflifeRouter.post('/publish-reconcile',requireAuth,async(req,res)=>{
 try{
  const {isPrimaryOwner}=await import('../services/customTournamentTicketService');
  if(!isPrimaryOwner(req.user!.telegramId))throw uError('Faqat asosiy admin tasdiqlashi mumkin.',403);
  if(req.body?.checkedChannel!==true)throw uError('Avval kanaldagi rasmlarni tekshiring.',400);
  const {reconcileRoundPost,scheduleRoundPost}=await import('../services/uzeflifeRoundPost');
  const delivery=await reconcileRoundPost(await readUState(),req.body.round,req.user!.id,req.body.checkpoint,req.body.confirmedPages);
  res.json({ok:true,...delivery});
  if(delivery.state==='pending')scheduleRoundPost(delivery.round);
 }catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Yuborish holatini saqlab bo‘lmadi.'});}
});
uzeflifeRouter.post('/:action',requireAuth,async(req,res)=>{try{await mutateUState(req.user!,req.params.action,req.body);res.json({ok:true,...await viewState(req.user)});}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Amalni saqlab bo‘lmadi. Qayta urinib ko‘ring.',channels:e.channels});}});
