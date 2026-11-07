// Offline only. Large legacy objects are preserved as full checksummed
// UTF-8 byte streams, not truncated or converted to partial JSON objects.
import {createHash} from 'node:crypto';
import {stableRow} from '../../tgcloud/lib/importBatch.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
export const RAW_PART_BYTES=48*1024;
export function encodeRawParts(doc){
 if(!doc||doc.space!=='production'||!doc.collection_path||!doc.document_id||
    !doc.encoded||typeof doc.encoded!=='object'||
    !doc.data||typeof doc.data!=='object')throw Error('INVALID_RAW_DOCUMENT');
 const sourceDocumentId=sha(stableRow(doc,['space','collection_path','document_id']));
 const payload=Buffer.from(JSON.stringify({encoded:doc.encoded,data:doc.data}),'utf8');
 const sourceChecksum=sha(payload);
 const partCount=Math.ceil(payload.length/RAW_PART_BYTES);
 const rows=[];
 for(let index=0;index<partCount;index++){
  const bytes=payload.subarray(index*RAW_PART_BYTES,(index+1)*RAW_PART_BYTES);
  rows.push({id:sha(sourceDocumentId+':'+index),source_document_id:sourceDocumentId,
   source_space:doc.space,collection_path:doc.collection_path,
   document_id:doc.document_id,part_index:index,part_count:partCount,
   part_data:bytes.toString('base64'),source_checksum:sourceChecksum,
   part_checksum:sha(bytes)});
 }
 return {sourceDocumentId,sourceChecksum,rows};
}
export function decodeRawParts(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('MISSING_SOURCE_PARTS');
 const first=rows[0];
 if(!Number.isSafeInteger(first.part_count)||first.part_count!==rows.length)
  throw Error('PART_COUNT_MISMATCH');
 const used=new Set();
 const sorted=[...rows].sort((a,b)=>a.part_index-b.part_index);
 const parts=sorted.map((row,index)=>{
  if(row.source_document_id!==first.source_document_id||
     row.source_space!==first.source_space||
     row.collection_path!==first.collection_path||row.document_id!==first.document_id||
     row.source_checksum!==first.source_checksum||row.part_count!==first.part_count||
     row.part_index!==index||used.has(index))throw Error('ARCHIVE_PART_MISMATCH');
  used.add(index);
  if(row.id!==sha(row.source_document_id+':'+index))throw Error('PART_ID_MISMATCH');
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.part_data))
    throw Error('INVALID_BASE64_PART');
  const bytes=Buffer.from(row.part_data,'base64');
  if(sha(bytes)!==row.part_checksum)throw Error('PART_CHECKSUM_MISMATCH');
  return bytes;
 });
 const payload=Buffer.concat(parts);
 if(sha(payload)!==first.source_checksum)throw Error('SOURCE_CHECKSUM_MISMATCH');
 const parsed=JSON.parse(payload.toString('utf8'));
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    !parsed.encoded||typeof parsed.encoded!=='object'||
    !parsed.data||typeof parsed.data!=='object')throw Error('INVALID_RECONSTRUCTED_DATA');
 const identity=sha(stableRow({space:first.source_space,collection_path:first.collection_path,
   document_id:first.document_id},['space','collection_path','document_id']));
 if(identity!==first.source_document_id)throw Error('SOURCE_IDENTITY_MISMATCH');
 return {id:identity,source_space:first.source_space,
  collection_path:first.collection_path,document_id:first.document_id,
  encoded:parsed.encoded,data:parsed.data,
  source_checksum:sha(stableRow(parsed,['encoded','data']))};
}
