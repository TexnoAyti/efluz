import {Router} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {scheduleUNotices,prepareUNotifications} from '../services/uzeflifeNotifications';
import {drainNotificationQueue} from '../services/telegramNotificationQueue';
export function createUzeflifeWorkerRouter(initialize:()=>Promise<void>){const uzeflifeWorkerRouter=Router();
uzeflifeWorkerRouter.post('/',async(req,res)=>{
 const secret=process.env.UZEFLIFE_WORKER_SECRET,actual=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+(secret||''));
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.sendStatus(401);return;}
 if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE!=='production'){res.sendStatus(503);return;}
 try{await initialize();if(process.env.VERCEL==='1'){scheduleUNotices();res.status(202).json({accepted:true});return;}await prepareUNotifications();await drainNotificationQueue({hop:1});res.json({ok:true});}catch{res.status(503).json({error:'UZEFLIFE_WORKER_DEFERRED'});}
});

return uzeflifeWorkerRouter;}
