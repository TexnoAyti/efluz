#!/usr/bin/env node
// Converts an already-normalized, consistent snapshot to repeatable import
// packets. No network, credentials, database connections or production writes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateImportBatch,IMPORT_TABLES,PRIMARY_KEYS,stableRow} from '../tgcloud/lib/importBatch.js';

const order=['users','seasons','leagues','clubs','clubOccupancies','fixtures','matchAccess','matchMessages'];
const input=process.argv[2], directory=process.argv[3];
if(!input || !directory) {
  console.error('Usage: node scripts/prepareServerlessImport.mjs normalized-snapshot.json output-folder');
  process.exit(2);
}
const normalized=JSON.parse(await readFile(resolve(input),'utf8'));
if(!normalized || typeof normalized!=='object' || Array.isArray(normalized) ||
  Object.keys(normalized).some(table=>!order.includes(table))) throw new Error('INVALID_SNAPSHOT');
await mkdir(resolve(directory),{recursive:true});
const manifest={schemaVersion:1,chunkSize:100,tables:{},order};
for(const table of order) {
  const list=normalized[table] ?? [];
  if(!Array.isArray(list)) throw new Error('INVALID_TABLE_'+table);
  const pk=PRIMARY_KEYS[table], seen=new Set(), chunks=[];
  const sorted=[...list].sort((a,b)=>String(a[pk]).localeCompare(String(b[pk]),'en',{numeric:true}));
  // Validate every row even for a zero-row table.
  for(let index=0;index<sorted.length;index+=100) {
    const rows=sorted.slice(index,index+100);
    const batchId=table+':'+String(index/100).padStart(8,'0');
    const batch={table,batchId,rows};
    validateImportBatch(batch);
    for(const row of rows) {
      const key=String(row[pk]);
      if(seen.has(key)) throw new Error('DUPLICATE_SOURCE_ID_'+table);
      seen.add(key);
    }
    const file=table+'-'+String(index/100).padStart(8,'0')+'.json';
    const payload=JSON.stringify(batch);
    await writeFile(join(resolve(directory),file),payload+'\n',{flag:'w',mode:0o600});
    chunks.push({batchId,file,rows:rows.length,sha256:createHash('sha256').update(payload).digest('hex')});
  }
  const digest=createHash('sha256');
  for(const row of sorted) digest.update(stableRow(row,IMPORT_TABLES[table])+'\n');
  manifest.tables[table]={count:sorted.length,sha256:digest.digest('hex'),chunks};
}
await writeFile(join(resolve(directory),'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'w',mode:0o600});
console.log('Packet manifest written. Verify using the offline verifier before staging import.');
