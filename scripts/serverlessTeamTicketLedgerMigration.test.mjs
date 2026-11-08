import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflTeamTicketLedger} from './lib/convertEflTeamTicketLedger.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const doc=(document_id,data)=>({document_id,data});
const fixture=()=>({
 users:[doc('u1',{telegramId:'123'})],
 team_creation_tickets:[doc('u1',{userId:'u1',balance:5,totalGranted:12,
  totalRevoked:2,totalSpent:5,updatedAt:'2026-11-01T00:00:00Z'})],
 team_ticket_transactions:[doc('tx1',{id:'tx1',userId:'u1',kind:'GRANT',
  amount:2,actorId:'admin',createdAt:'2026-11-01T00:00:00Z'}),
  doc('tx-legacy',{userId:'u1',kind:'SPEND',amount:1,actorId:'u1',
   teamId:'team1',createdAt:'2026-11-01T00:00:00Z'})],
 ticket_transactions_idempotency:[doc('dedup1',{userId:'u1',
  tournamentId:'tour1',transactionId:'tx1',createdAt:'2026-11-01T00:00:00Z'})]
});
test('TEAMS ticket balance remains source authoritative and transaction replay is disabled',()=>{
 const src=fixture(),original=JSON.stringify(src);
 const {rows,report}=convertEflTeamTicketLedger(src);
 assert.equal(JSON.stringify(src),original);
 assert.equal(rows.teamTicketBalances[0].balance,5);
 assert.equal(rows.teamTicketTransactions.length,2);
 assert.equal(rows.teamTicketTransactions[1].id,'tx-legacy');
 assert.equal(rows.ticketIdempotencyHistory.length,1);
 assert.equal(report.balanceRecomputed,false);
 assert.equal(report.transactionsReplayed,false);
 for(const [table,list] of Object.entries(rows))
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows:list}));
});
test('forged team balances and timestamps are blocked at import boundary',()=>{
 const {rows}=convertEflTeamTicketLedger(fixture());
 assert.throws(()=>validateImportBatch({table:'teamTicketBalances',
  batchId:'teamTicketBalances:00000000',rows:[{...rows.teamTicketBalances[0],balance:-5}]
 }),/INVALID_TEAM_TICKET_BALANCE_IMPORT/);
 assert.throws(()=>validateImportBatch({table:'teamTicketTransactions',
  batchId:'teamTicketTransactions:00000000',rows:[{...rows.teamTicketTransactions[0],amount:-1}]
 }),/INVALID_TEAM_TICKET_TRANSACTION_IMPORT/);
 assert.throws(()=>validateImportBatch({table:'ticketIdempotencyHistory',
  batchId:'ticketIdempotencyHistory:00000000',
  rows:[{...rows.ticketIdempotencyHistory[0],created_at:-1}]
 }),/INVALID_TICKET_IDEMPOTENCY_IMPORT/);
});
test('missing users, duplicate transaction ID and invalid ledger values fail closed',()=>{
 for(const mutate of [
  x=>x.team_creation_tickets[0].data.userId='not-owner',
  x=>x.team_creation_tickets[0].data.balance=-1,
  x=>x.team_ticket_transactions[0].data.userId='missing',
  x=>x.team_ticket_transactions[0].data.id='forged',
  x=>x.team_ticket_transactions.push(x.team_ticket_transactions[0]),
  x=>x.ticket_transactions_idempotency[0].data.createdAt='invalid'
 ]){
  const src=fixture();mutate(src);
  assert.throws(()=>convertEflTeamTicketLedger(src));
 }
});
