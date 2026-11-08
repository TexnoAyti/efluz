import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('./auditEflTicketLedger.mjs',import.meta.url).pathname;
const doc=(collection_path,document_id,data)=>({
 space:'production',collection_path,document_id,encoded:{},data
});
const user=doc('users','u1',{telegramId:'123456'});
const balance=doc('user_tickets','balance1',{
 userId:'u1',telegramId:'123456',balance:5,totalGranted:6,totalSpent:1,totalRefunded:0
});
const transaction=doc('ticket_transactions','tx1',{
 id:'tx1',userId:'u1',amount:6,type:'GRANT',idempotencyKey:'grant:unique:1'
});
async function run(rows){
 const dir=await mkdtemp(join(tmpdir(),'efl-ledger-audit-'));
 try{
  const file=join(dir,'source.jsonl');
  await writeFile(file,rows.map(JSON.stringify).join('\n')+'\n');
  const processResult=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  return {status:processResult.status,
   report:JSON.parse(processResult.stdout),stdout:processResult.stdout,
   stderr:processResult.stderr};
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('valid historical ledger audit preserves counters without inventing balance changes',async()=>{
 const r=await run([user,balance,transaction]);
 assert.equal(r.status,0,r.stderr);
 assert.equal(r.report.ok,true);
 assert.equal(r.report.cutoverReady,false);
 assert.equal(r.report.balances,1);
 assert.equal(r.report.transactions,1);
 assert.deepEqual(r.report.transactionTypes,{GRANT:1});
 assert.doesNotMatch(r.stdout,/123456|balance1|grant:unique:1/);
});
test('orphan transactions, duplicate idempotency and altered balance owners fail closed',async()=>{
 const tx2=doc('ticket_transactions','tx2',{
  id:'tx2',userId:'missing-private-user',amount:1,type:'SPEND',
  idempotencyKey:'grant:unique:1'
 });
 const altered=doc('user_tickets','balance2',{
  userId:'u1',telegramId:'private-wrong-id',balance:0,
  totalGranted:0,totalSpent:0,totalRefunded:0
 });
 const result=await run([user,balance,transaction,tx2,altered]);
 assert.notEqual(result.status,0);
 assert.equal(result.report.errorsByType.TRANSACTION_WITHOUT_USER,1);
 assert.equal(result.report.errorsByType.DUPLICATE_IDEMPOTENCY_KEY,1);
 assert.equal(result.report.errorsByType.DUPLICATE_USER_BALANCE,1);
 assert.equal(result.report.errorsByType.BALANCE_TELEGRAM_MISMATCH,1);
 assert.doesNotMatch(result.stdout+result.stderr,
  /missing-private-user|private-wrong-id|grant:unique:1/);
});
test('negative, fractional and unknown transaction values fail without altering source',async()=>{
 const invalid={...transaction,data:{...transaction.data,amount:-1,type:'HIDDEN'}};
 const r=await run([user,balance,invalid]);
 assert.notEqual(r.status,0);
 assert.equal(r.report.errorsByType.INVALID_TRANSACTION_AMOUNT,1);
 assert.equal(r.report.errorsByType.UNKNOWN_TRANSACTION_TYPE,1);
});
