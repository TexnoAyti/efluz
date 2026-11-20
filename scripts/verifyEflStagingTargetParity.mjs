#!/usr/bin/env node
// Staging-only parity check. Runs owner-authenticated, read-only Telegram
// Serverless queries and compares every returned row to the private source.
// Never prints user records, CLI output, credentials or Telegram context.
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {IMPORT_TABLES,PRIMARY_KEYS} from '../tgcloud/lib/importBatch.js';
import {rowsEquivalent} from '../tgcloud/lib/importEngine.js';

export function parseReadbackResponse(stdout) {
  if(typeof stdout!=='string'||stdout.length>3_000_000)
    throw Error('STAGING_READBACK_OUTPUT_INVALID');
  let parsed;
  const raw=stdout.trim();
  try { parsed=JSON.parse(raw); }
  catch {
    const candidates=raw.split(/\r?\n/).filter(line=>line.trim().startsWith('{'));
    for(let i=candidates.length-1;i>=0;i--) {
      try {parsed=JSON.parse(candidates[i]);break;} catch {}
    }
  }
  const result=parsed?.result??parsed;
  if(!result||result.ok!==true||!Array.isArray(result.rows)||
     !Array.isArray(result.columns)||typeof result.table!=='string'||
     typeof result.hasMore!=='boolean')
    throw Error('STAGING_READBACK_RECEIPT_INVALID');
  return result;
}
export async function verifyStagingParity(source,readPage) {
  if(!source||typeof source!=='object'||Array.isArray(source)||
     Object.keys(source).some(table=>!Object.hasOwn(IMPORT_TABLES,table)))
    throw Error('STAGING_PARITY_SOURCE_INVALID');
  let total=0;
  const counts={};
  for(const [table,columns] of Object.entries(IMPORT_TABLES)) {
    const rows=source[table];
    if(!Array.isArray(rows))throw Error('STAGING_PARITY_SOURCE_TABLE_MISSING:'+table);
    const pk=PRIMARY_KEYS[table],expected=new Map();
    for(const row of rows){
      if(!row||typeof row!=='object'||Array.isArray(row)||
         !Object.hasOwn(row,pk)||row[pk]===null||
         columns.some(col=>!Object.hasOwn(row,col))||
         Object.keys(row).some(col=>!columns.includes(col)))
        throw Error('STAGING_PARITY_INVALID_SOURCE_ROW:'+table);
      const key=String(row[pk]);
      if(expected.has(key))throw Error('STAGING_PARITY_DUPLICATE_SOURCE_ID:'+table);
      expected.set(key,row);
    }
    const seen=new Set();
    let cursor=null,pages=0,hasMore=true;
    while(hasMore){
      if(++pages>Math.ceil(rows.length/20)+2)
        throw Error('STAGING_PARITY_PAGINATION_LIMIT:'+table);
      const page=await readPage({table,cursor,limit:20});
      if(page?.ok!==true||page.table!==table||typeof page.hasMore!=='boolean'||
         !Array.isArray(page.rows)||page.rows.length>20||
         page.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||
           Object.keys(row).some(col=>!columns.includes(col)))||
         !Array.isArray(page.columns)||page.columns.length!==columns.length||
         page.columns.some((col,i)=>col!==columns[i]))
        throw Error('STAGING_PARITY_BAD_READBACK:'+table);
      for(const row of page.rows){
        const key=String(row?.[pk]);
        if(seen.has(key)||!expected.has(key)||
           !rowsEquivalent(row,expected.get(key),columns))
          throw Error('STAGING_PARITY_ROW_MISMATCH:'+table);
        seen.add(key);
      }
      hasMore=page.hasMore;
      if(hasMore){
        const next=page.nextCursor;
        if(page.rows.length===0||next===null||next===undefined||
           String(next)===String(cursor)||
           String(page.rows.at(-1)?.[pk])!==String(next))
          throw Error('STAGING_PARITY_INVALID_CURSOR:'+table);
        cursor=next;
      }else if(page.nextCursor!==null){
        throw Error('STAGING_PARITY_UNEXPECTED_CURSOR:'+table);
      }
    }
    if(seen.size!==expected.size)
      throw Error('STAGING_PARITY_MISSING_ROWS:'+table);
    counts[table]=seen.size;total+=seen.size;
  }
  return {verified:true,tables:Object.keys(counts).length,rows:total,
    counts,cutoverReady:false};
}
async function main(){
  const [sourcePath]=process.argv.slice(2);
  const owner=process.env.TGCLOUD_STAGING_OWNER_TELEGRAM_ID;
  if(!sourcePath||!/^[1-9][0-9]{0,19}$/.test(owner||''))
    throw Error('STAGING_PARITY_ARGUMENTS_INVALID');
  if(process.env.TGCLOUD_STAGING_APP_ID!=='8533963416'||
     process.env.TGCLOUD_PRODUCTION_APP_ID==='8533963416')
    throw Error('STAGING_PARITY_WRONG_APP');
  const source=JSON.parse(await readFile(resolve(sourcePath),'utf8'));
  const context=`{initData:{user:{id:${owner}}}}`;
  const readPage=async input=>{
    const run=spawnSync('npx',['--yes','--package=@tgcloud/cli','tgcloud',
      'run','endpoints/migrationReadback',JSON.stringify(input),'--ctx',context],
      {encoding:'utf8',timeout:90000,maxBuffer:3_000_000});
    // CLI stdout/stderr can contain sensitive data. Never echo either.
    if(run.error||run.status!==0)
      throw Error('STAGING_READBACK_CLI_FAILED:'+input.table);
    return parseReadbackResponse(run.stdout);
  };
  const result=await verifyStagingParity(source,readPage);
  console.log(JSON.stringify({verified:result.verified,tables:result.tables,
    rows:result.rows,cutoverReady:false}));
  console.log('STAGING_SOURCE_TARGET_PARITY_OK');
}
if(process.argv[1]&&import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  main().catch(error=>{
    console.error(/^STAGING_/.test(String(error?.message))?
      String(error.message):'STAGING_PARITY_UNEXPECTED_FAILURE');
    process.exitCode=1;
  });
}
