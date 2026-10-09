import {createHash} from 'node:crypto';
import type {Request,Response} from 'express';
import {PostgresDocumentStore} from '../postgres/documentStore';
export async function resultCacheProbe(req:Request,res:Response){
 if(Date.now()>1791556173194||createHash('sha256').update(String(req.headers['x-result-probe']||'')).digest('hex')!=='3172c5229c1ecbc1ee4c9fd3a924208ef6e76f673a404da786f70b103fc7087c'){res.sendStatus(404);return;}
 const db=new PostgresDocumentStore(undefined,'preview');const started=Date.now();
 const ids=Array.from({length:4},(_,i)=>'result-ack-probe-'+i);
 try{const batch=db.batch();for(const id of ids)batch.set(db.collection('runtime_settings').doc(id),{id,updatedAt:new Date().toISOString(),fixtureId:'private-probe',homeScore:0,awayScore:0,status:'CONFIRMED',note:'x'.repeat(500)});await batch.commit();const ms=Date.now()-started;
 const cleanup=db.batch();for(const id of ids)cleanup.delete(db.collection('runtime_settings').doc(id));await cleanup.commit();
 console.info('[RESULT_ACK_BATCH_PROBE]',{ms});res.json({ok:true,atomicBatchMs:ms});
 }catch(e:any){res.status(503).json({ok:false,message:e.message});}
}
