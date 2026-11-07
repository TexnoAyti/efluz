import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {convertTeamsCatalog} from './lib/convertTeamsCatalog.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
import {readTeamsCatalog} from '../tgcloud/lib/teamsCatalogRead.js';
const source=[
 {document_id:'team-a',data:{name:'Alpha',members:[{userId:'secret-owner'}],
   ownerId:'private-id',logo:'data:image/png;base64,'+'A'.repeat(43000),
   membershipRequired:true,updatedAt:'2026-11-01T10:00:00Z'}},
 {document_id:'team-b',data:{name:'Beta',members:[{userId:'private-member'},{}],
   logo:'https://example.org/club.png',updatedAt:'2026-11-01T12:00:00Z'}},
 {document_id:'team-c',data:{name:'Gamma',members:[],logo:'javascript:alert(1)'}},
 {document_id:'team-d',data:{name:'Delta',members:[],logo:''}}
];
test('projection keeps public fields, drops embedded base64 and private roster',()=>{
 const {rows,report}=convertTeamsCatalog(source);
 assert.equal(report.teams,4);
 assert.equal(rows.teamsCatalog[0].member_count,1);
 assert.equal(rows.teamsCatalog[0].logo_url,null);
 assert.equal(rows.teamsCatalog[1].logo_url,'https://example.org/club.png');
 assert.equal(rows.teamsCatalog[2].logo_url,null);
 assert.equal(rows.teamsCatalog[0].owner_user_id,'private-id');
 assert.doesNotMatch(JSON.stringify(rows),/secret-owner|private-member|data:image/);
 assert.ok(validateImportBatch({table:'teamsCatalog',batchId:'teamsCatalog:00000000',
   rows:rows.teamsCatalog}));
 const invalid=[...source,{...source[0]}];
 assert.throws(()=>convertTeamsCatalog(invalid),/TEAMS_DUPLICATE_ID/);
});
test('TEAMS list is strictly paginated and never exposes private fields',async()=>{
 const {rows}=convertTeamsCatalog(source);
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec(`CREATE TABLE efl_teams_catalog(
    id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_user_id TEXT,admin_user_id TEXT,logo_url TEXT,
    member_count INTEGER NOT NULL,membership_required INTEGER NOT NULL,
    updated_at INTEGER NOT NULL);`);
  const insert=sql.prepare(`INSERT INTO efl_teams_catalog
   (id,name,owner_user_id,admin_user_id,logo_url,member_count,membership_required,updated_at)
   VALUES (:id,:name,:owner,:manager,:logo,:members,:required,:updated)`);
  for(const item of rows.teamsCatalog)insert.run({
   ':id':item.id,':name':item.name,':owner':item.owner_user_id,':manager':item.admin_user_id,':logo':item.logo_url,
   ':members':item.member_count,':required':Number(item.membership_required),
   ':updated':item.updated_at});
  const db={async all(q,p){return sql.prepare(q).all(p);}};
  const first=await readTeamsCatalog(db,{limit:2});
  assert.equal(first.teams.length,2);
  assert.equal(first.nextCursor,2);
  const second=await readTeamsCatalog(db,{limit:2,cursor:2});
  assert.equal(second.teams.length,2);
  assert.equal(second.nextCursor,null);
  assert.doesNotMatch(JSON.stringify(first),/secret-owner|private-member|private-id/);
  await assert.rejects(readTeamsCatalog(db,{limit:1000}),/INVALID_TEAMS_LIMIT/);
  await assert.rejects(readTeamsCatalog(db,{ownerId:'someone'}),/UNKNOWN_TEAMS_FIELD/);
 }finally{sql.close();}
});
