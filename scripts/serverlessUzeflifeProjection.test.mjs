import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {convertUzeflife} from './lib/convertUzeflife.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
import {readUzeflife} from '../tgcloud/lib/uzeflifeRead.js';
const sample=()=>({
 name:'UZEFLIFE',status:'active',format:'KNOCKOUT',round:3,totalRounds:9,
 roundHours:24,revision:12,superAdmin:'private-admin-id',
 roster:[{userId:'private-id',username:'private-user'}],
 participants:[{id:'player1',name:'Player One',status:'active'},
   {id:'player2',name:'Player Two',status:'active'}],
 matches:Array.from({length:101},(_,i)=>({
  id:'match'+i,round:3,bracket:i,home:'player1',away:'player2',
  winner:i===0?'player1':null,homeScore:i===0?2:null,
  awayScore:i===0?1:null,penaltyHome:null,penaltyAway:null,
  deadlineAt:'2026-11-09T18:00:00Z',proposal:{privateEvidence:'not-for-read-api'}
 }))
});
test('UZEFLIFE projection is bounded, lossless on public scores and excludes admin/evidence',()=>{
 const {rows,report}=convertUzeflife(sample());
 assert.equal(report.matches,101);
 assert.equal(rows.uzeflifeFixtures[0].home_score,2);
 assert.equal(rows.uzeflifeFixtures[0].winner,'player1');
 assert.equal(rows.uzeflifeState[0].source_revision,12);
 for(const [table,data] of Object.entries(rows))
  for(let i=0;i<data.length;i+=40)
   assert.equal(validateImportBatch({table,batchId:table+':'+String(i).padStart(8,'0'),rows:data.slice(i,i+40)}).table,table);
 assert.doesNotMatch(JSON.stringify(rows),/private-admin-id|privateEvidence|private-user/);
 const invalid=sample();
 invalid.matches[1].id=invalid.matches[0].id;
 assert.throws(()=>convertUzeflife(invalid),/DUPLICATE_OR_INVALID_FIXTURE/);
});
test('read-only UZEFLIFE endpoint paginates real SQLite fixtures and protects input',async()=>{
 const {rows}=convertUzeflife(sample());
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec(`
   CREATE TABLE efl_uzeflife_state(id TEXT PRIMARY KEY,name TEXT,status TEXT,format TEXT,
     current_round INTEGER,total_rounds INTEGER,round_hours INTEGER,
     participants_count INTEGER,matches_count INTEGER,source_revision INTEGER);
   CREATE TABLE efl_uzeflife_entrants(id TEXT PRIMARY KEY,name TEXT,status TEXT);
   CREATE TABLE efl_uzeflife_fixtures(id TEXT PRIMARY KEY,round INTEGER,bracket INTEGER,
     home TEXT,away TEXT,winner TEXT,home_score INTEGER,away_score INTEGER,
     penalty_home INTEGER,penalty_away INTEGER,deadline_at INTEGER);`);
  for(const [table,data] of Object.entries(rows)){
   const map={uzeflifeState:'efl_uzeflife_state',
     uzeflifeEntrants:'efl_uzeflife_entrants',uzeflifeFixtures:'efl_uzeflife_fixtures'};
   for(const record of data){
    const keys=Object.keys(record);
    const query='INSERT INTO '+map[table]+' ('+keys.join(',')+') VALUES ('+keys.map(k=>':'+k).join(',')+')';
    sql.prepare(query).run(Object.fromEntries(keys.map(k=>[':'+k,record[k]])));
   }
  }
  const db={
   async get(q,params={}){return sql.prepare(q).get(params)??null;},
   async all(q,params={}){return sql.prepare(q).all(params);}
  };
  const overview=await readUzeflife(db,{section:'overview'});
  assert.equal(overview.state.matchesCount,101);
  const page1=await readUzeflife(db,{section:'matches',limit:60});
  assert.equal(page1.items.length,60);
  assert.equal(page1.nextCursor,60);
  const page2=await readUzeflife(db,{section:'matches',cursor:60,limit:60});
  assert.equal(page2.items.length,41);
  assert.equal(page2.nextCursor,null);
  assert.equal((await readUzeflife(db,{section:'participants'})).items.length,2);
  assert.doesNotMatch(JSON.stringify(page1),/privateEvidence|private-admin-id/);
  await assert.rejects(readUzeflife(db,{section:'matches',limit:1000}),/INVALID_UZEFLIFE_LIMIT/);
  await assert.rejects(readUzeflife(db,{section:'matches',userId:'another'}),/UNKNOWN_UZEFLIFE_FIELD/);
 }finally{sql.close();}
});
