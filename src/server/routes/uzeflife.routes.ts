import {Router} from 'express';
import {requireAuth} from '../middleware/authMiddleware';
import {getAuthoritativeUserForAuthorization} from '../firebase/firestoreStore';
import {readUState,publicUState,mutateUState,checkUSubscriptions,uPermissions,uError} from '../services/uzeflifeService';
import {canExportUzeflifeImage} from '../../lib/uzeflifeImage';
import {createTournamentImageDownloadService} from '../services/tournamentImageDownload';
const imageDownloads=createTournamentImageDownloadService();
export const uzeflifeRouter=Router();
uzeflifeRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
// Refresh account identity/suspension on every authenticated request; no stale admin claims.
uzeflifeRouter.use(async(req,res,next)=>{try{if(req.user){const u=await getAuthoritativeUserForAuthorization(req.user.id);if(!u||u.isSuspended){res.status(403).json({ok:false,error:'Akkauntga kirish cheklangan.'});return;}req.user=u;}next();}catch{res.status(503).json({ok:false,error:'Akkauntni tekshirish imkonsiz.'});}});
uzeflifeRouter.get('/',async(req,res)=>{try{res.json({ok:true,...publicUState(await readUState(),req.user)});}catch{res.status(503).json({ok:false,error:'Turnirni yuklab bo‘lmadi.'});}});
uzeflifeRouter.post('/subscription-check',requireAuth,async(req,res)=>{try{const missing=await checkUSubscriptions(await readUState(),req.user!);res.json({ok:true,subscribed:missing.length===0,channels:missing});}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.message});}});
// Tournament roles are independent of global platform administration.
uzeflifeRouter.post('/image-export',requireAuth,async(req,res)=>{
 try{
  if(!canExportUzeflifeImage(uPermissions(await readUState(),req.user!)))throw uError('Rasmni faqat o‘yinlar yoki natijalar vakolati bor admin yuklab olishi mumkin.',403);
  const download=await imageDownloads.create(req.body?.pngBase64,req.body?.filename);
  res.json({ok:true,...download});
 }catch(e:any){const invalid=String(e.message).startsWith('INVALID_');res.status(e.statusCode||(invalid?400:503)).json({ok:false,error:e.statusCode?e.message:invalid?'PNG rasm ma’lumotlari noto‘g‘ri.':'Rasmni saqlashga tayyorlab bo‘lmadi. Qayta urinib ko‘ring.'});}
});
uzeflifeRouter.post('/:action',requireAuth,async(req,res)=>{try{await mutateUState(req.user!,req.params.action,req.body);res.json({ok:true,...publicUState(await readUState(),req.user)});}catch(e:any){res.status(e.statusCode||503).json({ok:false,error:e.statusCode?e.message:'Amalni saqlab bo‘lmadi. Qayta urinib ko‘ring.',channels:e.channels});}});
