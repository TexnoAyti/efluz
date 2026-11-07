#!/usr/bin/env node
// Bounded, streaming converter: PostgreSQL JSONL -> Telegram import packets.
// Does not connect to any database. Keep private output outside Git checkout.
import {createReadStream} from 'node:fs';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {stableRow,validateImportBatch} from '../tgcloud/lib/importBatch.js';

const [sourceName,destName]=process.argv.slice(2);
if(!sourceName||!destName){
  console.error('Usage: node scripts/prepareEflRawDocumentBatches.mjs private-source.jsonl private-output-directory');
  process.exit(2);
}
const source=resolve(sourceName),dest=resolve(destName);
if(source===dest)throw new Error('SAME_SOURCE_AND_TARGET');
try { await stat(dest); throw new Error('TARGET_ALREADY_EXISTS'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
await mkdir(dest,{recursive:false,mode:0o700});
const manifest={source:'efl_runtime.documents:production',table:'rawDocuments',
  version:1,maxRows:100,maxBytes:98304,count:0,bytes:0,batches:[],sourceSha256:null};
const sourceDigest=createHash('sha256');
const seen=new Set();
let batch=[],batchNumber=0,batchBytes=0;
async function flush(){
  if(!batch.length)return;
  const batchId='rawDocuments:'+String(batchNumber).padStart(8,'0');
  const packet={table:'rawDocuments',batchId,rows:batch};
  validateImportBatch(packet);
  const serialized=JSON.stringify(packet);
  const bytes=Buffer.byteLength(serialized);
  if(bytes>manifest.maxBytes)throw new Error('PACKET_TOO_LARGE');
  const filename='rawDocuments-'+String(batchNumber).padStart(8,'0')+'.json';
  await writeFile(join(dest,filename),serialized+'\n',{flag:'wx',mode:0o600});
  manifest.batches.push({file:filename,batchId,rows:batch.length,bytes,
    sha256:createHash('sha256').update(serialized).digest('hex')});
  manifest.bytes+=bytes;
  batch=[];batchBytes=0;batchNumber++;
}
for await(const line of createInterface({input:createReadStream(source,{encoding:'utf8'}),crlfDelay:Infinity})){
  if(!line.trim())continue;
  const doc=JSON.parse(line);
  if(!doc||doc.space!=='production'||typeof doc.collection_path!=='string'||
    typeof doc.document_id!=='string'||!doc.collection_path||!doc.document_id||
    !doc.encoded||typeof doc.encoded!=='object'||!doc.data||typeof doc.data!=='object')
    throw new Error('INVALID_SOURCE_DOCUMENT');
  const identity=stableRow(doc,['space','collection_path','document_id']);
  if(seen.has(identity))throw new Error('DUPLICATE_DOCUMENT');
  seen.add(identity);
  const dataHash=createHash('sha256').update(stableRow(doc,['encoded','data'])).digest('hex');
  const row={id:createHash('sha256').update(identity).digest('hex'),
    source_space:doc.space,collection_path:doc.collection_path,
    document_id:doc.document_id,encoded:doc.encoded,data:doc.data,source_checksum:dataHash};
  const estimated=Buffer.byteLength(JSON.stringify(row))+512;
  if(estimated>manifest.maxBytes)throw new Error('SINGLE_DOCUMENT_TOO_LARGE');
  if(batch.length>=100||batchBytes+estimated>manifest.maxBytes)await flush();
  batch.push(row);batchBytes+=estimated;
  manifest.count++;
  sourceDigest.update(stableRow(row,['id','source_space','collection_path','document_id','encoded','data','source_checksum'])+'\n');
}
await flush();
if(!manifest.count)throw new Error('EMPTY_SOURCE');
manifest.sourceSha256=sourceDigest.digest('hex');
await writeFile(join(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'PACKETS_READY',count:manifest.count,batches:manifest.batches.length}));
