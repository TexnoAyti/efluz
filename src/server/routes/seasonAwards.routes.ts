import {Router} from 'express';
import {requireAuth} from '../middleware/authMiddleware';
import {mutateSeasonAwards,parseAwardSeason,readSeasonAwards} from '../services/seasonAwardsService';
export const seasonAwardsRouter=Router();
seasonAwardsRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
seasonAwardsRouter.get('/:seasonId',async(req,res)=>{try{const season=parseAwardSeason(req.params.seasonId);res.json(await readSeasonAwards(season,req.user));}catch(e:any){res.status(e.statusCode||503).json({message:e.statusCode?e.message:'Mukofotlarni yuklab bo‘lmadi.'});}});
seasonAwardsRouter.post('/:seasonId',requireAuth,async(req,res)=>{try{const season=parseAwardSeason(req.params.seasonId);await mutateSeasonAwards(season,req.user!,req.body);res.json({ok:true});}catch(e:any){res.status(e.statusCode||503).json({message:e.statusCode?e.message:'Mukofot amalini saqlab bo‘lmadi. Holatni tekshiring.'});}});
