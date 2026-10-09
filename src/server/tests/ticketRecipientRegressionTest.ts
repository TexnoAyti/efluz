import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {encodeValue,decodeValue} from '../migration/firestoreArchive';
import {getFirestoreDb,resetFirebaseAdminCache} from '../firebase/admin';
import {authMiddleware,requireAdmin} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {customTournamentTicketsRouter} from '../routes/customTournamentTickets.routes';
import {spendTicketForTournament} from '../services/customTournamentTicketService';
import {archiveCommunityMessage,communityFacts,communitySourceStats} from '../services/telegramAiCommunitySources';

// Real PostgreSQL adapter and service transactions, isolated RPC transport.
delete process.env.FIREBASE_FORCE_LOCAL_FALLBACK;
process.env.NODE_ENV='production';
process.env.DATABASE_PROVIDER='supabase';
process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.SUPABASE_URL='https://ticket.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-key';
process.env.SESSION_SECRET='isolated-ticket-auth-secret-32bytes';
resetFirebaseAdminCache();
let generation=0;
let rows=new Map<string,any>();
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input:any,init?:any)=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.origin!=='https://ticket.test.invalid')return originalFetch(input,init);
 const body=JSON.parse(init.body);
 if(url.pathname.endsWith('/efl_runtime_read')){
  const q=body.p_query;
  let documents=[...rows].filter(([path])=>q.path?path===q.path:path.split('/').slice(0,-1).join('/')===q.collection).map(([path,encoded])=>({id:path.split('/').at(-1)!,encoded}));
  for(const f of q.filters||[])documents=documents.filter(d=>decodeValue(d.encoded)[f.field]===f.value);
  if(q.limit)documents=documents.slice(0,q.limit);
  return Response.json({generation:String(generation),documents,count:documents.length});
 }
 if(url.pathname.endsWith('/efl_runtime_commit')){
  if(body.p_generation!==null&&body.p_generation!==String(generation))return Response.json({code:'40001'},{status:409});
  const next=new Map(rows);
  for(const op of body.p_operations){
   if(op.kind==='delete')next.delete(op.path);
   else next.set(op.path,op.merge||op.kind==='update'?encodeValue({...decodeValue(next.get(op.path)||encodeValue({})),...decodeValue(op.encoded)}):op.encoded);
  }
  rows=next;generation++;return Response.json({generation:String(generation)});
 }
 throw Error('UNEXPECTED_RPC');
};
const db=getFirestoreDb();
const user=(id:string,telegramId:string,isAdmin=false)=>({id,telegramId,isAdmin,isSuspended:false,username:'recipient',firstName:'Test',createdAt:'',updatedAt:''});
const owner=user('user-5209126900','5209126900',true),recipient=user('user-12345','12345'),other=user('user-222','222',true);
for(const u of [owner,recipient,other])await db.collection('users').doc(u.id).set(u);
const app=express();app.use(express.json());app.use(authMiddleware);
app.use('/api/admin/custom-tournaments/tickets',requireAdmin,customTournamentTicketsRouter);
app.use('/api/custom-tournaments/tickets',customTournamentTicketsRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+(server.address() as any).port;
const post=async(path:string,body:any,actor=owner)=>{
 const r=await fetch(base+'/api/admin/custom-tournaments/tickets/'+path,{method:'POST',headers:{authorization:'Bearer '+createSessionToken(actor),'content-type':'application/json'},body:JSON.stringify(body)});
 return {status:r.status,body:await r.json() as any};
};
try{
 const payload={targetUserId:'12345',amount:3,idempotencyKey:'ticket-regression'};
 const first=await post('grant',payload);assert.equal(first.status,200,JSON.stringify(first.body));
 assert.equal(first.body.account.userId,recipient.id);assert.equal(first.body.account.balance,3);
 assert.equal((await db.collection('user_tickets').doc('12345').get()).exists,false);
 assert.equal((await db.collection('ticket_transactions').doc(first.body.transactionId).get()).data()?.amount,3);
 const repeat=await post('grant',payload);assert.equal(repeat.body.account.balance,3);assert.equal(repeat.body.transactionId,first.body.transactionId);
 const conflict=await post('grant',{...payload,amount:4});assert.equal(conflict.status,409);
 assert.equal((await post('grant',{...payload,targetTelegramId:'999'})).status,400);
 assert.equal((await post('grant',{...payload,targetUserId:'missing'})).status,400);
 assert.equal((await post('grant',payload,other)).status,403);
 const balance=await fetch(base+'/api/custom-tournaments/tickets/balance',{headers:{authorization:'Bearer '+createSessionToken(recipient)}});
 assert.equal((await balance.json() as any).account.balance,3);
 const spend={userId:recipient.id,tournamentId:'ct-test',idempotencyKey:'publish-test'};
 assert.equal((await spendTicketForTournament(spend)).newBalance,2);
 assert.equal((await spendTicketForTournament(spend)).newBalance,2);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-test'})).body.newBalance,3);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-test'})).status,409);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-never-spent'})).status,404);
 assert.equal((await db.collection('user_tickets').doc(recipient.id).get()).data()?.balance,3);
 const message={message_id:42,date:Math.floor(Date.now()/1000),text:'Kubok yarim final',chat:{type:'channel',username:'efl_uz'}};
 await archiveCommunityMessage({...message,edit_date:message.date+1,text:'Kubok final'});
 await archiveCommunityMessage(message);
 assert.match(await communityFacts('efl_uz kubok'),/Kubok final/);
 assert.equal((await communitySourceStats())[0].count,1);
 console.log('PASS authenticated ticket grant, canonical recipient, visible balance, correct audit amount, retry dedupe/conflict, invalid recipient rejection, owner restriction, spend/retry/refund.');
}finally{server.close();globalThis.fetch=originalFetch;}
