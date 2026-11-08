#!/usr/bin/env node
// Offline coverage gate against the observed production collection inventory.
// Does not access production or print document data. Counts are NOT a snapshot.
// 'mapped' means a converter path exists, NOT verified data parity or live parity.
import {readFile} from 'node:fs/promises';
const arg=process.argv.find(x=>x.startsWith('--manifest='));
const manifest=arg?.slice('--manifest='.length)||
 new URL('../migration/source-collections-inventory.json',import.meta.url);
const inventory=JSON.parse(await readFile(manifest,'utf8'));
if(!inventory||!Array.isArray(inventory.collections)||
 !Number.isSafeInteger(inventory.observedTotal)||inventory.observedTotal<0)
 throw Error('INVALID_COVERAGE_MANIFEST');
const handled=new Set(['preserve','review','rebuild']);
// Every mapped domain below has a path in convertEflCoreSnapshot.mjs.
// The raw archive remains mandatory even for successfully normalized rows.
const mapped=new Set([
 'users','seasons','leagues','clubs','club_occupancies',
 'competitions','competition_participants','fixtures',
 'result_submissions','disputes','notifications','audit_logs',
 'durable_fixture_overrides','uzeflife','user_tickets','ticket_transactions'
]);
const counts={mapped:0,unmapped:0,review:0,rebuild:0};
const collectionCounts={mapped:0,unmapped:0,review:0,rebuild:0};
const unmapped=[],review=[],seen=new Set();
let total=0;
for(const c of inventory.collections){
 if(!c||typeof c.collection!=='string'||!c.collection||
  seen.has(c.collection)||!handled.has(c.handling)||
  !Number.isSafeInteger(c.observedDocuments)||c.observedDocuments<0)
  throw Error('INVALID_COVERAGE_COLLECTION');
 seen.add(c.collection);
 const group=c.handling==='preserve'
  ?(mapped.has(c.collection)?'mapped':'unmapped'):c.handling;
 counts[group]+=c.observedDocuments;
 collectionCounts[group]++;
 total+=c.observedDocuments;
 if(group==='unmapped')unmapped.push(c.collection);
 if(group==='review')review.push(c.collection);
}
if(total!==inventory.observedTotal)throw Error('COVERAGE_INVENTORY_TOTAL_MISMATCH');
// Even full coverage would not replace independent export, import, and parity.
const normalizedCoverageComplete=counts.unmapped===0&&counts.review===0;
const result={
 ok:normalizedCoverageComplete,
 inventoryDate:inventory.asOf??null,
 observedGeneration:inventory.observedGeneration??null,
 observedTotal:total,
 collections:seen.size,
 counts,collectionCounts,
 unresolvedPreservedCollections:unmapped.sort(),
 unresolvedReviewCollections:review.sort(),
 normalizedCoverageComplete,
 cutoverReady:false,
 note:'Read-only inventory only; a consistent source export, verified archive, target import and row-hash parity remain mandatory.'
};
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
