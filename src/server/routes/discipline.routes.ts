import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { getFirestoreDb } from '../firebase/admin';
import { getDiscipline, getDisciplineFixtures, issueDisciplineCard, revokeDisciplineCard, assertDisciplineFixtureAllowed } from '../services/disciplineService';

export const disciplineRouter=Router();
disciplineRouter.use(requireAuth);
disciplineRouter.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
const season=(req:any)=>{
 const value=String(req.query.seasonId||req.body?.seasonId||'season-2026-27');
 if(!/^season-\d{4}-\d{2}$/.test(value))throw Object.assign(Error('Mavsum noto‘g‘ri.'),{statusCode:400});
 return value;
};
const wrap=(fn:any)=>(req:any,res:any,next:any)=>Promise.resolve().then(()=>fn(req,res)).catch((e:any)=>res.status(e.statusCode||503).json({error:e.message,code:e.code||'DISCIPLINE_UNAVAILABLE'}));
const fullAdmin=(req:any,res:any,next:any)=> req.user?.adminPermissions?.scope==='LEAGUES'?res.status(403).json({error:'Bu amal faqat katta admin uchun.'}):next();
disciplineRouter.get('/users/:id',wrap(async(req:any,res:any)=>{
 let privateView=req.user.id===req.params.id;
 if(!privateView&&req.user.isAdmin){
  const viewer=(await getFirestoreDb().collection('users').doc(req.user.id).get()).data();
  privateView=Boolean(viewer?.isAdmin&&!viewer.isSuspended&&viewer.adminPermissions?.scope!=='LEAGUES');
 }
 res.json({cards:await getDiscipline(req.params.id,season(req),privateView)});
}));
disciplineRouter.get('/users/:id/fixtures',requireAdmin,fullAdmin,wrap(async(req:any,res:any)=>res.json({fixtures:await getDisciplineFixtures(req.params.id,season(req))})));
const issueSchema=z.object({seasonId:z.string().regex(/^season-\d{4}-\d{2}$/),color:z.enum(['YELLOW','RED']),reason:z.enum(['ABUSE','DELAY','NO_SHOW','OTHER']),note:z.string().trim().min(3).max(500),incidentFixtureId:z.string().trim().min(1).max(160).nullable(),requestId:z.string().uuid(),expectedSuspensionFixtureId:z.string().trim().min(1).max(160).nullable().optional()}).strict();
disciplineRouter.post('/users/:id/cards',requireAdmin,fullAdmin,validateBody(issueSchema),wrap(async(req:any,res:any)=>{
 const card=await issueDisciplineCard(req.user.id,req.params.id,season(req),req.body);
 res.json({card});
}));
disciplineRouter.post('/users/:id/cards/:cardId/revoke',requireAdmin,fullAdmin,validateBody(z.object({seasonId:z.string().regex(/^season-\d{4}-\d{2}$/),reason:z.string().trim().min(3).max(500)}).strict()),wrap(async(req:any,res:any)=>{
 await revokeDisciplineCard(req.user.id,req.params.id,season(req),req.params.cardId,req.body.reason);
 res.json({success:true,card:(await getDiscipline(req.params.id,season(req),true)).find(c=>c.id===req.params.cardId)});
}));
disciplineRouter.post('/fixtures/:id/check',wrap(async(req:any,res:any)=>{
 try { await assertDisciplineFixtureAllowed(req.params.id,req.user.id); }
 catch(error:any) { if(error.code!=='DISCIPLINARY_SUSPENSION')throw error; }
 const fixture=await getFirestoreDb().collection('fixtures').doc(req.params.id).get();
 if(!fixture.exists)return res.status(404).json({error:'O‘yin topilmadi.'});
 res.json({blocked:fixture.data()?.status!=='CONFIRMED'&&Boolean(fixture.data()?.disciplinaryHolds?.length)});
}));
disciplineRouter.get('/fixtures/:id',wrap(async(req:any,res:any)=>{
 const fixture=await getFirestoreDb().collection('fixtures').doc(req.params.id).get();
 if(!fixture.exists)return res.status(404).json({error:'O‘yin topilmadi.'});
 res.json({blocked:fixture.data()?.status!=='CONFIRMED'&&Boolean(fixture.data()?.disciplinaryHolds?.length)});
}));
