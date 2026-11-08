#!/usr/bin/env node
// Inventory-only verification. Never logs document contents or user IDs.
// Input is the authorized production JSONL export, never a public file.
import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
const source=process.argv[2];
const strict=process.argv.includes('--strict');
const requireObservedCounts=process.argv.includes('--require-observed-counts');
const manifestArg=process.argv.find(arg=>arg.startsWith('--manifest='));
const manifestPath=manifestArg?manifestArg.slice('--manifest='.length):new URL('../migration/source-collections-inventory.json',import.meta.url);
if(manifestArg&&!manifestPath)throw Error('INVALID_INVENTORY_MANIFEST_PATH');
if(!source){console.error('Usage: node scripts/auditEflSourceInventory.mjs private-source.jsonl [--strict]');process.exit(2);}
const policy=JSON.parse(await readFile(manifestPath,'utf8'));
if(!policy||!Array.isArray(policy.collections))throw Error('INVALID_INVENTORY_MANIFEST');
const rules=new Map(policy.collections.map(row=>[row.collection,row.handling]));
if(rules.size!==policy.collections.length)throw Error('DUPLICATE_POLICY_COLLECTION');
const counts=new Map();
const documentKeys=new Set();
let total=0;
for await(const line of createInterface({input:createReadStream(source,{encoding:'utf8'}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const doc=JSON.parse(line);
 if(doc.space!=='production'||typeof doc.collection_path!=='string'||!doc.collection_path||
    typeof doc.document_id!=='string'||!doc.document_id)
   throw Error('INVALID_SOURCE_DOCUMENT');
 // Duplicate full-path/document ID means the export is not a reliable snapshot.
 // Never print the duplicated ID or private document fields.
 const key=JSON.stringify([doc.collection_path,doc.document_id]);
 if(documentKeys.has(key))throw Error('DUPLICATE_SOURCE_DOCUMENT');
 documentKeys.add(key);
 const root=doc.collection_path.split('/')[0];
 counts.set(root,(counts.get(root)||0)+1);
 total++;
}
const unknown=[...counts.keys()].filter(name=>!rules.has(name)).sort();
const pending=[...counts.entries()].filter(([name,count])=>count>0&&rules.get(name)==='review')
 .map(([collection,count])=>({collection,count})).sort((a,b)=>a.collection.localeCompare(b.collection));
const rebuilt=[...counts.entries()].filter(([name])=>rules.get(name)==='rebuild')
 .reduce((sum,[,count])=>sum+count,0);
const preserved=[...counts.entries()].filter(([name])=>rules.get(name)==='preserve')
 .reduce((sum,[,count])=>sum+count,0);
const observedMismatches=requireObservedCounts
 ?policy.collections.filter(row=>!Number.isSafeInteger(row.observedDocuments)||
    row.observedDocuments<0||
    (counts.get(row.collection)??0)!==row.observedDocuments)
   .map(row=>row.collection).sort()
 :[];
const observedTotalMismatch=requireObservedCounts&&(
 !Number.isSafeInteger(policy.observedTotal)||policy.observedTotal!==total);
const result={ok:unknown.length===0&&(!strict||pending.length===0)&&
 (!requireObservedCounts||(!observedTotalMismatch&&observedMismatches.length===0)),
 total,collections:counts.size,
 preserveRows:preserved,rebuildRows:rebuilt,reviewRows:total-preserved-rebuilt,
 unknownCollections:unknown,reviewCollections:pending,
 ...(requireObservedCounts?{
   observedBaselineGeneration:policy.observedGeneration??null,
   observedTotalMismatch,
   observedCollectionMismatches:observedMismatches,
   note:'Matching observed counts alone does not prove a consistent export; verify generation and independent row hashes.'
 }:{} )};
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
