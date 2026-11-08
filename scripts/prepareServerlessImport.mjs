#!/usr/bin/env node
// Converts an already-normalized, consistent snapshot to repeatable import
// packets. No network, credentials, database connections or production writes.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateImportBatch,IMPORT_TABLES,PRIMARY_KEYS,stableRow} from '../tgcloud/lib/importBatch.js';

const order=['users','seasons','leagues','clubs','competitions','participants','clubOccupancies','fixtures','resultSubmissions','disputes','notifications','auditLogs','notificationReadState','matchdayLockHistory','matchDeadlineHistory','ticketBalances','ticketTransactions','teamTicketBalances','teamTicketTransactions','ticketIdempotencyHistory','playerTrophies','retentionDecisions','premiumEntitlements','clubAdmissions','clubSelectionBans','banAuditHistory','banControlHistory','customTournamentHistory','customTournamentParticipantHistory','customTournamentFixtureHistory','customTournamentAuditHistory','telegramTagHistory','telegramTagStateHistory','matchChatRoomHistory','matchdayJobHistory','standingsHistory','clubMembershipHistory','userMembershipHistory','matchAccess','matchMessages','uzeflifeState','uzeflifeEntrants','uzeflifeFixtures','uzeflifeAuditHistory','uzeflifeNoticeHistory','teamsCatalog','teamMembers','sealedLegacyHistory','rawDocuments','rawDocumentParts'];
const MAX_PACKET_BYTES=98304; // Telegram Serverless import payload safety bound
const input=process.argv[2], directory=process.argv[3];
if(!input || !directory) {
  console.error('Usage: node scripts/prepareServerlessImport.mjs normalized-snapshot.json output-folder');
  process.exit(2);
}
const normalized=JSON.parse(await readFile(resolve(input),'utf8'));
if(!normalized || typeof normalized!=='object' || Array.isArray(normalized) ||
  Object.keys(normalized).some(table=>!order.includes(table))) throw new Error('INVALID_SNAPSHOT');
try { await stat(resolve(directory)); throw new Error('OUTPUT_DIRECTORY_ALREADY_EXISTS'); }
catch(error) { if(error.code!=='ENOENT')throw error; }
await mkdir(resolve(directory),{recursive:false,mode:0o700});
const manifest={schemaVersion:1,chunkSize:100,maxPacketBytes:MAX_PACKET_BYTES,tables:{},order};
for(const table of order) {
  const list=normalized[table] ?? [];
  if(!Array.isArray(list)) throw new Error('INVALID_TABLE_'+table);
  const pk=PRIMARY_KEYS[table], seen=new Set(), chunks=[];
  const sorted=[...list].sort((a,b)=>String(a[pk]).localeCompare(String(b[pk]),'en',{numeric:true}));
  // Respect both maximum row count and maximum serialized packet size.
  // Some legacy rows are much larger than an average user/fixture record.
  let batchRows=[],batchIndex=0;
  const emit=async()=>{
    if(!batchRows.length)return;
    const suffix=String(batchIndex).padStart(8,'0');
    const batchId=table+':'+suffix;
    const batch={table,batchId,rows:batchRows};
    validateImportBatch(batch);
    const payload=JSON.stringify(batch);
    const bytes=Buffer.byteLength(payload,'utf8');
    if(bytes>MAX_PACKET_BYTES)throw new Error('OVERSIZED_IMPORT_BATCH_'+table);
    const file=table+'-'+suffix+'.json';
    await writeFile(join(resolve(directory),file),payload+'\\n',{flag:'wx',mode:0o600});
    chunks.push({batchId,file,rows:batchRows.length,bytes,sha256:createHash('sha256').update(payload).digest('hex')});
    batchRows=[];batchIndex++;
  };
  for(const row of sorted){
    const key=String(row[pk]);
    if(seen.has(key))throw new Error('DUPLICATE_SOURCE_ID_'+table);
    seen.add(key);
    // Validate the complete row independently so even a single oversize row
    // cannot be smuggled into the target archive.
    validateImportBatch({table,batchId:table+':validation',rows:[row]});
    if(batchRows.length===100)await emit();
    const candidate=[...batchRows,row];
    const candidateBytes=Buffer.byteLength(JSON.stringify({
      table,batchId:table+':'+String(batchIndex).padStart(8,'0'),rows:candidate
    }),'utf8');
    if(candidateBytes>MAX_PACKET_BYTES){
      await emit();
      const singleBytes=Buffer.byteLength(JSON.stringify({
        table,batchId:table+':'+String(batchIndex).padStart(8,'0'),rows:[row]
      }),'utf8');
      if(singleBytes>MAX_PACKET_BYTES)throw new Error('OVERSIZED_IMPORT_ROW_'+table);
    }
    batchRows.push(row);
  }
  await emit();
  const digest=createHash('sha256');
  for(const row of sorted) digest.update(stableRow(row,IMPORT_TABLES[table])+'\n');
  manifest.tables[table]={count:sorted.length,sha256:digest.digest('hex'),chunks};
}
await writeFile(join(resolve(directory),'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'w',mode:0o600});
console.log('Packet manifest written. Verify using the offline verifier before staging import.');
