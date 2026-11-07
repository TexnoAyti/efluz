#!/usr/bin/env node
// Inventory-only verification. Never logs document contents or user IDs.
// Input is the authorized production JSONL export, never a public file.
import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
const source=process.argv[2];
const strict=process.argv.includes('--strict');
if(!source){console.error('Usage: node scripts/auditEflSourceInventory.mjs private-source.jsonl [--strict]');process.exit(2);}
const policy=JSON.parse(await readFile(new URL('../migration/source-collections-inventory.json',import.meta.url),'utf8'));
const rules=new Map(policy.collections.map(row=>[row.collection,row.handling]));
if(rules.size!==policy.collections.length)throw Error('DUPLICATE_POLICY_COLLECTION');
const counts=new Map();
let total=0;
for await(const line of createInterface({input:createReadStream(source,{encoding:'utf8'}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const doc=JSON.parse(line);
 if(doc.space!=='production'||typeof doc.collection_path!=='string'||!doc.collection_path)
   throw Error('INVALID_SOURCE_DOCUMENT');
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
const result={ok:unknown.length===0&&(!strict||pending.length===0),total,collections:counts.size,
 preserveRows:preserved,rebuildRows:rebuilt,reviewRows:total-preserved-rebuilt,
 unknownCollections:unknown,reviewCollections:pending};
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
