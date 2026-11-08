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
import {convertEflTicketLedger} from './lib/convertEflTicketLedger.mjs';
import {convertEflTrophies} from './lib/convertEflTrophies.mjs';
import {convertEflSeasonEntitlements} from './lib/convertEflSeasonEntitlements.mjs';
import {convertEflClubControls} from './lib/convertEflClubControls.mjs';
import {convertEflMembershipHistory} from './lib/convertEflMembershipHistory.mjs';
import {convertUzeflifeHistory} from './lib/convertUzeflifeHistory.mjs';
import {convertEflNotificationReadState} from './lib/convertEflNotificationReadState.mjs';
import {convertEflMatchdayHistory} from './lib/convertEflMatchdayHistory.mjs';
import {convertEflBanHistory} from './lib/convertEflBanHistory.mjs';
import {convertEflCustomTournamentHistory} from './lib/convertEflCustomTournamentHistory.mjs';
import {convertEflTelegramTagsHistory} from './lib/convertEflTelegramTagsHistory.mjs';
import {convertEflOperationalHistory} from './lib/convertEflOperationalHistory.mjs';
import {convertEflTeamTicketLedger} from './lib/convertEflTeamTicketLedger.mjs';
import {convertEflSealedLegacyHistory,SEALED_ROOTS} from './lib/convertEflSealedLegacyHistory.mjs';
import {validateImportBatch,IMPORT_TABLES} from '../tgcloud/lib/importBatch.js';
import {verifyArchiveBinding} from './lib/verifyArchiveBinding.mjs';
const [src,dest]=process.argv.slice(2);
if(!src||!dest){
 console.error('Usage: node scripts/convertEflCoreSnapshot.mjs private-source.jsonl private-normalized.json [--quarantine-historical --verified-archive private-archive-directory] [--require-complete-source]');
 process.exit(2);
}
try{await stat(resolve(dest));throw Error('DESTINATION_ALREADY_EXISTS');}
catch(err){if(err.code!=='ENOENT')throw err;}
const scope=new Set(['users','seasons','leagues','clubs','club_occupancies',
 'competitions','competition_participants','fixtures','result_submissions','disputes',
 'notifications','audit_logs','durable_fixture_overrides','uzeflife','team_league_preview_teams',
 'user_tickets','ticket_transactions','player_trophies',
 'season2_retention_decisions','premium_entitlements',
 'club_admissions','club_selection_bans',
 'club_memberships','user_memberships',
 'uzeflife_audit','uzeflife_notifications','notification_read_state',
 'matchday_locks','match_deadlines',
 'club_selection_ban_audit','club_selection_ban_controls',
 'custom_tournaments','custom_tournament_participants',
 'custom_tournament_fixtures','custom_tournament_audit_logs',
 'telegram_member_tags','telegram_member_tag_state',
 'match_chat_rooms','matchday_notification_jobs','standings',
 'team_creation_tickets','team_ticket_transactions','ticket_transactions_idempotency',
 ...SEALED_ROOTS]);
