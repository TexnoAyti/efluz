import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const converter=new URL('./convertEflCoreSnapshot.mjs',import.meta.url).pathname;
const packer=new URL('./prepareServerlessImport.mjs',import.meta.url).pathname;
const doc=(collection_path,document_id,data)=>({
 space:'production',collection_path,document_id,encoded:{},data
});
test('private source ticket ledger is projected and packaged with no balance recalculation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-ticket-migration-'));
 try{
  const source=join(dir,'source.jsonl');
  const normalized=join(dir,'normalized.json'),packets=join(dir,'packets');
  const docs=[
   doc('users','user1',{telegramId:'123',firstName:'A',
    createdAt:'2026-01-01T00:00:00Z'}),
   doc('user_tickets','account1',{userId:'user1',telegramId:'123',
    balance:2,totalGranted:3,totalSpent:1,totalRefunded:0,
    freeTicketGrantedAt:'2026-01-01T00:00:00Z',
    updatedAt:'2026-01-02T00:00:00Z'}),
   doc('ticket_transactions','tx1',{id:'tx1',userId:'user1',
    type:'GRANT',amount:3,idempotencyKey:'uniquegrant1',
    createdAt:'2026-01-01T00:00:00Z'})
  ];
  await writeFile(source,docs.map(JSON.stringify).join('\n')+'\n');
  let run=spawnSync(process.execPath,[converter,source,normalized],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const snapshot=JSON.parse(await readFile(normalized,'utf8'));
  assert.equal(snapshot.ticketBalances[0].balance,2);
  assert.equal(snapshot.ticketTransactions[0].amount,3);
  run=spawnSync(process.execPath,[packer,normalized,packets],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const manifest=JSON.parse(await readFile(join(packets,'manifest.json'),'utf8'));
  assert.equal(manifest.tables.ticketBalances.count,1);
  assert.equal(manifest.tables.ticketTransactions.count,1);
  const row=JSON.parse(await readFile(join(packets,'ticketBalances-00000000.json'),'utf8'));
  assert.equal(row.rows[0].balance,2);
  assert.equal(row.rows[0].user_id,'user1');
 }finally{await rm(dir,{recursive:true,force:true});}
});
