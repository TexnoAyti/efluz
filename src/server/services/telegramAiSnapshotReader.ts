import { getFreshKey, getLkgKey, getDirtyKey, type ReadModelSnapshot } from '../readModel/readModelStore';
import { getAiRedisClient } from './telegramAiDeadline';
import {readPostgresSnapshotBundle} from '../readModel/postgresSnapshots';

export interface AiSnapshot<T> { data:T[]; stale:boolean; available:boolean; snapshotAt:string; }
const missing = ():AiSnapshot<any> => ({data:[],stale:true,available:false,snapshotAt:''});
/** Request-local memo and batched Redis transport. No Firestore scans or writes. */
export function createAiSnapshotReader(signal?:AbortSignal) {
  const client=getAiRedisClient(signal);
  const memo=new Map<string,AiSnapshot<any>>();
  const failed=new Set<string>();
  const decode=(raw:unknown):ReadModelSnapshot<any[]>|null=>{
    try {
      const s=typeof raw==='string'?JSON.parse(raw):raw;
      return s && typeof s==='object' && Array.isArray((s as any).data) ? s as ReadModelSnapshot<any[]> : null;
    } catch { return null; }
  };
  const load=async(keys:string[])=>{
    const pending=[...new Set(keys)].filter(k=>!memo.has(k));
    if(!pending.length)return;
    if(process.env.DATABASE_PROVIDER==='supabase'){
      await Promise.all(pending.map(async key=>{
        if(signal?.aborted){memo.set(key,missing());return;}
        try{
          const bundle=await readPostgresSnapshotBundle(getFreshKey(key),getLkgKey(key),getDirtyKey(key));
          if(signal?.aborted){memo.set(key,missing());return;}
          const fresh=decode(bundle.fresh),lkg=decode(bundle.lkg);
          const snapshot=fresh&&!bundle.dirty?fresh:lkg;
          memo.set(key,snapshot?{data:snapshot.data,stale:Boolean(bundle.dirty||!fresh||snapshot.stale||snapshot.degraded),available:true,snapshotAt:snapshot.generatedAt||''}:missing());
        }catch{memo.set(key,missing());failed.add(key);}
      }));
      return;
    }
    if(!client || signal?.aborted){pending.forEach(k=>memo.set(k,missing()));return;}
    try{
      const raw=await client.mget<unknown[]>(...pending.flatMap(k=>[getFreshKey(k),getDirtyKey(k)]));
      const fallback:string[]=[];
      pending.forEach((key,i)=>{
        const fresh=decode(raw[i*2]);
        if(fresh && !raw[i*2+1])memo.set(key,{data:fresh.data,stale:Boolean(fresh.stale||fresh.degraded),available:true,snapshotAt:fresh.generatedAt||''});
        else fallback.push(key);
      });
      if(fallback.length){
        const rawLkg=await client.mget<unknown[]>(...fallback.map(getLkgKey));
        fallback.forEach((key,i)=>{
          const snapshot=decode(rawLkg[i]);
          memo.set(key,snapshot?{data:snapshot.data,stale:true,available:true,snapshotAt:snapshot.generatedAt||''}:missing());
        });
      }
    }catch{pending.forEach(k=>{if(!memo.has(k))memo.set(k,missing());failed.add(k);});}
  };
  return {load,read:async<T>(key:string):Promise<AiSnapshot<T>>=>{await load([key]);return memo.get(key)||missing();},
    snapshotStatus:()=>[...memo].map(([key,s])=>({key,available:s.available,stale:s.stale,snapshotAt:s.snapshotAt})),
    missingKeys:()=>[...memo].filter(([,s])=>!s.available).map(([k])=>k),failedKeys:()=>[...failed]};
}
