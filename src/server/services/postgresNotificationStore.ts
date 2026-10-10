import {Redis} from '@upstash/redis';
import {getFirestoreDb} from '../firebase/admin';
import {getUpstashClient} from '../readModel/readModelStore';
import {PostgresAiStore} from './postgresAiStore';

const parse=(value:any)=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return value;}};
/** Queue and receipt changes share one PostgreSQL transaction. The worker's
 * existing lease and uncertain-delivery policy remain authoritative. */
export class PostgresNotificationStore extends PostgresAiStore {
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
  return this.atomic(keys,(values,put)=>{
   const get=(key:string)=>parse(values.get(key)?.value);
   if(script.includes('EFL_NOTIFY_PENDING_V1')){
    const jobs=get(keys[0])||[];return {pending:jobs.length,nextAt:jobs.length?Math.min(...jobs.map((job:any)=>Number(job.availableAt)||0)):0};
   }
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
export function getNotificationStore():Redis|null{
 return process.env.DATABASE_PROVIDER==='supabase'?new PostgresNotificationStore() as unknown as Redis:getUpstashClient();
}
