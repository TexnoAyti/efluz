#!/usr/bin/env node
// Offline integrity check of normalized import packets against a distinct
// normalized source snapshot. No target writes or source data in output.
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {IMPORT_TABLES,PRIMARY_KEYS,validateImportBatch,stableRow} from '../tgcloud/lib/importBatch.js';

const [sourceArg,folderArg]=process.argv.slice(2);
if(!sourceArg||!folderArg){
  console.error('Usage: node scripts/verifyEflNormalizedPackets.mjs private-normalized-source.json private-packet-dir');
  process.exit(2);
}
const source=JSON.parse(await readFile(resolve(sourceArg),'utf8'));
const folder=resolve(folderArg);
const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const sameSet=(actual,expected)=>
  actual.length===expected.length&&new Set(actual).size===actual.length&&
  actual.every(k=>expected.includes(k));

if(!source||typeof source!=='object'||Array.isArray(source)||
   !manifest||typeof manifest!=='object'||Array.isArray(manifest)||
   manifest.schemaVersion!==1||manifest.chunkSize!==100||
   manifest.maxPacketBytes!==98304||
   !Array.isArray(manifest.order)||!manifest.tables||
   typeof manifest.tables!=='object'||Array.isArray(manifest.tables))
  throw Error('INVALID_NORMALIZED_PACKET_MANIFEST');
const tables=Object.keys(IMPORT_TABLES);
if(!sameSet(manifest.order,tables)||
   !sameSet(Object.keys(manifest.tables),tables)||
   !sameSet(Object.keys(source),tables))
  throw Error('NORMALIZED_TABLE_SET_MISMATCH');

const allowed=new Set(['manifest.json']);
let packets=0,rowsChecked=0;
for(const table of manifest.order){
  const fields=IMPORT_TABLES[table],pk=PRIMARY_KEYS[table],meta=manifest.tables[table];
  if(!meta||typeof meta!=='object'||!Number.isSafeInteger(meta.count)||
     meta.count<0||!Array.isArray(meta.chunks)||
     !/^[a-f0-9]{64}$/.test(meta.sha256))
    throw Error('INVALID_NORMALIZED_TABLE_MANIFEST');
  const expectedRows=source[table];
  if(!Array.isArray(expectedRows))throw Error('INVALID_NORMALIZED_SOURCE');
  const sorted=[...expectedRows].sort((a,b)=>
    String(a?.[pk]).localeCompare(String(b?.[pk]),'en',{numeric:true}));
  const seen=new Set(),digest=createHash('sha256');
  for(const row of sorted){
    if(!row||typeof row!=='object'||Array.isArray(row)||
       row[pk]===null||row[pk]===undefined||
       seen.has(String(row[pk]))||fields.some(col=>!Object.hasOwn(row,col))||
       Object.keys(row).some(col=>!fields.includes(col)))
      throw Error('INVALID_NORMALIZED_SOURCE_ROW');
    seen.add(String(row[pk]));
    digest.update(stableRow(row,fields)+'\n');
  }
  if(sorted.length!==meta.count||digest.digest('hex')!==meta.sha256)
    throw Error('NORMALIZED_SOURCE_DIGEST_MISMATCH');
  let offset=0;
  for(const [i,chunk] of meta.chunks.entries()){
    const label=String(i).padStart(8,'0');
    const name=table+'-'+label+'.json',batchId=table+':'+label;
    if(!chunk||chunk.file!==name||chunk.batchId!==batchId||
       !Number.isSafeInteger(chunk.bytes)||chunk.bytes<=0||
       chunk.bytes>98304||!Number.isSafeInteger(chunk.rows)||
       chunk.rows<1||chunk.rows>100||!/^[a-f0-9]{64}$/.test(chunk.sha256))
      throw Error('NORMALIZED_PACKET_INDEX_INVALID');
    allowed.add(name);
    const packetText=(await readFile(join(folder,name),'utf8')).trimEnd();
    if(Buffer.byteLength(packetText)!==chunk.bytes||
       hash(packetText)!==chunk.sha256)
      throw Error('NORMALIZED_PACKET_HASH_MISMATCH');
    const parsed=JSON.parse(packetText);
    validateImportBatch(parsed);
    if(parsed.table!==table||parsed.batchId!==batchId||
       parsed.rows.length!==chunk.rows||offset+chunk.rows>sorted.length)
      throw Error('NORMALIZED_PACKET_CONTENT_INVALID');
    for(const [j,row] of parsed.rows.entries()){
      if(stableRow(row,fields)!==stableRow(sorted[offset+j],fields))
        throw Error('NORMALIZED_PACKET_SOURCE_MISMATCH');
    }
    offset+=chunk.rows;packets++;
  }
  if(offset!==sorted.length)
    throw Error('NORMALIZED_PACKET_MISSING_ROWS');
  rowsChecked+=offset;
}
const entries=await readdir(folder,{withFileTypes:true});
if(entries.some(entry=>!entry.isFile()||!allowed.has(entry.name))||
   entries.length!==allowed.size)
  throw Error('UNEXPECTED_OR_MISSING_PACKET_FILE');
console.log(JSON.stringify({verified:true,tables:tables.length,
  rows:rowsChecked,packets,cutoverReady:false}));
