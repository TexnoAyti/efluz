import type { Fixture } from '../../types';
import { getFirestoreDb } from '../firebase/admin';
import { normalizeFixtureSnapshot, ReadModelNotWarmedError } from '../readModel/readModelStore';
import { filterRetiredFixtures } from './retiredFixtureService';

const pending=new Map<string,Promise<Fixture[]>>();
/** Read only the verified owner's clubs, rather than downloading the entire season.
 * No user-selected IDs enter this path: the route resolves membership first.
 * Coalesce simultaneous reads without keeping scores stale between requests. */
export async function readPostgresOwnedFixtures(seasonId:string,clubIds:string[]):Promise<Fixture[]> {
  const ids=[...new Set(clubIds)].sort();
  if(!ids.length)return [];
  const key=JSON.stringify([seasonId,ids]);
  const active=pending.get(key);if(active)return active;
  const work=(async()=>{
    const db=getFirestoreDb(),jobs:Promise<any>[]=[];
    for(let start=0;start<ids.length;start+=30)for(const side of ['homeClubId','awayClubId']){
      jobs.push(db.collection('fixtures').where('seasonId','==',seasonId).where(side,'in',ids.slice(start,start+30)).limit(1001).get());
    }
    const results=await Promise.all(jobs);
    if(results.some(result=>result.size>=1001))throw new ReadModelNotWarmedError('OWNED_FIXTURE_LIMIT_EXCEEDED');
    const selected=new Set(ids),rows=new Map<string,Fixture>();
    for(const result of results)for(const doc of result.docs){
      const row=normalizeFixtureSnapshot({...doc.data(),id:doc.id},seasonId);
      if(row.seasonId===seasonId&&(selected.has(row.homeClubId||'')||selected.has(row.awayClubId||'')))rows.set(row.id,row);
    }
    return filterRetiredFixtures([...rows.values()],seasonId);
  })();
  pending.set(key,work);
  try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}
}
