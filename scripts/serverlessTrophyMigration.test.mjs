import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {convertEflTrophies} from './lib/convertEflTrophies.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const doc=(document_id,data)=>({document_id,data});
const at='2026-01-02T00:00:00Z';
function sample(){
 return {
  users:[doc('u1',{telegramId:'123'})],
  seasons:[doc('s1',{name:'S1'})],
  competitions:[doc('comp1',{seasonId:'s1'})],
  clubs:[doc('club1',{leagueId:'league1'})],
  player_trophies:[doc('award1',{
   id:'award1',active:true,clubId:'club1',clubName:'Example club',
   competitionId:'comp1',competitionName:'Example competition',
   confirmedAt:at,decidedBy:'ADMIN',evaluatedAt:at,
   seasonId:'s1',winnerUserId:'u1',winnerUsername:'Historical winner'
  })]
 };
}
test('historical trophy is projected without changing winner or source data',()=>{
 const s=sample(),before=JSON.stringify(s);
 const out=convertEflTrophies(s);
 assert.equal(JSON.stringify(s),before);
 assert.equal(out.rows.playerTrophies.length,1);
 const row=out.rows.playerTrophies[0];
 assert.equal(row.id,'award1');
 assert.equal(row.winner_user_id,'u1');
 assert.equal(row.club_id,'s2:s1:club1');
 assert.equal(row.competition_id,'comp1');
 assert.equal(out.report.awardsRecomputed,false);
 assert.equal(out.report.writeEnabled,false);
 assert.ok(validateImportBatch({table:'playerTrophies',
  batchId:'playerTrophies:00000000',rows:out.rows.playerTrophies}));
});
test('historical trophies with broken references are rejected, not fabricated',()=>{
 for(const change of [
  d=>{d.player_trophies[0].data.winnerUserId='missing';},
  d=>{d.player_trophies[0].data.seasonId='missing';},
  d=>{d.player_trophies[0].data.competitionId='missing';},
  d=>{d.player_trophies[0].data.clubId='missing';},
  d=>{d.player_trophies[0].data.id='incorrect';},
  d=>{d.player_trophies[0].data.active='yes';},
  d=>{d.competitions[0].data.seasonId='different';},
  d=>{d.player_trophies[0].data.confirmedAt='bad-date';}
 ]){
  const d=sample();change(d);
  assert.throws(()=>convertEflTrophies(d));
 }
});
test('trophy-only export produces import-ready projection in CLI without Web App edits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-trophy-'));
 try{
  const source=join(dir,'source.jsonl'),out=join(dir,'normalized.json');
  const data=sample();
  // Main converter also needs season + user + league/club/competition required fields.
  data.users[0].data={telegramId:'123',firstName:'Example',createdAt:at};
  data.seasons[0].data={name:'S1',status:'active',createdAt:at};
  data.leagues=[doc('league1',{name:'League',createdAt:at})];
  data.clubs[0].data={name:'Club',leagueId:'league1',createdAt:at};
  data.competitions[0].data={name:'Comp',seasonId:'s1',type:'CUP',status:'ACTIVE',createdAt:at};
  const lines=Object.entries(data).flatMap(([collection_path,docs])=>
   docs.map(({document_id,data})=>JSON.stringify({
    space:'production',collection_path,document_id,data,encoded:{}
   })));
  await writeFile(source,lines.join('\n')+'\n');
  const cli=new URL('./convertEflCoreSnapshot.mjs',import.meta.url).pathname;
  const run=spawnSync(process.execPath,[cli,source,out],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const normalized=JSON.parse(await readFile(out,'utf8'));
  assert.equal(normalized.playerTrophies.length,1);
  assert.equal(normalized.playerTrophies[0].winner_user_id,'u1');
 }finally{await rm(dir,{recursive:true,force:true});}
});
