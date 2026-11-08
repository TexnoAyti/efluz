import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflMembershipHistory} from './lib/convertEflMembershipHistory.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
import {rowsEquivalent} from '../tgcloud/lib/importEngine.js';
const at='2026-01-01T00:00:00Z';
const doc=(document_id,data)=>({document_id,data});
const fixture=()=>({
 users:[doc('u1',{telegramId:'123'})],
 seasons:[doc('s1',{name:'Season 1'})],
 clubs:[doc('c1',{name:'Club'})],
 club_memberships:[
  doc('history1',{userId:'u1',seasonId:'s1',clubId:'c1',
   claimedAt:at,updatedAt:at,status:'active',id:'different-source-id'}),
  doc('history2',{userId:'u1',seasonId:'s1',clubId:'retired-club',
   claimedAt:at,updatedAt:at,status:'released',releasedAt:at})
 ],
 user_memberships:[
  doc('membership1',{userId:'removed-user',seasonId:'s1',clubId:'c1',
   claimedAt:at,updatedAt:at,status:'released',releasedAt:at})
 ]
});
test('historical memberships preserve source IDs and unresolved orphan references without granting occupancy',()=>{
 const data=fixture(),original=JSON.stringify(data);
 const out=convertEflMembershipHistory(data);
 assert.equal(JSON.stringify(data),original);
 assert.equal(out.rows.clubMembershipHistory.length,2);
 assert.equal(out.rows.userMembershipHistory.length,1);
 assert.equal(out.rows.clubMembershipHistory[0].source_id,'different-source-id');
 assert.equal(out.rows.clubMembershipHistory[1].reference_status,'UNRESOLVED');
 assert.equal(out.rows.userMembershipHistory[0].reference_status,'UNRESOLVED');
 assert.equal(out.report.unlinkedUsers,1);
 assert.equal(out.report.unlinkedClubs,1);
 assert.equal(out.report.ownershipGranted,false);
 for(const [table,rows] of Object.entries(out.rows)){
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows}));
  const row=rows[0];
  const stored={...row,source_record:JSON.stringify(row.source_record)};
  assert.ok(rowsEquivalent(stored,row,Object.keys(row)));
 }
});
test('invalid source season, duplicate identity and unsupported status fail closed',()=>{
 for(const change of [
  d=>d.club_memberships[0].data.seasonId='missing',
  d=>d.club_memberships[0].data.status='unknown',
  d=>d.club_memberships.push(d.club_memberships[0]),
  d=>d.user_memberships[0].data.updatedAt='not a date'
 ]){
  const d=fixture();change(d);
  assert.throws(()=>convertEflMembershipHistory(d));
 }
});

test('history import rejects a forged resolved status or conflicting original membership record',()=>{
 const rows=convertEflMembershipHistory(fixture()).rows;
 const record=rows.userMembershipHistory[0];
 assert.throws(()=>validateImportBatch({
  table:'userMembershipHistory',batchId:'userMembershipHistory:00000000',
  rows:[{...record,reference_status:'ACTIVE'}]
 }),/INVALID_HISTORICAL_MEMBERSHIP_IMPORT_ROW/);
 assert.throws(()=>validateImportBatch({
  table:'userMembershipHistory',batchId:'userMembershipHistory:00000000',
  rows:[{...record,user_id:'not-source-user'}]
 }),/INVALID_HISTORICAL_MEMBERSHIP_IMPORT_ROW/);
});
