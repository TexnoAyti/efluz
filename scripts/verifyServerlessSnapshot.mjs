#!/usr/bin/env node
// Offline, read-only full-table parity check. Never connects to production.
// Inputs must be independently exported and normalized by source and target.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {IMPORT_TABLES,PRIMARY_KEYS,stableRow} from '../tgcloud/lib/importBatch.js';

const [sourceFile,targetFile]=process.argv.slice(2);
if(!sourceFile||!targetFile){
  console.error('Usage: node scripts/verifyServerlessSnapshot.mjs source-normalized.json target-normalized.json');
  process.exit(2);
}
async function load(file){
  const data=JSON.parse(await readFile(file,'utf8'));
  if(!data||Array.isArray(data)||typeof data!=='object') throw new Error('INVALID_SNAPSHOT');
  const result={};
  for(const [table,columns] of Object.entries(IMPORT_TABLES)){
    if(!Object.prototype.hasOwnProperty.call(data,table)||!Array.isArray(data[table])) throw new Error('MISSING_TABLE:'+table);
    const seen=new Set();
    for(const row of data[table]){
      if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('INVALID_ROW:'+table);
      const pk=row[PRIMARY_KEYS[table]];
      if(pk===undefined||pk===null||String(pk)==='')throw new Error('MISSING_PRIMARY_KEY:'+table);
      if(seen.has(String(pk)))throw new Error('DUPLICATE_PRIMARY_KEY:'+table+':'+String(pk));
      seen.add(String(pk));
      if(columns.some(c=>!Object.prototype.hasOwnProperty.call(row,c)))throw new Error('MISSING_COLUMN:'+table);
    }
    const ordered=[...data[table]].sort((a,b)=>String(a[PRIMARY_KEYS[table]]).localeCompare(String(b[PRIMARY_KEYS[table]]),'en',{numeric:true}));
    const digest=createHash('sha256');
    for(const row of ordered)digest.update(stableRow(row,columns)+'\n');
    result[table]={count:ordered.length,sha256:digest.digest('hex')};
  }
  return result;
}
const [source,target]=await Promise.all([load(sourceFile),load(targetFile)]);
let failed=false;
for(const table of Object.keys(IMPORT_TABLES)){
  const a=source[table],b=target[table];
  const ok=a.count===b.count&&a.sha256===b.sha256;
  if(!ok)failed=true;
  console.log(JSON.stringify({table,match:ok,sourceCount:a.count,targetCount:b.count,
    sourceSha256:a.sha256,targetSha256:b.sha256}));
}
if(failed){console.error('PARITY_FAILED: do not cut over.');process.exitCode=1;}
else console.log('PARITY_OK: normalized core tables match; operational tests are still required.');
