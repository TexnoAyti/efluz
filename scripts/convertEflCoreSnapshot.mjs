#!/usr/bin/env node
// Offline legacy -> normalized shadow snapshot. No database or Telegram writes.
// Requires the protected, consistent PostgreSQL JSONL export.
// The complete original source archive must be retained independently.
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {convertEflCore} from './lib/convertEflCore.mjs';
import {convertUzeflife} from './lib/convertUzeflife.mjs';
import {convertTeamsCatalog} from './lib/convertTeamsCatalog.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const [src,dest]=process.argv.slice(2);
if(!src||!dest){
 console.error('Usage: node scripts/convertEflCoreSnapshot.mjs private-source.jsonl private-normalized.json [--quarantine-historical]');
 process.exit(2);
}
try{await stat(resolve(dest));throw Error('DESTINATION_ALREADY_EXISTS');}
catch(err){if(err.code!=='ENOENT')throw err;}
const scope=new Set(['users','seasons','leagues','clubs','club_occupancies',
 'competitions','competition_participants','fixtures','result_submissions','disputes',
 'notifications','audit_logs','durable_fixture_overrides','uzeflife','team_league_preview_teams']);
const collections=Object.fromEntries([...scope].map(x=>[x,[]]));
for await(const line of createInterface({input:createReadStream(resolve(src),{encoding:'utf8'}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const doc=JSON.parse(line);
 if(doc.space!=='production')throw Error('UNEXPECTED_SOURCE_SPACE');
 const collection=doc.collection_path?.split('/')[0];
 if(scope.has(collection))collections[collection].push(doc);
}
const quarantineHistoricalOrphans=process.argv.includes('--quarantine-historical');
const result=convertEflCore(collections,{quarantineHistoricalOrphans});
if(collections.uzeflife.length>1)throw Error('MULTIPLE_UZEFLIFE_ROOTS');
if(collections.uzeflife.length===1){
 const projection=convertUzeflife(collections.uzeflife[0].data);
 Object.assign(result.rows,projection.rows);
 result.report.uzeflife=projection.report;
}
if(collections.team_league_preview_teams.length){
 const catalog=convertTeamsCatalog(collections.team_league_preview_teams);
 Object.assign(result.rows,catalog.rows);
 result.report.teams=catalog.report;
}
for(const [table,rows] of Object.entries(result.rows)){
 for(let index=0;index<rows.length;index+=100)
  validateImportBatch({table,batchId:table+':'+String(index/100).padStart(8,'0'),rows:rows.slice(index,index+100)});
}
await writeFile(resolve(dest),JSON.stringify(result.rows)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({ok:true,...result.report,
 mappedRows:Object.fromEntries(Object.entries(result.rows).map(([k,v])=>[k,v.length]))}));
