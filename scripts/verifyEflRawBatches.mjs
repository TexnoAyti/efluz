#!/usr/bin/env node
// Offline integrity check of the raw-doc import artifact directory.
// Never contacts Telegram or source production and never prints private rows.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,basename} from 'node:path';
import {stableRow,validateImportBatch} from '../tgcloud/lib/importBatch.js';

const root=process.argv[2];
if(!root){console.error('Usage: node scripts/verifyEflRawBatches.mjs private-packet-folder');process.exit(2);}
const folder=resolve(root);
const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf8'));
if(manifest.table!=='rawDocuments'||manifest.version!==1||!Array.isArray(manifest.batches))
  throw new Error('INVALID_MANIFEST');
let count=0;const seen=new Set(),sourceDigest=createHash('sha256');
for(const [index,item] of manifest.batches.entries()){
  const expectedId='rawDocuments:'+String(index).padStart(8,'0');
  const expectedFile='rawDocuments-'+String(index).padStart(8,'0')+'.json';
  if(!item||item.batchId!==expectedId||item.file!==expectedFile||basename(item.file)!==item.file)
    throw new Error('MANIFEST_ORDER_OR_PATH');
  const content=(await readFile(join(folder,item.file),'utf8')).trimEnd();
  const hash=createHash('sha256').update(content).digest('hex');
  if(hash!==item.sha256||Buffer.byteLength(content)!==item.bytes||item.bytes>98304)
    throw new Error('PACKET_HASH_OR_SIZE_MISMATCH');
  const batch=JSON.parse(content);
  validateImportBatch(batch);
  if(batch.table!=='rawDocuments'||batch.batchId!==expectedId||batch.rows.length!==item.rows)
    throw new Error('PACKET_CONTENT_MISMATCH');
  for(const row of batch.rows){
    if(seen.has(row.id))throw new Error('DUPLICATE_DOCUMENT_ID');
    seen.add(row.id);
    if(row.source_space!=='production')throw new Error('UNEXPECTED_SOURCE_SPACE');
    const identity=stableRow({space:row.source_space,collection_path:row.collection_path,document_id:row.document_id},['space','collection_path','document_id']);
    const key=createHash('sha256').update(identity).digest('hex');
    const digest=createHash('sha256').update(stableRow(row,['encoded','data'])).digest('hex');
    if(key!==row.id||digest!==row.source_checksum)throw new Error('SOURCE_RECORD_CORRUPTED');
    sourceDigest.update(stableRow(row,['id','source_space','collection_path','document_id','encoded','data','source_checksum'])+'\n');
    count++;
  }
}
if(!Number.isSafeInteger(manifest.sourceDocuments)||
   !Number.isSafeInteger(manifest.rebuildExcluded)||
   manifest.rebuildExcluded<0||manifest.sourceDocuments!==count+manifest.rebuildExcluded)
  throw new Error('SOURCE_CLASSIFICATION_MISMATCH');
if(count!==manifest.count||count===0||sourceDigest.digest('hex')!==manifest.sourceSha256)
  throw new Error('SOURCE_MANIFEST_MISMATCH');
console.log(JSON.stringify({verified:true,documents:count,
  rebuildExcluded:manifest.rebuildExcluded,batches:manifest.batches.length}));
