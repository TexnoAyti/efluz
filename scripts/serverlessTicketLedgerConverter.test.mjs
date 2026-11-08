import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflTicketLedger} from './lib/convertEflTicketLedger.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const doc=(document_id,data)=>({document_id,data});
function fixture(){
 return {
  users:[doc('u1',{telegramId:'123'}),doc('u2',{telegramId:'456'})],
  user_tickets:[doc('balance:u1',{userId:'u1',telegramId:'123',
   balance:2,totalGranted:4,totalSpent:2,totalRefunded:0,
   freeTicketGrantedAt:'2026-01-01T00:00:00Z',updatedAt:'2026-02-01T00:00:00Z'})],
  ticket_transactions:[doc('tx1',{id:'tx1',userId:'u1',type:'GRANT',
   amount:4,idempotencyKey:'unique:t1',createdAt:'2026-01-01T00:00:00Z'}),
   doc('tx2',{id:'tx2',userId:'u1',type:'SPEND',
   amount:2,idempotencyKey:'unique:t2',createdAt:'2026-01-02T00:00:00Z'})]
 };
}
test('ticket projection retains source amounts without mutating or recalculating balances',()=>{
 const source=fixture();
 const before=JSON.stringify(source);
 const result=convertEflTicketLedger(source);
 assert.equal(JSON.stringify(source),before);
 assert.equal(result.rows.ticketBalances.length,1);
 assert.equal(result.rows.ticketBalances[0].balance,2);
 assert.equal(result.rows.ticketTransactions.length,2);
 assert.equal(result.rows.ticketTransactions[1].amount,2);
 assert.equal(result.report.historicalBalanceRecalculated,false);
 assert.equal(result.report.writeEnabled,false);
 for(const [table,rows] of Object.entries(result.rows))
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows}));
});
test('ticket projection fails on orphan, duplicate, inconsistent and invalid transaction rows',()=>{
 for(const change of [
  d=>{d.user_tickets[0].data.userId='missing';},
  d=>{d.user_tickets[0].data.telegramId='invalid';},
  d=>{d.user_tickets[0].data.balance=-1;},
  d=>{d.ticket_transactions[1].data.idempotencyKey='unique:t1';},
  d=>{d.ticket_transactions[1].data.userId='missing';},
  d=>{d.ticket_transactions[1].data.amount=1.5;},
  d=>{d.ticket_transactions[1].data.type='UNSUPPORTED';},
  d=>{d.ticket_transactions[1].data.id='other';}
 ]){
  const source=fixture();change(source);
  assert.throws(()=>convertEflTicketLedger(source));
 }
});
test('ticket projection permits empty history but never fabricates balance for a user',()=>{
 const data=fixture();
 data.user_tickets=[];data.ticket_transactions=[];
 const result=convertEflTicketLedger(data);
 assert.deepEqual(result.rows,{ticketBalances:[],ticketTransactions:[]});
 assert.equal(result.report.cutoverReady,false);
});

test('ticket importer refuses negative balances or unsupported transaction actions',()=>{
 const valid=convertEflTicketLedger(fixture()).rows;
 assert.throws(()=>validateImportBatch({
  table:'ticketBalances',batchId:'ticketBalances:00000000',
  rows:[{...valid.ticketBalances[0],balance:-1}]
 }),/INVALID_TICKET_BALANCE_ROW/);
 assert.throws(()=>validateImportBatch({
  table:'ticketTransactions',batchId:'ticketTransactions:00000000',
  rows:[{...valid.ticketTransactions[0],type:'FREE_ADMIN_OVERRIDE'}]
 }),/INVALID_TICKET_TRANSACTION_ROW/);
});
