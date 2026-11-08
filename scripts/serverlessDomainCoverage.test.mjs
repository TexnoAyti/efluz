import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('./auditServerlessDomainCoverage.mjs',import.meta.url).pathname;
async function withInventory(rows,callback,total=rows.reduce((sum,r)=>sum+r.observedDocuments,0)){
 const dir=await mkdtemp(join(tmpdir(),'efl-domain-coverage-'));
 try{
  const file=join(dir,'inventory.json');
  await writeFile(file,JSON.stringify({asOf:'2026-11-08',observedTotal:total,
   observedGeneration:123,collections:rows}));
  return await callback(file);
 }finally{await rm(dir,{recursive:true,force:true});}
}
const row=(collection,handling,observedDocuments)=>({collection,handling,observedDocuments});
const run=file=>spawnSync(process.execPath,[script,'--manifest='+file],{encoding:'utf8'});
test('unmapped preserved and unresolved review roots prevent normalizing all production domains',async()=>{
 await withInventory([
  row('users','preserve',3),row('club_selection_ban_audit','preserve',4),
  row('telegram_ai_state','review',8),row('telegram_webhook_leases','rebuild',10)
 ],async file=>{
  const res=run(file);
  assert.notEqual(res.status,0);
  const report=JSON.parse(res.stdout);
  assert.deepEqual(report.counts,{mapped:3,unmapped:4,review:8,rebuild:10});
  assert.deepEqual(report.unresolvedPreservedCollections,['club_selection_ban_audit']);
  assert.deepEqual(report.unresolvedReviewCollections,['telegram_ai_state']);
  assert.equal(report.cutoverReady,false);
  assert.doesNotMatch(res.stdout,/private-data|telegram_id|userId/);
 });
});
test('all-mapped synthetic inventory is still not proof of deployed data parity',async()=>{
 await withInventory([row('users','preserve',1),row('fixtures','preserve',2)],async file=>{
  const res=run(file);
  assert.equal(res.status,0,res.stderr);
  const report=JSON.parse(res.stdout);
  assert.equal(report.normalizedCoverageComplete,true);
  assert.equal(report.cutoverReady,false);
 });
});
test('duplicate collection, unknown handling and count drift fail closed',async()=>{
 for(const rows of [
  [row('users','preserve',1),row('users','preserve',1)],
  [row('users','skip',1)],
  [row('users','preserve',1)]
 ]){
  await withInventory(rows,async file=>{
   const res=run(file);
   assert.notEqual(res.status,0);
   assert.match(res.stderr,/INVALID_COVERAGE_COLLECTION|COVERAGE_INVENTORY_TOTAL_MISMATCH/);
  },rows.length===1&&rows[0].handling==='preserve'?2:
   rows.reduce((s,r)=>s+r.observedDocuments,0));
 }
});
