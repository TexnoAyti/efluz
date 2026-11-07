#!/usr/bin/env node
// Offline validation of complete source archive, including >96KiB documents.
// Does not log private source data or connect to a live serverless database.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,basename} from 'node:path';
import {stableRow,validateImportBatch} from '../tgcloud/lib/importBatch.js';
import {decodeRawParts} from './lib/oversizedArchiveParts.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const folder=process.argv[2]&&resolve(process.argv[2]);
if(!folder){console.error('Usage: node scripts/verifyEflRawBatches.mjs private-packet-folder');process.exit(2);}
const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));
if(manifest.table!=='rawDocuments'||manifest.version!==2||
   !Array.isArray(manifest.batches)||!Array.isArray(manifest.partsBatches))
 throw Error('INVALID_MANIFEST');
const fieldList=['id','source_space','collection_path','document_id','encoded','data','source_checksum'];
const documents=new Map(),parts=new Map();
async function getPacket(item,index,table){
 const label=String(index).padStart(8,'0');
 const expectedId=table+':'+label,expectedFile=table+'-'+label+'.json';
 if(!item||item.batchId!==expectedId||item.file!==expectedFile||
    basename(item.file)!==item.file)throw Error('MANIFEST_ORDER_OR_PATH');
 const content=(await readFile(join(folder,item.file),'utf8')).trimEnd();
 if(hash(content)!==item.sha256||Buffer.byteLength(content)!==item.bytes||
    item.bytes>98304)throw Error('PACKET_HASH_OR_SIZE_MISMATCH');
 const packet=JSON.parse(content);
 validateImportBatch(packet);
 if(packet.table!==table||packet.batchId!==expectedId||packet.rows.length!==item.rows)
  throw Error('PACKET_CONTENT_MISMATCH');
 return packet.rows;
}
function accept(row){
 if(documents.has(row.id))throw Error('DUPLICATE_DOCUMENT_ID');
 if(row.source_space!=='production')throw Error('UNEXPECTED_SOURCE_SPACE');
 const identity=stableRow({space:row.source_space,collection_path:row.collection_path,
   document_id:row.document_id},['space','collection_path','document_id']);
 if(hash(identity)!==row.id||
    hash(stableRow(row,['encoded','data']))!==row.source_checksum)
  throw Error('SOURCE_RECORD_CORRUPTED');
 documents.set(row.id,hash(stableRow(row,fieldList)));
}
for(const [i,item] of manifest.batches.entries()){
 const records=await getPacket(item,i,'rawDocuments');
 for(const row of records)accept(row);
}
for(const [i,item] of manifest.partsBatches.entries()){
 const records=await getPacket(item,i,'rawDocumentParts');
 for(const row of records){
  const key=row.source_document_id;
  if(!parts.has(key))parts.set(key,[]);
  parts.get(key).push(row);
 }
}
for(const rows of parts.values())accept(decodeRawParts(rows));
if(parts.size!==manifest.oversizedDocuments||
   manifest.partsBatches.reduce((a,b)=>a+b.rows,0)!==manifest.totalParts)
 throw Error('OVERSIZED_PART_COUNT_MISMATCH');
const count=documents.size;
if(!Number.isSafeInteger(manifest.sourceDocuments)||
   !Number.isSafeInteger(manifest.rebuildExcluded)||
   manifest.rebuildExcluded<0||
   manifest.sourceDocuments!==count+manifest.rebuildExcluded)
 throw Error('SOURCE_CLASSIFICATION_MISMATCH');
const digest=createHash('sha256');
for(const [id,value] of [...documents].sort((a,b)=>a[0].localeCompare(b[0])))
 digest.update(id+':'+value+'\n');
if(count!==manifest.count||count===0||digest.digest('hex')!==manifest.sourceSha256)
 throw Error('SOURCE_MANIFEST_MISMATCH');
console.log(JSON.stringify({verified:true,documents:count,oversized:parts.size,
 parts:manifest.totalParts,rebuildExcluded:manifest.rebuildExcluded,
 batches:manifest.batches.length}));
