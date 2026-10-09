import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDocumentStore } from '../postgres/documentStore';
import { authorizeExport } from '../migration/serverExport';

// Bundled only into a temporary, authenticated preview; never mounted on the app.
export function runtimeProbe(expectedHash:string,expiresAt:number){
 return async(req:any,res:any)=>{
  res.setHeader('Cache-Control','no-store');
  if(!authorizeExport(req.method,req.headers.authorization||'',expectedHash,expiresAt,process.env.VERCEL_ENV||'')){
   res.statusCode=403;res.end(JSON.stringify({error:'PROBE_DISABLED'}));return;
  }
  process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
  const db=new PostgresDocumentStore(undefined,'preview');
  const id='pg-probe-'+randomUUID(),col=db.collection('runtime_probes');
  const claim=col.doc(id+'-claim'),ticket=col.doc(id+'-ticket');
  const cleanup=[claim,ticket];
  let outcome:any={status:'FAILED',reason:'POSTGRES_PROBE_FAILED'};
  try{
   const clubs=await db.collection('clubs').where('leagueId','==','league-premier-league').get();assert.equal(clubs.size,20);
   const first=await db.collection('users').orderBy('__name__').limit(10).get();
   const next=await db.collection('users').orderBy('__name__').startAfter(first.docs.at(-1)!).limit(10).get();
   assert.equal(first.size,10);assert.equal(next.size,10);assert.ok(!next.docs.some(d=>first.docs.some(a=>a.id===d.id)));
   const claims=await Promise.allSettled([1,2,3,4].map(owner=>db.runTransaction(async tx=>{
    const prior=await tx.get(claim);if(prior.exists)throw new Error('CLUB_TAKEN');tx.create(claim,{owner});return owner;
   })));
   assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
   await ticket.set({balance:1,nested:{a:1,b:2}});
   await ticket.set({nested:{a:3}},{merge:true});assert.deepEqual((await ticket.get()).data()?.nested,{a:3,b:2});
   await ticket.update({'nested.b':4});assert.equal((await ticket.get()).get('nested.b'),4);
   const spends=await Promise.allSettled([1,2].map(()=>db.runTransaction(async tx=>{
    const prior=await tx.get(ticket);if(prior.data().balance<1)throw new Error('NO_TICKET');tx.update(ticket,{balance:prior.data().balance-1});return true;
   })));
   assert.equal(spends.filter(r=>r.status==='fulfilled').length,1);assert.equal((await ticket.get()).get('balance'),0);
   const before=(await ticket.get()).get('balance');
   await assert.rejects(db.batch().update(ticket,{balance:99}).create(claim,{owner:99}).commit());
   assert.equal((await ticket.get()).get('balance'),before,'failed batch must roll back every write');
   const service=await import('../services/customTournamentTicketService');
   const userId=id+'-user',tournamentId=id+'-tournament';
   const account=db.collection('user_tickets').doc(userId);cleanup.push(account);
   await account.set({userId,telegramId:'0',balance:1,totalGranted:1,totalSpent:0,totalRefunded:0,updatedAt:new Date().toISOString()});
   const key=id+'-spend';cleanup.push(db.collection('ticket_transactions_idempotency').doc(key));
   const results=await Promise.all([1,2].map(()=>service.spendTicketForTournament({userId,tournamentId,idempotencyKey:key})));
   assert.equal(results[0].transactionId,results[1].transactionId);assert.equal((await account.get()).get('balance'),0);
   const transactions=await db.collection('ticket_transactions').where('userId','==',userId).get();assert.equal(transactions.size,1);
   cleanup.push(...transactions.docs.map(d=>d.ref));
   // Discover service-generated deduplication IDs by the synthetic tournament.
   outcome={status:'PASS',checks:['real_catalog','pagination','concurrent_club_claim','concurrent_ticket_spend','nested_merge','dotted_update','batch_rollback','real_ticket_service_idempotency']};
  }catch(error:any){console.error('[PG_PROBE] Failed',error?.message?.slice(0,100));res.statusCode=500;}
  finally{try{const batch=db.batch();cleanup.forEach(ref=>batch.delete(ref));await batch.commit();}catch{res.statusCode=500;outcome={status:'FAILED',reason:'PROBE_CLEANUP_FAILED'};}}
  res.end(JSON.stringify(outcome));
 };
}
