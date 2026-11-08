import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflSealedLegacyHistory,SEALED_ROOTS} from './lib/convertEflSealedLegacyHistory.mjs';
import {validateImportBatch,stableRow} from '../tgcloud/lib/importBatch.js';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const doc=(collection_path,document_id,data)=>({
 space:'production',collection_path,document_id,encoded:{original:data},data
});
test('every sealed root is cryptographically bound to a source document with no private payload leak',()=>{
 const source={};
 for(let i=0;i<SEALED_ROOTS.length;i++){
  const root=SEALED_ROOTS[i];
  source[root]=[doc(root,'record-'+i,{
   privateToken:'never-leak-private-marker-'+i,
   message:'x'.repeat(i===0?119000:50)
  })];
 }
 const before=JSON.stringify(source);
 const {rows,report}=convertEflSealedLegacyHistory(source);
 assert.equal(JSON.stringify(source),before);
 assert.equal(rows.sealedLegacyHistory.length,SEALED_ROOTS.length);
 assert.equal(report.roots,SEALED_ROOTS.length);
 assert.equal(report.operationalParity,false);
 assert.equal(report.sourcePayloadImported,false);
 for(const row of rows.sealedLegacyHistory){
  assert.equal(row.handling,'SEALED_ARCHIVE_ONLY');
  assert.doesNotMatch(JSON.stringify(row),/never-leak-private-marker|privateToken/);
  assert.match(row.source_checksum,/^[a-f0-9]{64}$/);
  const src=source[row.collection_path][0];
  assert.equal(row.id,sha(stableRow(src,['space','collection_path','document_id'])));
  assert.equal(row.source_checksum,sha(stableRow(src,['encoded','data'])));
  assert.ok(validateImportBatch({table:'sealedLegacyHistory',
   batchId:'sealedLegacyHistory:00000000',rows:[row]}));
 }
});
test('changed private evidence changes checksum but cannot escape to import table',()=>{
 const src={uzeflife_evidence:[doc('uzeflife_evidence','e1',{proof:'a'.repeat(120000)})]};
 const a=convertEflSealedLegacyHistory(src).rows.sealedLegacyHistory[0];
 src.uzeflife_evidence[0].data.proof='different-proof';
 const b=convertEflSealedLegacyHistory(src).rows.sealedLegacyHistory[0];
 assert.notEqual(a.source_checksum,b.source_checksum);
 assert.equal(a.id,b.id);
 assert.doesNotMatch(JSON.stringify(b),/different-proof/);
});
test('sealed import refuses source payload, live handling, duplicate identities and malformed documents',()=>{
 const src={uzeflife_channel_posts:[doc('uzeflife_channel_posts','p1',{text:'private'})]};
 const row=convertEflSealedLegacyHistory(src).rows.sealedLegacyHistory[0];
 assert.throws(()=>validateImportBatch({table:'sealedLegacyHistory',
  batchId:'sealedLegacyHistory:00000000',rows:[{...row,handling:'ACTIVE'}]
 }),/INVALID_SEALED_LEGACY_HISTORY_IMPORT/);
 assert.throws(()=>validateImportBatch({table:'sealedLegacyHistory',
  batchId:'sealedLegacyHistory:00000000',rows:[{...row,data:src.uzeflife_channel_posts[0].data}]
 }),/UNKNOWN_COLUMN/);
 src.uzeflife_channel_posts.push(src.uzeflife_channel_posts[0]);
 assert.throws(()=>convertEflSealedLegacyHistory(src),/SEALED_SOURCE_DUPLICATE/);
});
