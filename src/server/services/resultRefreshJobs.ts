import {getFirestoreDb} from '../firebase/admin';

/** These jobs contain no pending score writes: the result, audit and visible
 * fixture delta are already committed atomically before the API acknowledges. */
export async function processPendingResultRefresh(): Promise<void> {
 if(process.env.DATABASE_PROVIDER!=='supabase'||process.env.MIGRATION_WRITE_FREEZE==='true') return;
 const db=getFirestoreDb();
 const jobs=await db.collection('result_refresh_jobs').where('status','==','pending').where('leaseUntil','<=',Date.now()).limit(1).get();
 for(const item of jobs.docs){
  const job=await db.runTransaction(async tx=>{
   const current=(await tx.get(item.ref)).data();
   if(!current||current.leaseUntil>Date.now())return null;
   tx.update(item.ref,{leaseUntil:Date.now()+90000});return current;
  });
  if(!job)continue;
  try{
   const store=await import('../firebase/firestoreStore');
   const current=(await db.collection('fixtures').doc(job.fixtureId).get()).data();
   if(current){
    const {upsertFixtureToSqlite}=await import('../db');upsertFixtureToSqlite({id:job.fixtureId,...current} as any);
    if(current.winnerClubId&&current.status==='CONFIRMED'){
     const {advanceKnockoutWinnerFirestore}=await import('../tournament/knockoutEngine');await advanceKnockoutWinnerFirestore(job.fixtureId);
    }
    await store.rebuildCompetitionStandingsFirestore(current.competitionId);
    const materialized=(await db.collection('standings').doc(current.competitionId).get()).data();
    if(!materialized?.updatedAt||materialized.updatedAt<job.version)throw new Error('RESULT_STANDINGS_REFRESH_PENDING');
    const {refreshChangedFixtureReadModel}=await import('../readModel/readModelStore');await refreshChangedFixtureReadModel(job.fixtureId);
    const {refreshDerivedCompetitionState}=await import('./fixtureTombstoneService');await refreshDerivedCompetitionState(current.competitionId,current.seasonId);
   }
   await db.runTransaction(async tx=>{const latest=(await tx.get(item.ref)).data();if(latest?.version===job.version)tx.delete(item.ref);});
   console.info('[RESULT_REFRESH_JOB_DONE]',{fixtureId:job.fixtureId});
  }catch(error:any){
   console.warn('[RESULT_REFRESH_JOB_RETAINED]',{fixtureId:job.fixtureId,message:error?.message});
   await db.runTransaction(async tx=>{const latest=(await tx.get(item.ref)).data();if(latest?.version===job.version)tx.update(item.ref,{leaseUntil:Date.now()+30000});}).catch(()=>{});
  }
 }
}
