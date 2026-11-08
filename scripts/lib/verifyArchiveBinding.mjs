// Verify that a private archive manifest is bound to the exact JSONL source.
// This does not trust filename, counts or user-provided labels.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stableRow} from '../../tgcloud/lib/importBatch.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const fields=['id','source_space','collection_path','document_id','encoded','data','source_checksum'];
export async function verifyArchiveBinding(sourcePath,archiveDir){
 if(typeof sourcePath!=='string'||typeof archiveDir!=='string')
   throw Error('ARCHIVE_BINDING_REQUIRED');
 const manifest=JSON.parse(await readFile(join(resolve(archiveDir),'manifest.json'),'utf8'));
 if(manifest.version!==2||manifest.table!=='rawDocuments')throw Error('ARCHIVE_SCHEMA_MISMATCH');
 const inventory=JSON.parse(await readFile(new URL('../../migration/source-collections-inventory.json',import.meta.url),'utf8'));
 const policy=new Map(inventory.collections.map(({collection,handling})=>[collection,handling]));
 const entries=new Map();
 let original=0,rebuild=0,review=0;
 const reviewDigest=createHash('sha256');
 for await(const line of createInterface({input:createReadStream(resolve(sourcePath),{encoding:'utf8'}),crlfDelay:Infinity})){
  if(!line.trim())continue;
  const doc=JSON.parse(line);
  if(!doc||doc.space!=='production'||typeof doc.collection_path!=='string'||
     typeof doc.document_id!=='string'||!doc.document_id||
     !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data)||
     !doc.encoded||typeof doc.encoded!=='object'||Array.isArray(doc.encoded))
    throw Error('INVALID_SOURCE_DOCUMENT');
  original++;
  const handling=policy.get(doc.collection_path.split('/')[0]);
  if(handling==='review'){
   review++;
   reviewDigest.update(JSON.stringify(doc)+'\n');
   continue;
  }
  if(handling==='rebuild'){rebuild++;continue;}
  if(handling!=='preserve')throw Error('SOURCE_COLLECTION_NOT_APPROVED');
  const identity=stableRow(doc,['space','collection_path','document_id']);
  const id=sha(identity);
  if(entries.has(id))throw Error('DUPLICATE_ARCHIVE_IDENTITY');
  const row={id,source_space:doc.space,collection_path:doc.collection_path,
   document_id:doc.document_id,encoded:doc.encoded,data:doc.data,
   source_checksum:sha(stableRow(doc,['encoded','data']))};
  entries.set(id,sha(stableRow(row,fields)));
 }
 const digest=createHash('sha256');
 for(const [id,value] of [...entries].sort((a,b)=>a[0].localeCompare(b[0])))
  digest.update(id+':'+value+'\n');
 if(original!==manifest.sourceDocuments||rebuild!==manifest.rebuildExcluded||
    review!==manifest.reviewExcluded||
    reviewDigest.digest('hex')!==manifest.reviewSha256||
    entries.size!==manifest.count||digest.digest('hex')!==manifest.sourceSha256)
  throw Error('ARCHIVE_SOURCE_MISMATCH');
 // Independently verify packet and multipart checksums before allowing
 // historically orphaned operational rows to be excluded from staging.
 const verifier=fileURLToPath(new URL('../verifyEflRawBatches.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[verifier,resolve(archiveDir)],{
  encoding:'utf8',maxBuffer:1024*1024
 });
 if(result.status!==0)throw Error('ARCHIVE_PACKET_VERIFICATION_FAILED');
 return {verified:true,sourceDocuments:original,preservedDocuments:entries.size,
  transientExcluded:rebuild,reviewQuarantined:review};
}
