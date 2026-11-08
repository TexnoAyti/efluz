import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflClubControls} from './lib/convertEflClubControls.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
import {rowsEquivalent} from '../tgcloud/lib/importEngine.js';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const doc=(document_id,data)=>({document_id,data});
const at='2026-01-01T00:00:00.000Z';
const fixture=()=>({
 users:[doc('user1',{telegramId:'123456'})],
 seasons:[doc('season1',{name:'Season 1'})],
 club_admissions:[doc('admission1',{seasonId:'season1',enabled:true,
  automatic:false,stage:2,revision:'revision1',
  leagueOverrides:{league1:{enabled:false}},updatedBy:'admin',updatedAt:at})],
 club_selection_bans:[doc('user1',{userId:'user1',telegramId:'123456',
  isBanned:true,reason:'historical ban',actorId:'admin',
  revision:3,updatedAt:at})]
});
test('preserves bans and admissions without opening selection or executing bans',()=>{
 const source=fixture(),before=JSON.stringify(source);
 const out=convertEflClubControls(source);
 assert.equal(JSON.stringify(source),before);
 assert.equal(out.rows.clubSelectionBans[0].is_banned,true);
 assert.equal(out.rows.clubAdmissions[0].enabled,true);
 assert.equal(out.rows.clubAdmissions[0].automatic,false);
 assert.equal(out.report.banActionsExecuted,false);
 assert.equal(out.report.admissionOpened,false);
 for(const [table,rows] of Object.entries(out.rows))
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows}));
 const item=out.rows.clubAdmissions[0];
 const columns=['league_overrides'];
 assert.ok(rowsEquivalent({league_overrides:JSON.stringify({league1:{enabled:false}})},
  item,columns));
});
test('invalid owners, telegram identities, revision and admission state are rejected',()=>{
 const changes=[
  s=>s.club_selection_bans[0].data.userId='missing',
  s=>s.club_selection_bans[0].data.telegramId='000',
  s=>s.club_selection_bans[0].data.revision=-1,
  s=>s.club_selection_bans[0].data.isBanned='true',
  s=>s.club_admissions[0].data.seasonId='missing',
  s=>s.club_admissions[0].data.leagueOverrides=[],
  s=>s.club_admissions[0].data.automatic='yes',
  s=>s.club_admissions[0].data.updatedAt='invalid'
 ];
 for(const mutate of changes){
  const source=fixture();mutate(source);
  assert.throws(()=>convertEflClubControls(source));
 }
});
test('main offline converter carries both source controls into operational tables',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-club-control-'));
 try{
  const source=fixture(),original=join(dir,'original.jsonl'),
   target=join(dir,'normalized.json');
  source.users[0].data={telegramId:'123456',firstName:'Example',createdAt:at};
  source.seasons[0].data={name:'Season 1',status:'active',createdAt:at};
  await writeFile(original,Object.entries(source).flatMap(([collection_path,docs])=>
   docs.map(({document_id,data})=>JSON.stringify({
    space:'production',collection_path,document_id,encoded:{},data
   }))).join('\n')+'\n');
  const cli=new URL('./convertEflCoreSnapshot.mjs',import.meta.url).pathname;
  const proc=spawnSync(process.execPath,[cli,original,target],{encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);
  const result=JSON.parse(await readFile(target,'utf8'));
  assert.equal(result.clubSelectionBans.length,1);
  assert.equal(result.clubAdmissions.length,1);
  assert.equal(result.clubSelectionBans[0].is_banned,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('forged admission opening and ban state fail at packet import boundary',()=>{
 const rows=convertEflClubControls(fixture()).rows;
 assert.throws(()=>validateImportBatch({
  table:'clubAdmissions',batchId:'clubAdmissions:00000000',
  rows:[{...rows.clubAdmissions[0],enabled:'true'}]
 }),/INVALID_CLUB_ADMISSION_IMPORT_ROW/);
 assert.throws(()=>validateImportBatch({
  table:'clubSelectionBans',batchId:'clubSelectionBans:00000000',
  rows:[{...rows.clubSelectionBans[0],user_id:'other'}]
 }),/INVALID_CLUB_BAN_IMPORT_ROW/);
});
