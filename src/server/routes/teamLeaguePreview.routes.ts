import {Router, type RequestHandler} from 'express';
import {requireAuth} from '../middleware/authMiddleware';
import {getAuthoritativeUserForAuthorization} from '../firebase/firestoreStore';
import {canSeeTeamPreview} from '../../types/teamLeaguePreview';
import {getTeamPreview,getPreviewLeague,getPreviewTeamProfile,savePreviewTeam,savePreviewLeague,actOnTeamLeague} from '../services/teamLeaguePreview';
export const requireTeamPreviewOwner:RequestHandler=async(req,res,next)=>{
 if(!canSeeTeamPreview(req.user?.telegramId)){res.status(403).json({ok:false,error:'Bu test faqat loyiha egasi uchun.'});return;}
 try{const user=await getAuthoritativeUserForAuthorization(req.user!.id);
 if(!user||user.isSuspended||!canSeeTeamPreview(user.telegramId)){res.status(403).json({ok:false,error:'Testga kirish yopiq.'});return;}next();
 }catch{res.status(503).json({ok:false,error:'Kirish huquqini tekshirib bo‘lmadi. Keyinroq urining.'});}
};
export const teamLeaguePreviewRouter=Router();
teamLeaguePreviewRouter.use(requireAuth,requireTeamPreviewOwner);
const run=(handler:(req:any)=>Promise<unknown>):RequestHandler=>async(req,res)=>{try{res.setHeader('Cache-Control','no-store');res.json({ok:true,data:await handler(req)});}catch(e:any){res.status(e.statusCode||500).json({ok:false,error:e.statusCode?e.message:'Saqlash bajarilmadi. Qayta yuklab tekshiring.'});}};
teamLeaguePreviewRouter.get('/',run(req=>getTeamPreview(req.user.id)));
teamLeaguePreviewRouter.get('/leagues/:id',run(req=>getPreviewLeague(req.user.id,req.params.id)));
teamLeaguePreviewRouter.get('/teams/:id',run(req=>getPreviewTeamProfile(req.user.id,req.params.id)));
teamLeaguePreviewRouter.post('/teams',run(req=>savePreviewTeam(req.user.id,req.body)));
teamLeaguePreviewRouter.post('/leagues',run(req=>savePreviewLeague(req.user.id,req.body)));
teamLeaguePreviewRouter.post('/leagues/:id/actions',run(req=>actOnTeamLeague(req.user.id,req.params.id,req.body)));
