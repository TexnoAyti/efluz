#!/usr/bin/env node
// Private, read-only ticket ledger reconciliation. Never prints user IDs,
// ledger IDs, raw source documents, transaction notes or Telegram identities.
// Passing this audit alone does NOT authorize balance mutation or cutover.
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
const source=process.argv[2];
if(!source){console.error('Usage: node scripts/auditEflTicketLedger.mjs private-source.jsonl');process.exit(2);}
const users=new Map(),balances=new Map(),transactions=new Map(),idempotency=new Set();
const errors={};
const issue=code=>{errors[code]=(errors[code]??0)+1;};
const isId=x=>typeof x==='string'&&x.length>0&&x.length<=256;
const isCount=x=>Number.isSafeInteger(x)&&x>=0;
for await(const line of createInterface({input:createReadStream(source,{encoding:'utf8'}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const doc=JSON.parse(line);
 if(!doc||doc.space!=='production'||!isId(doc.collection_path)||
  !isId(doc.document_id)||!doc.data||typeof doc.data!=='object'||
  Array.isArray(doc.data))throw Error('INVALID_TICKET_SOURCE_DOCUMENT');
 const type=doc.collection_path;
 if(!['users','user_tickets','ticket_transactions'].includes(type))continue;
 const id=doc.document_id,d=doc.data;
 if(type==='users'){
  if(users.has(id))issue('DUPLICATE_USER_SOURCE');
  users.set(id,d);
 }else if(type==='user_tickets'){
  if(balances.has(id))issue('DUPLICATE_BALANCE_SOURCE');
  balances.set(id,d);
 }else{
  if(transactions.has(id))issue('DUPLICATE_TRANSACTION_SOURCE');
  transactions.set(id,d);
 }
}
const balanceOwners=new Set();
for(const [id,d] of balances){
 if(!isId(d.userId)||!users.has(d.userId))issue('BALANCE_WITHOUT_USER');
 if(!isCount(d.balance)||!isCount(d.totalGranted)||
  !isCount(d.totalSpent)||!isCount(d.totalRefunded))
  issue('INVALID_BALANCE_COUNTER');
 if(!isId(d.telegramId)||String(users.get(d.userId)?.telegramId??'')!==String(d.telegramId))
  issue('BALANCE_TELEGRAM_MISMATCH');
 if(balanceOwners.has(d.userId))issue('DUPLICATE_USER_BALANCE');
 balanceOwners.add(d.userId);
}
const types={};
for(const [id,d] of transactions){
 if(!isId(d.id)||d.id!==id)issue('TRANSACTION_ID_MISMATCH');
 if(!isId(d.userId)||!users.has(d.userId))issue('TRANSACTION_WITHOUT_USER');
 if(!isCount(d.amount))issue('INVALID_TRANSACTION_AMOUNT');
 if(!['GRANT','SPEND','REFUND'].includes(d.type))issue('UNKNOWN_TRANSACTION_TYPE');
 if(!isId(d.idempotencyKey))issue('MISSING_IDEMPOTENCY_KEY');
 else{
  if(idempotency.has(d.idempotencyKey))issue('DUPLICATE_IDEMPOTENCY_KEY');
  idempotency.add(d.idempotencyKey);
 }
 types[String(d.type??'UNKNOWN')]=(types[String(d.type??'UNKNOWN')]??0)+1;
}
const result={ok:Object.keys(errors).length===0,readOnly:true,
 users:users.size,balances:balances.size,transactions:transactions.size,
 transactionTypes:types,errorsByType:errors,cutoverReady:false,
 note:'Does not reconstruct balances from transactions: grants, refunds, free entitlements and historical snapshots require separate policy parity.'};
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
