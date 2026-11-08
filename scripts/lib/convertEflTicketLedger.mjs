// Offline, private ticket snapshot projection; never grants or spends tickets.
// Transaction and balance rows are both retained, without deriving balances
// from transactions (legacy free allocations and admin adjustments differ).
const nonempty=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const count=x=>Number.isSafeInteger(x)&&x>=0;
const when=x=>{
 if(x==null||x==='')return null;
 if(typeof x==='number'&&Number.isSafeInteger(x)&&x>=0)
  return x>1e11?x:x*1000;
 if(typeof x==='string'){
  const value=Date.parse(x);
  if(Number.isSafeInteger(value)&&value>=0)return value;
 }
 throw Error('INVALID_TICKET_TIMESTAMP');
};
const source=(collections,kind)=>{
 const rows=collections[kind]??[];
 if(!Array.isArray(rows))throw Error('INVALID_TICKET_COLLECTION');
 const result=new Map();
 for(const row of rows){
  if(!row||!nonempty(row.document_id)||!row.data||
    typeof row.data!=='object'||Array.isArray(row.data)||
    result.has(row.document_id))throw Error('INVALID_TICKET_SOURCE');
  result.set(row.document_id,row.data);
 }
 return result;
};
export function convertEflTicketLedger(collections){
 const users=source(collections,'users');
 const accounts=source(collections,'user_tickets');
 const transactions=source(collections,'ticket_transactions');
 const userBalances=[],ticketTransactions=[];
 const owned=new Set(),keys=new Set();
 for(const [id,d] of accounts){
  const user=users.get(d.userId);
  if(!user||!nonempty(d.userId))throw Error('TICKET_BALANCE_USER_MISSING');
  if(!nonempty(d.telegramId)||String(user.telegramId)!==d.telegramId)
   throw Error('TICKET_BALANCE_TELEGRAM_CONFLICT');
  if(owned.has(d.userId))throw Error('DUPLICATE_TICKET_ACCOUNT');
  owned.add(d.userId);
  if(![d.balance,d.totalGranted,d.totalSpent,d.totalRefunded].every(count))
   throw Error('INVALID_TICKET_BALANCE');
  userBalances.push({
   id,user_id:d.userId,telegram_id:d.telegramId,
   balance:d.balance,total_granted:d.totalGranted,
   total_spent:d.totalSpent,total_refunded:d.totalRefunded,
   free_ticket_granted_at:when(d.freeTicketGrantedAt),
   updated_at:when(d.updatedAt)??0
  });
 }
 for(const [id,d] of transactions){
  if(!nonempty(d.id)||d.id!==id)throw Error('TICKET_TRANSACTION_ID_CONFLICT');
  if(!nonempty(d.userId)||!users.has(d.userId))
   throw Error('TICKET_TRANSACTION_USER_MISSING');
  if(!count(d.amount))throw Error('INVALID_TICKET_TRANSACTION_AMOUNT');
  if(!['GRANT','SPEND','REFUND'].includes(d.type))
   throw Error('INVALID_TICKET_TRANSACTION_TYPE');
  if(!nonempty(d.idempotencyKey))throw Error('TICKET_IDEMPOTENCY_MISSING');
  if(keys.has(d.idempotencyKey))throw Error('DUPLICATE_TICKET_IDEMPOTENCY');
  keys.add(d.idempotencyKey);
  ticketTransactions.push({
   id,user_id:d.userId,type:d.type,amount:d.amount,
   idempotency_key:d.idempotencyKey,
   note:d.note==null?null:String(d.note),
   performed_by_admin_id:d.performedByAdminId??null,
   tournament_id:d.tournamentId??null,created_at:when(d.createdAt)??0
  });
 }
 return {rows:{ticketBalances:userBalances,ticketTransactions},
  report:{ticketBalances:userBalances.length,
   ticketTransactions:ticketTransactions.length,
   historicalBalanceRecalculated:false,writeEnabled:false,cutoverReady:false}};
}
