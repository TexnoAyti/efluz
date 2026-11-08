#!/usr/bin/env node
// Independently reproduce every normalized table from the exact protected
// source export. Comparing matching source/target files alone is insufficient:
// an operator could accidentally supply the same incomplete projection twice.
// No production network activity. No source values printed.
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {IMPORT_TABLES,PRIMARY_KEYS,stableRow} from '../tgcloud/lib/importBatch.js';
const [source,archive,normalized]=process.argv.slice(2);
if(!source||!archive||!normalized){
 console.error('Usage: node scripts/verifyEflNormalizedSourceBinding.mjs source.jsonl archive-dir normalized-source.json');
 process.exit(2);
}
const digest=(rows,table)=>{
 const columns=IMPORT_TABLES[table],key=PRIMARY_KEYS[table];
 if(!Array.isArray(rows))throw Error('INVALID_NORMALIZED_TABLE');
 const ids=new Set();
 const hash=createHash('sha256');
 for(const row of [...rows].sort((a,b)=>String(a[key]).localeCompare(String(b[key])))){
  if(!row||typeof row!=='object'||!Object.hasOwn(row,key)||
   row[key]===null||row[key]===undefined||
   ids.has(String(row[key]))||columns.some(c=>!Object.hasOwn(row,c))||
   Object.keys(row).some(c=>!columns.includes(c)))
   throw Error('INVALID_NORMALIZED_ROW');
  ids.add(String(row[key]));
  hash.update(stableRow(row,columns)+'\n');
 }
 return {count:rows.length,hash:hash.digest('hex')};
};
const dir=await mkdtemp(join(tmpdir(),'efl-normalized-binding-'));
try{
 const regenerated=join(dir,'regenerated.json');
 const converter=fileURLToPath(new URL('./convertEflCoreSnapshot.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[converter,resolve(source),regenerated,
  '--require-complete-source','--verified-archive',resolve(archive)],{
  encoding:'utf8',timeout:180000,maxBuffer:1024*1024
 });
 if(result.status!==0)throw Error('SOURCE_NORMALIZATION_REPLAY_FAILED');
 const [expected,actual]=await Promise.all([
  readFile(regenerated,'utf8').then(JSON.parse),
  readFile(resolve(normalized),'utf8').then(JSON.parse)
 ]);
 if(!expected||typeof expected!=='object'||Array.isArray(expected)||
  !actual||typeof actual!=='object'||Array.isArray(actual)||
  Object.keys(actual).some(t=>!Object.hasOwn(IMPORT_TABLES,t))||
  Object.keys(expected).some(t=>!Object.hasOwn(IMPORT_TABLES,t)))
  throw Error('INVALID_NORMALIZED_SNAPSHOT');
 const mismatch=[];
 for(const table of Object.keys(IMPORT_TABLES)){
  const a=digest(expected[table],table);
  const b=digest(actual[table],table);
  if(a.count!==b.count||a.hash!==b.hash)mismatch.push(table);
 }
 console.log(JSON.stringify({sourceBound:mismatch.length===0,
  comparedTables:Object.keys(IMPORT_TABLES).length,
  differingTables:mismatch,cutoverReady:false}));
 if(mismatch.length)process.exitCode=1;
}finally{
 await rm(dir,{recursive:true,force:true});
}
