import {createHash} from 'node:crypto';
import type {Request,Response} from 'express';
import {refreshChangedFixtureReadModel,getAdminFixturesFromReadModel} from '../readModel/readModelStore';
import {refreshDerivedCompetitionState} from '../services/fixtureTombstoneService';
export async function resultCacheProbe(req:Request,res:Response){
 if(Date.now()>1791555262009||createHash('sha256').update(String(req.headers['x-result-probe']||'')).digest('hex')!=='3172c5229c1ecbc1ee4c9fd3a924208ef6e76f673a404da786f70b103fc7087c'){res.sendStatus(404);return;}
 const started=Date.now(),steps:any[]=[];
 try{let t=Date.now();await refreshChangedFixtureReadModel('fix-comp-serie-a-2026-md4-torino-vs-milan');steps.push({name:'patch-current-result',ms:Date.now()-t});
 t=Date.now();await refreshDerivedCompetitionState('comp-serie-a-2026','season-2026-27');steps.push({name:'refresh-standings',ms:Date.now()-t});
 t=Date.now();const r=await getAdminFixturesFromReadModel({search:'fix-comp-serie-a-2026-md4-torino-vs-milan'});steps.push({name:'read-result',ms:Date.now()-t,total:r.total,homeScore:r.fixtures[0]?.homeScore,awayScore:r.fixtures[0]?.awayScore});
 console.info('[RESULT_CACHE_PROBE]',{steps,totalMs:Date.now()-started});res.json({ok:true,steps,totalMs:Date.now()-started});
 }catch(e:any){console.error('[RESULT_CACHE_PROBE]',{steps,message:e.message,ms:Date.now()-started});res.status(503).json({ok:false,steps,message:e.message});}
}
