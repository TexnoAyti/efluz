import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { getFirestoreDb } from '../firebase/admin';
import { buildAdminFixturesSnapshot, getAdminClubsFromReadModel, getAdminFixturesFromReadModel } from '../readModel/readModelStore';
import { refreshRecipientDirectoryIfStale } from '../services/recipientDirectoryRefreshService';
import { getSafeEligibleRecipients } from '../services/telegramNotificationQueue';
export async function productionReadProbe(req: Request, res: Response) {
 if (Date.now()>1791552733842 || createHash('sha256').update(String(req.headers['x-read-probe']||'')).digest('hex')!=='5e7c2ce8c212bb0c80cccd279adbf4fe8d6ccb01d6159ceb72873bc6915fadd8') {res.sendStatus(404);return;}
 const steps:any[]=[];
 const step=async(name:string,fn:()=>Promise<any>)=>{const start=Date.now();try{const value=await fn();steps.push({name,ms:Date.now()-start,value});console.info('[PRODUCTION_READ_PROBE]',steps.at(-1));}catch(error:any){steps.push({name,ms:Date.now()-start,error:error?.message});console.error('[PRODUCTION_READ_PROBE]',steps.at(-1));throw error;}};
 try {
  await step('users-count',async()=> (await getFirestoreDb().collection('users').count().get()).data().count);
  await step('admin-clubs',async()=> {const r=await getAdminClubsFromReadModel();return {total:r.total,degraded:r.degraded};});
  if(req.body?.refresh===true) await step('admin-fixtures-refresh',async()=>{const r=await buildAdminFixturesSnapshot('season-2026-27',false);return {total:r.actualCount};});
  await step('admin-fixtures',async()=> {const r=await getAdminFixturesFromReadModel({limit:25});return {total:r.total,page:r.fixtures.length,degraded:r.degraded};});
  await step('recipients',async()=> {await refreshRecipientDirectoryIfStale();return (await getSafeEligibleRecipients()).length;});
  res.json({ok:true,steps});
 }catch{res.status(503).json({ok:false,steps});}
}
