// Shadow-only historical TEAMS creation-ticket balances and transactions.
// Never recompute a balance from the partial transaction history and never
// grant, spend, revoke or replay a historical ticket.
const valid=x=>typeof x==='string'&&x.length>0&&x.length<=240;
const count=x=>Number.isSafeInteger(x)&&x>=0;
const timestamp=x=>{
 if(typeof x!=='string')throw Error('INVALID_TEAM_TICKET_TIME');
 const n=Date.parse(x);
 if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_TEAM_TICKET_TIME');
 return n;
};
function docs(source,root){
 const list=source[root]??[],seen=new Set();
 if(!Array.isArray(list))throw Error('INVALID_TEAM_TICKET_SOURCE');
 return list.map(doc=>{
  if(!doc||!valid(doc.document_id)||seen.has(doc.document_id)||
     !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data))
   throw Error('INVALID_TEAM_TICKET_DOCUMENT');
  seen.add(doc.document_id);
  return {id:doc.document_id,d:doc.data};
 });
}
export function convertEflTeamTicketLedger(source){
 const users=new Set((source.users??[]).map(doc=>doc.document_id));
 const balances=docs(source,'team_creation_tickets').map(({id,d})=>{
  if(d.userId!==id||!users.has(id)||!count(d.balance)||
     !count(d.totalGranted)||!count(d.totalRevoked)||!count(d.totalSpent))
   throw Error('TEAM_TICKET_BALANCE_INVALID');
  return {id,user_id:d.userId,balance:d.balance,total_granted:d.totalGranted,
   total_revoked:d.totalRevoked,total_spent:d.totalSpent,
   updated_at:timestamp(d.updatedAt)};
 });
 const transactions=docs(source,'team_ticket_transactions').map(({id,d})=>{
  if(d.id!==undefined&&d.id!==id)throw Error('TEAM_TICKET_TRANSACTION_ID_CONFLICT');
  if(!valid(d.userId)||!users.has(d.userId)||
     !valid(d.kind)||!count(d.amount)||
     !valid(d.actorId)||typeof d.note!=='string'&&d.note!==undefined)
   throw Error('TEAM_TICKET_TRANSACTION_INVALID');
  return {id,user_id:d.userId,type:d.kind,amount:d.amount,
   actor_id:d.actorId,team_id:typeof d.teamId==='string'?d.teamId:null,
   note:typeof d.note==='string'?d.note:null,
   created_at:timestamp(d.createdAt)};
 });
 const idempotency=docs(source,'ticket_transactions_idempotency').map(({id,d})=>{
  if(!valid(d.userId)||!users.has(d.userId)||
     !valid(d.transactionId)||!valid(d.tournamentId))
   throw Error('TICKET_IDEMPOTENCY_INVALID');
  return {id,user_id:d.userId,transaction_id:d.transactionId,
   tournament_id:d.tournamentId,created_at:timestamp(d.createdAt)};
 });
 return {rows:{teamTicketBalances:balances,
  teamTicketTransactions:transactions,ticketIdempotencyHistory:idempotency},
  report:{balances:balances.length,transactions:transactions.length,
   idempotencyRecords:idempotency.length,balanceRecomputed:false,
   transactionsReplayed:false,cutoverReady:false}};
}
