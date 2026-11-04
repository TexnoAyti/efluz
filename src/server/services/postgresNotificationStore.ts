import {createHash} from 'node:crypto';
import {runtimeRpc, type RuntimeRpc} from '../postgres/documentStore';
import {Redis} from '@upstash/redis';
import {getFirestoreDb, getFirebaseStatus} from '../firebase/admin';
import {getUpstashClient} from '../readModel/readModelStore';
import {PostgresAiStore} from './postgresAiStore';

const parse=(value:any)=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return value;}};
class LegacyNotificationStore extends PostgresAiStore {
 // These are opaque Redis-compatible payloads: field-level database queries are
 // never used. A JSON string avoids recursively tagging/decoding every receipt
 // whenever one job changes. Existing object rows remain readable via parse().
 protected storedValue(value:any):any{return value!==null&&typeof value==='object'?JSON.stringify(value):value;}

 async get<T=any>(key:string):Promise<T|null>{
  const season=key.match(/:private:recipient-directory:([^:]+)$/)?.[1];
  if(!season)return super.get<T>(key);
  return (await getFirestoreDb().collection('runtime_settings').doc('recipient-directory-'+season).get()).data()?.entries||null;
 }
 async hget<T=any>(key:string,field:string):Promise<T|null>{return (await super.get<any>(key))?.[field]||null;}
 async hgetall<T=any>(key:string):Promise<T|null>{return super.get<T>(key);}
 async hexists(key:string,field:string):Promise<number>{return Number(Object.hasOwn((await super.get<any>(key))||{},field));}
 async hset(key:string,fields:Record<string,any>){return this.atomic([key],(values,put)=>{put(key,{...(parse(values.get(key)?.value)||{}),...fields});return Object.keys(fields).length;});}
 async hdel(key:string,field:string){return this.atomic([key],(values,put)=>{const hash={...(parse(values.get(key)?.value)||{})};const exists=field in hash;delete hash[field];put(key,hash);return Number(exists);});}
 async rpush(key:string,value:any){return this.atomic([key],(values,put)=>{const queue=[...(parse(values.get(key)?.value)||[]),parse(value)];put(key,queue);return queue.length;});}
 async eval<TArgs extends unknown[]=unknown[],TResult=any>(script:string,keys:string[],args:TArgs):Promise<TResult>{
  // Queue inspection is read-only: no optimistic write transaction or CAS retry.
  if(script.includes('EFL_NOTIFY_PENDING_V1')){
   const jobs=await super.get<any[]>(keys[0])||[];
   return {pending:jobs.length,nextAt:jobs.length?Math.min(...jobs.map((job:any)=>Number(job.availableAt)||0)):0} as TResult;
  }
  return this.atomic(keys,(values,put)=>{
   const get=(key:string)=>parse(values.get(key)?.value);
   if(script.includes('EFL_NOTIFY_ENQUEUE_V1')){
    const records=get(keys[0])||{};if(records[String(args[0])])return records[String(args[0])];
    const record=parse(args[1]);put(keys[0],{...records,[String(args[0])]:record});put(keys[1],[...(get(keys[1])||[]),...parse(args[2])]);return record;
   }
   if(script.includes('EFL_NOTIFY_SMART_ENQUEUE_V1')){
    const records=get(keys[1])||{};if(records[String(args[1])])return 0;if(values.has(keys[0]))return -1;
    put(keys[0],1,Number(args[0]));put(keys[1],{...records,[String(args[1])]:parse(args[2])});put(keys[2],[...(get(keys[2])||[]),parse(args[3])]);return 1;
   }
   if(script.includes('EFL_NOTIFY_CLAIM_V1')){
    if(get(keys[2])!==args[0])return null;
    const queue=get(keys[0])||[];const index=queue.findIndex((job:any)=>Number(job.availableAt||0)<=Number(args[1]));
    if(index<0)return null;
    const job={...queue[index],claimedAt:Number(args[1])};
    put(keys[0],[...queue.slice(0,index),...queue.slice(index+1)]);put(keys[1],{...(get(keys[1])||{}),[job.jobId]:job});return job;
   }
   if(script.includes('EFL_NOTIFY_RELEASE_V1')){
    if(get(keys[0])!==args[0])return 0;
    put(keys[0],null,0);return 1;
   }
   throw Error('UNSUPPORTED_POSTGRES_NOTIFICATION_OPERATION');
  }) as Promise<TResult>;
 }
}

/** Native PostgreSQL transitions have no read/write CAS gap. The legacy adapter
 * remains for the isolated in-memory document tests only. Production never
 * falls back after an RPC error. */
export class PostgresNotificationStore extends LegacyNotificationStore {
 constructor(private notificationRpc?: RuntimeRpc) { super(); }
 private native(){return Boolean(this.notificationRpc)||getFirebaseStatus().authMode==='supabase';}
 private call<T=any>(action:string,keys:string[],args:any[]):Promise<T>{
  return (this.notificationRpc||runtimeRpc())('efl_runtime_notification',{
   p_space:this.notificationRpc?process.env.SUPABASE_DATA_NAMESPACE:getFirestoreDb().databaseId,p_action:action,
   p_ids:keys.map(key=>createHash('sha256').update(key).digest('hex')),p_args:args,
  });
 }
 async set(key:string,value:any,options?:{nx?:boolean;ex?:number}){
  if(!this.native()||!options?.nx)return super.set(key,value,options);
  if(options.ex!==undefined&&(!Number.isFinite(options.ex)||options.ex<=0))throw Error('INVALID_STATE_TTL');
  return this.call('nx',[key],[value,options.ex??null]);
 }
 async hget<T=any>(key:string,field:string):Promise<T|null>{return this.native()?this.call('hget',[key],[field]):super.hget<T>(key,field);}
 async hgetall<T=any>(key:string):Promise<T|null>{return super.get<T>(key);}
 async hexists(key:string,field:string):Promise<number>{return Number(await this.hget(key,field)!==null);}
 async hset(key:string,fields:Record<string,any>){return this.native()?this.call('hset',[key],[fields]):super.hset(key,fields);}
 async hdel(key:string,field:string){return this.native()?this.call('hdel',[key],[field]):super.hdel(key,field);}
 async rpush(key:string,value:any){return this.native()?this.call('rpush',[key],[parse(value)]):super.rpush(key,value);}
 async eval<TArgs extends unknown[]=unknown[],TResult=any>(script:string,keys:string[],args:TArgs):Promise<TResult>{
  if(!this.native())return super.eval<TArgs,TResult>(script,keys,args);
  if(script.includes('EFL_NOTIFY_PENDING_V1'))return this.call('pending',keys,[]);
  if(script.includes('EFL_NOTIFY_ENQUEUE_V1'))return this.call('enqueue',keys,[args[0],parse(args[1]),parse(args[2])]);
  if(script.includes('EFL_NOTIFY_SMART_ENQUEUE_V1'))return this.call('smart_enqueue',keys,[args[0],args[1],parse(args[2]),parse(args[3])]);
  if(script.includes('EFL_NOTIFY_CLAIM_V1'))return this.call('claim',keys,args);
  if(script.includes('EFL_NOTIFY_RELEASE_V1'))return this.call('release',keys,args);
  throw Error('UNSUPPORTED_POSTGRES_NOTIFICATION_OPERATION');
 }
}
export function getNotificationStore():Redis|null{
 return process.env.DATABASE_PROVIDER==='supabase'?new PostgresNotificationStore() as unknown as Redis:getUpstashClient();
}
