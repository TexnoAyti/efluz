// Residual source history is sealed, not operationally migrated.
// Full source bytes are retained in a separately verified private raw archive.
// The target gets only cryptographic identity/checksum and size, never secrets,
// Telegram messages, payment receipts, UZEFLIFE evidence or callback tokens.
import {createHash} from 'node:crypto';
import {stableRow} from '../../tgcloud/lib/importBatch.js';
export const SEALED_ROOTS=Object.freeze([
 'custom_tournament_claims','discipline_states','no_show_reports',
 'team_membership_claims','team_membership_invitations',
 'team_membership_receipts','uzeflife_channel_posts',
 'uzeflife_config_history','uzeflife_evidence'
]);
const sha=s=>createHash('sha256').update(s).digest('hex');
export function convertEflSealedLegacyHistory(source){
 const seen=new Set(),rows=[],counts={};
 for(const root of SEALED_ROOTS){
  const list=source[root]??[];
  if(!Array.isArray(list))throw Error('SEALED_SOURCE_COLLECTION_INVALID');
  counts[root]=list.length;
  for(const doc of list){
   if(!doc||doc.space!=='production'||typeof doc.collection_path!=='string'||
      doc.collection_path.split('/')[0]!==root||
      typeof doc.document_id!=='string'||!doc.document_id||
      !doc.encoded||typeof doc.encoded!=='object'||Array.isArray(doc.encoded)||
      !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data))
    throw Error('SEALED_SOURCE_DOCUMENT_INVALID');
   const identity=stableRow(doc,['space','collection_path','document_id']);
   if(seen.has(identity))throw Error('SEALED_SOURCE_DUPLICATE');
   seen.add(identity);
   rows.push({
    id:sha(identity),source_space:doc.space,
    collection_path:doc.collection_path,document_id:doc.document_id,
    source_checksum:sha(stableRow(doc,['encoded','data'])),
    source_bytes:Buffer.byteLength(JSON.stringify({encoded:doc.encoded,data:doc.data})),
    handling:'SEALED_ARCHIVE_ONLY'
   });
  }
 }
 return {rows:{sealedLegacyHistory:rows},report:{
  roots:SEALED_ROOTS.length,documents:rows.length,counts,
  sourcePayloadImported:false,operationalParity:false,cutoverReady:false}};
}
