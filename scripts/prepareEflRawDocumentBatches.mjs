#!/usr/bin/env node
// Offline, private, checksummed source archive. Small documents use rawDocuments
// and oversized documents use rawDocumentParts. Neither touches production.
import {createReadStream} from 'node:fs';
import {mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {stableRow,validateImportBatch} from '../tgcloud/lib/importBatch.js';
import {encodeRawParts} from './lib/oversizedArchiveParts.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const [sourceName,destName]=process.argv.slice(2);
if(!sourceName||!destName){
  console.error('Usage: node scripts/prepareEflRawDocumentBatches.mjs private-source.jsonl private-output-directory');
  process.exit(2);
}
const policy=JSON.parse(await readFile(new URL('../migration/source-collections-inventory.json',import.meta.url),'utf8'));
const handling=new Map(policy.collections.map(x=>[x.collection,x.handling]));
const source=resolve(sourceName),dest=resolve(destName);
if(source===dest)throw Error('SAME_SOURCE_AND_TARGET');
try{await stat(dest);throw Error('TARGET_ALREADY_EXISTS');}
catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(dest,{recursive:false,mode:0o700});
const manifest={source:'efl_runtime.documents:production',table:'rawDocuments',
 version:2,maxRows:100,maxBytes:98304,count:0,bytes:0,batches:[],partsBatches:[],
 oversizedDocuments:0,totalParts:0,sourceSha256:null,rebuildExcluded:0,sourceDocuments:0};
let batch=[],batchNumber=0,batchBytes=0;
const seen=new Set(),digests=new Map();
const fields=['id','source_space','collection_path','document_id','encoded','data','source_checksum'];
async function savePacket(packet,file,list){
 validateImportBatch(packet);
 const serialized=JSON.stringify(packet);
 const bytes=Buffer.byteLength(serialized);
 if(bytes>manifest.maxBytes)throw Error('PACKET_TOO_LARGE');
 await writeFile(join(dest,file),serialized+'\n',{flag:'wx',mode:0o600});
 list.push({file,batchId:packet.batchId,rows:packet.rows.length,bytes,sha256:hash(serialized)});
 manifest.bytes+=bytes;
}
async function flush(){
 if(!batch.length)return;
 const label=String(batchNumber).padStart(8,'0');
 await savePacket({table:'rawDocuments',batchId:'rawDocuments:'+label,rows:batch},
   'rawDocuments-'+label+'.json',manifest.batches);
 batch=[];batchBytes=0;batchNumber++;
}
for await(const line of createInterface({input:createReadStream(source,{encoding:'utf8'}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const doc=JSON.parse(line);
 if(!doc||doc.space!=='production'||typeof doc.collection_path!=='string'||
   typeof doc.document_id!=='string'||!doc.collection_path||!doc.document_id||
   !doc.encoded||typeof doc.encoded!=='object'||Array.isArray(doc.encoded)||
   !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data))
  throw Error('INVALID_SOURCE_DOCUMENT');
 manifest.sourceDocuments++;
 const policyDecision=handling.get(doc.collection_path.split('/')[0]);
 if(policyDecision==='review'||!policyDecision)throw Error('SOURCE_COLLECTION_NOT_APPROVED');
 // Never carry live Telegram login sessions, leases or derived caches into
 // the target. They remain available in the private read-only source backup.
 if(policyDecision==='rebuild'){manifest.rebuildExcluded++;continue;}
 if(policyDecision!=='preserve')throw Error('INVALID_COLLECTION_POLICY');
 const identity=stableRow(doc,['space','collection_path','document_id']);
 if(seen.has(identity))throw Error('DUPLICATE_DOCUMENT');
 seen.add(identity);
 const row={id:hash(identity),source_space:doc.space,
   collection_path:doc.collection_path,document_id:doc.document_id,
   encoded:doc.encoded,data:doc.data,
   source_checksum:hash(stableRow(doc,['encoded','data']))};
 digests.set(row.id,hash(stableRow(row,fields)));
 const estimated=Buffer.byteLength(JSON.stringify(row))+512;
 if(estimated>manifest.maxBytes){
  const encoded=encodeRawParts(doc);
  if(encoded.sourceDocumentId!==row.id)throw Error('OVERSIZED_ID_MISMATCH');
  manifest.oversizedDocuments++;
  for(const part of encoded.rows){
   const index=String(manifest.totalParts).padStart(8,'0');
   await savePacket({table:'rawDocumentParts',
     batchId:'rawDocumentParts:'+index,rows:[part]},
     'rawDocumentParts-'+index+'.json',manifest.partsBatches);
   manifest.totalParts++;
  }
 } else {
  if(batch.length>=100||batchBytes+estimated>manifest.maxBytes)await flush();
  batch.push(row);batchBytes+=estimated;
 }
 manifest.count++;
}
await flush();
if(!manifest.count)throw Error('EMPTY_SOURCE');
const digest=createHash('sha256');
for(const [id,value] of [...digests].sort((a,b)=>a[0].localeCompare(b[0])))
 digest.update(id+':'+value+'\n');
manifest.sourceSha256=digest.digest('hex');
await writeFile(join(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'PACKETS_READY',count:manifest.count,
 oversized:manifest.oversizedDocuments,partPackets:manifest.partsBatches.length,
 rebuildExcluded:manifest.rebuildExcluded,batches:manifest.batches.length}));
