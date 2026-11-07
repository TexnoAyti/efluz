import { getFreshKey, getLkgKey, getDirtyKey, getRawDatasetKey, readThroughReadModel, buildCompetitionsSnapshot, buildClubsSnapshot, buildStandingsSnapshot, getPostgresFixtureReadModel, type ReadModelSnapshot } from '../readModel/readModelStore';
import { getAiRedisClient, withinAiDeadline } from './telegramAiDeadline';
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
  const refreshPostgres = async (key: string): Promise<AiSnapshot<any> | null> => {
    const raw = getRawDatasetKey(key);
    const match = raw.match(/^season:([^:]+):(.+)$/);
    if (!match) return null;
    const [,seasonId,dataset] = match;
    let result;
    if (dataset === 'admin:fixtures' || /^competition:[^:]+:fixtures$/.test(dataset)) {
      const competitionId=dataset === 'admin:fixtures' ? undefined : dataset.split(':')[1];
      result = await getPostgresFixtureReadModel(seasonId, competitionId);
      // General Mini App reads may omit the optional override query to protect
      // page latency. The AI must never reason from a corrected result that is
      // missing in its cache: query only this isolated AI read scope.
      const {getFirestoreDb}=await import('../firebase/admin');
      let query=getFirestoreDb().collection('durable_fixture_overrides').where('seasonId','==',seasonId);
      if(competitionId)query=query.where('competitionId','==',competitionId);
      const overrides=await query.get();
      const deltas=new Map(overrides.docs.map(doc=>[doc.id,{...doc.data(),id:doc.id}]));
      let missed=false;
      const known=new Set(result.data.map((row:any)=>row.id));
      for(const id of deltas.keys())if(!known.has(id))missed=true;
      result={...result,
        data:result.data.map((row:any)=>{
          const patch=deltas.get(row.id) as any;
          return patch&&(!row.updatedAt||!patch.updatedAt||patch.updatedAt>=row.updatedAt)
            ? {...row,...patch}:row;
        }),
        stale:result.stale||missed,degraded:result.degraded||missed
      };
    } else {
      const build = dataset === 'competitions' ? () => buildCompetitionsSnapshot(seasonId)
        : dataset === 'clubs-with-owners' ? () => buildClubsSnapshot(seasonId)
        : /^competition:[^:]+:standings$/.test(dataset) ? () => buildStandingsSnapshot(dataset.split(':')[1], seasonId) : null;
      if (!build) return null;
      result = await readThroughReadModel<any[]>({key, seasonId, firestoreFetcher: async () => (await build()).data, validateData: Array.isArray});
    }
    return {data: result.data, stale: Boolean(result.stale || result.degraded), available: true, snapshotAt: result.generatedAt};
  };
  const load=async(keys:string[])=>{
    const pending=[...new Set(keys)].filter(k=>!memo.has(k));
    if(!pending.length)return;
    if(process.env.DATABASE_PROVIDER==='supabase'){
      await Promise.all(pending.map(async key=>{
        if(signal?.aborted){memo.set(key,missing());return;}
        try{
          const bundle=await withinAiDeadline(signal, () => readPostgresSnapshotBundle(getFreshKey(key),getLkgKey(key),getDirtyKey(key)));
          if(signal?.aborted){memo.set(key,missing());return;}
          const fresh=decode(bundle.fresh),lkg=decode(bundle.lkg);
          const snapshot=fresh&&!bundle.dirty?fresh:lkg;
          const cached = snapshot?{data:snapshot.data,stale:Boolean(bundle.dirty?.data||!fresh||snapshot.stale||snapshot.degraded),available:true,snapshotAt:snapshot.generatedAt||''}:missing();
          memo.set(key,cached);
          // Fixture corrections may be stored as newer durable deltas even while
          // the cached base snapshot is considered fresh. Never supply the base
          // snapshot to AI without checking those committed overrides.
          const isFixtureFeed=/^season:[^:]+:(?:admin:fixtures|competition:[^:]+:fixtures)$/.test(getRawDatasetKey(key));
          if (cached.stale || !cached.available || isFixtureFeed) {
            try {
              const refreshed = await withinAiDeadline(signal, () => refreshPostgres(key));
              if (refreshed && !signal?.aborted) memo.set(key,refreshed);
              else if (isFixtureFeed) memo.set(key,{...cached,stale:true});
            } catch {
              failed.add(key);
              if (isFixtureFeed) memo.set(key,{...cached,stale:true});
            } // Preserve the cached data but honestly mark uncertain fixture freshness.
          }
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
