import {Router} from 'express';
import {z} from 'zod';
import {requireAuth} from '../middleware/authMiddleware';
import {getPenaltyRace,submitPenaltyShot,PenaltyRaceError} from '../services/penaltyRaceService';

export const penaltyRaceRouter=Router();
penaltyRaceRouter.use(requireAuth);
penaltyRaceRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
const valid=z.string().regex(/^[A-Za-z0-9:_-]{1,180}$/);
const fail=(res:any,err:any)=>{const status=err instanceof PenaltyRaceError?err.statusCode:503;res.status(status).json({ok:false,error:err instanceof PenaltyRaceError?err.message:'PENALTY_SCORE_UNAVAILABLE'});};
penaltyRaceRouter.get('/:fixtureId',async(req,res)=>{
 try{const id=valid.parse(req.params.fixtureId);res.json({ok:true,race:await getPenaltyRace(id,req.user!)});}
 catch(err){fail(res,err);}
});
penaltyRaceRouter.post('/:fixtureId/shot',async(req,res)=>{
 try{
  const id=valid.parse(req.params.fixtureId);
  const body=z.object({shotId:z.string().min(8).max(80),goal:z.boolean()}).parse(req.body);
  res.json({ok:true,race:await submitPenaltyShot(id,req.user!,body.shotId,body.goal)});
 }catch(err){fail(res,err);}
});
