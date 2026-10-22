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
uzeflifeRouter.post('/:action',requireAuth,async(req,res)=>{try{await mutateUState(req.user!,req.params.action,req.body);res.json({ok:true,...await viewState(req.user)});}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Amalni saqlab bo‘lmadi. Qayta urinib ko‘ring.',channels:e.channels});}});
