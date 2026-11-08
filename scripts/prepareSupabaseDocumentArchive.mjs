#!/usr/bin/env node
// Offline conversion of an authorized efl_runtime.documents JSON export.
// Input is an array of {space,collection_path,document_id,encoded,data}.
// Never calls Supabase or Telegram, and never includes data in console logs.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {stableRow} from '../tgcloud/lib/importBatch.js';

const [input,output]=process.argv.slice(2);
if(!input||!output){
  console.error('Usage: node scripts/prepareSupabaseDocumentArchive.mjs private-source.json private-output.json');
  process.exit(2);
}
const source=JSON.parse(await readFile(input,'utf8'));
if(!Array.isArray(source))throw new Error('INVALID_SOURCE_EXPORT');
const docs=[],seen=new Set();
for(const doc of source){
  if(!doc||typeof doc!=='object'||Array.isArray(doc))throw new Error('INVALID_DOCUMENT');
  const {space,collection_path,document_id,encoded,data}=doc;
  if(!['preview','production'].includes(space) ||
    typeof collection_path!=='string'||!collection_path||
    typeof document_id!=='string'||!document_id||
    !encoded||typeof encoded!=='object'||!data||typeof data!=='object')
    throw new Error('INVALID_DOCUMENT_FIELDS');
  const sourceKey=stableRow({space,collection_path,document_id},['space','collection_path','document_id']);
  if(seen.has(sourceKey))throw new Error('DUPLICATE_SOURCE_DOCUMENT');
  seen.add(sourceKey);
  const digest=createHash('sha256').update(stableRow({encoded,data},['encoded','data'])).digest('hex');
  const id=createHash('sha256').update(sourceKey).digest('hex');
  docs.push({
    id,source_space:space,collection_path,document_id,
    encoded,data,source_checksum:digest
  });
}
docs.sort((a,b)=>a.id.localeCompare(b.id));
await writeFile(output,JSON.stringify({rawDocuments:docs})+'\n',{flag:'w',mode:0o600});
console.log(JSON.stringify({status:'PREPARED',documents:docs.length,sourceSpaces:[...new Set(docs.map(x=>x.source_space))].sort()}));