const collections=Object.fromEntries([...scope].map(x=>[x,[]]));
for await(const line of createInterface({input:createReadStream(resolve(src),{encoding:'utf8'}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const doc=JSON.parse(line);
 if(doc.space!=='production')throw Error('UNEXPECTED_SOURCE_SPACE');
 const collection=doc.collection_path?.split('/')[0];
 if(scope.has(collection))collections[collection].push(doc);
}
const quarantineHistoricalOrphans=process.argv.includes('--quarantine-historical');
const requireCompleteSource=process.argv.includes('--require-complete-source');
// Production migration must prove that the independent private archive
// contains every preserved document, including unnormalized domains.
// The legacy permissive mode is retained for isolated synthetic fixtures only.
if(quarantineHistoricalOrphans||requireCompleteSource){
 const option=process.argv.indexOf('--verified-archive');
 const dir=option>=0?process.argv[option+1]:null;
 if(!dir||dir.startsWith('--'))throw Error('VERIFIED_ARCHIVE_REQUIRED');
 await verifyArchiveBinding(src,dir);
}
const result=convertEflCore(collections,{quarantineHistoricalOrphans});
const ledger=convertEflTicketLedger(collections);
Object.assign(result.rows,ledger.rows);
result.report.tickets=ledger.report;
const trophyProjection=convertEflTrophies(collections);
Object.assign(result.rows,trophyProjection.rows);
result.report.trophies=trophyProjection.report;
const historicalRights=convertEflSeasonEntitlements(collections);
Object.assign(result.rows,historicalRights.rows);
result.report.historicalRights=historicalRights.report;
const controlHistory=convertEflClubControls(collections);
Object.assign(result.rows,controlHistory.rows);
result.report.clubControls=controlHistory.report;
const membershipHistory=convertEflMembershipHistory(collections);
Object.assign(result.rows,membershipHistory.rows);
result.report.membershipHistory=membershipHistory.report;
const uzeflifeHistory=convertUzeflifeHistory(collections);
Object.assign(result.rows,uzeflifeHistory.rows);
result.report.uzeflifeHistory=uzeflifeHistory.report;
const notificationRead=convertEflNotificationReadState(collections);
Object.assign(result.rows,notificationRead.rows);
result.report.notificationRead=notificationRead.report;
const matchdayHistory=convertEflMatchdayHistory(collections);
Object.assign(result.rows,matchdayHistory.rows);
result.report.matchdayHistory=matchdayHistory.report;
const banHistory=convertEflBanHistory(collections);
Object.assign(result.rows,banHistory.rows);
result.report.banHistory=banHistory.report;
const customHistory=convertEflCustomTournamentHistory(collections);
Object.assign(result.rows,customHistory.rows);
result.report.customTournamentHistory=customHistory.report;
const tagHistory=convertEflTelegramTagsHistory(collections);
Object.assign(result.rows,tagHistory.rows);
result.report.tagHistory=tagHistory.report;
const operationalHistory=convertEflOperationalHistory(collections);
Object.assign(result.rows,operationalHistory.rows);
result.report.operationalHistory=operationalHistory.report;
const teamTickets=convertEflTeamTicketLedger(collections);
Object.assign(result.rows,teamTickets.rows);
result.report.teamTickets=teamTickets.report;
const sealedHistory=convertEflSealedLegacyHistory(collections);
Object.assign(result.rows,sealedHistory.rows);
result.report.sealedHistory=sealedHistory.report;
if(collections.uzeflife.length>1)throw Error('MULTIPLE_UZEFLIFE_ROOTS');
if(collections.uzeflife.length===1){
 const projection=convertUzeflife(collections.uzeflife[0].data);
 Object.assign(result.rows,projection.rows);
 result.report.uzeflife=projection.report;
}
if(collections.team_league_preview_teams.length){
 const catalog=convertTeamsCatalog(collections.team_league_preview_teams,{
   knownUserIds:new Set(collections.users.map(doc=>doc.document_id))
 });
 Object.assign(result.rows,catalog.rows);
 result.report.teams=catalog.report;
}
// Emit every import table, even when it has no source rows. Full parity must
// compare explicit empty tables rather than implicitly omitting them.
for(const table of Object.keys(IMPORT_TABLES)){
 if(!Object.prototype.hasOwnProperty.call(result.rows,table))result.rows[table]=[];
}
for(const [table,rows] of Object.entries(result.rows)){
 for(let index=0;index<rows.length;index+=100)
  validateImportBatch({table,batchId:table+':'+String(index/100).padStart(8,'0'),rows:rows.slice(index,index+100)});
}
await writeFile(resolve(dest),JSON.stringify(result.rows)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({ok:true,...result.report,
 mappedRows:Object.fromEntries(Object.entries(result.rows).map(([k,v])=>[k,v.length]))}));
