#!/usr/bin/env node
// Offline migration completion preflight. Reads only protected local files.
// Never touches production, Telegram SDK, Web App or a live database.
// Passing means offline data evidence is present, NOT an authorized cutover.
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyArchiveBinding} from './lib/verifyArchiveBinding.mjs';
const [source,archive,normalizedSource,normalizedTarget]=process.argv.slice(2);
if(!source||!archive||!normalizedSource||!normalizedTarget){
 console.error('Usage: node scripts/preflightEflCompleteMigration.mjs private-source.jsonl private-archive-dir private-normalized-source.json private-normalized-target.json');
 process.exit(2);
}
const inventory=JSON.parse(await readFile(new URL('../migration/source-collections-inventory.json',import.meta.url),'utf8'));
if(!inventory||!Array.isArray(inventory.collections))throw Error('INVALID_INVENTORY_POLICY');
const policy=new Map(inventory.collections.map(row=>[row.collection,row.handling]));
if(policy.size!==inventory.collections.length)throw Error('DUPLICATE_POLICY_COLLECTION');
const counts={preserve:0,rebuild:0,review:0,unknown:0};
const collections=new Map(),seen=new Set();
for await(const line of createInterface({input:createReadStream(resolve(source),{encoding:'utf8'}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const doc=JSON.parse(line);
 if(!doc||doc.space!=='production'||typeof doc.collection_path!=='string'||
    !doc.collection_path||typeof doc.document_id!=='string'||!doc.document_id)
  throw Error('INVALID_SOURCE_DOCUMENT');
 const full=JSON.stringify([doc.collection_path,doc.document_id]);
 if(seen.has(full))throw Error('DUPLICATE_SOURCE_DOCUMENT');
 seen.add(full);
 const root=doc.collection_path.split('/')[0],decision=policy.get(root)??'unknown';
 counts[decision]++;
 collections.set(root,(collections.get(root)??0)+1);
}
const unknownRoots=[...collections.keys()].filter(k=>!policy.has(k)).sort();
const reviewedRoots=[...collections.keys()].filter(k=>policy.get(k)==='review').sort();
const blockers=[];
if(unknownRoots.length)blockers.push('UNKNOWN_SOURCE_COLLECTIONS');
if(reviewedRoots.length)blockers.push('REVIEW_SOURCE_COLLECTIONS');
let archiveVerified=false,sourceTargetParity=false,sourceNormalizedBound=false;
if(blockers.length===0){
 try{await verifyArchiveBinding(source,archive);archiveVerified=true;}
 catch{blockers.push('SOURCE_ARCHIVE_MISMATCH_OR_MISSING');}
 if(archiveVerified){
  const verifier=fileURLToPath(new URL('./verifyServerlessSnapshot.mjs',import.meta.url));
  // Archive completeness is not normalized domain completeness. A source user,
  // fixture or payment must also exist in the corresponding operational table.
  const operationalMapping={
   users:'users',seasons:'seasons',competitions:'competitions',fixtures:'fixtures',
   club_occupancies:'clubOccupancies',
   competition_participants:'participants',
   result_submissions:'resultSubmissions',disputes:'disputes',
   notifications:'notifications',audit_logs:'auditLogs',
   user_tickets:'ticketBalances',ticket_transactions:'ticketTransactions',
   player_trophies:'playerTrophies',
   season2_retention_decisions:'retentionDecisions',
   premium_entitlements:'premiumEntitlements',
   club_admissions:'clubAdmissions',club_selection_bans:'clubSelectionBans',
   club_memberships:'clubMembershipHistory',user_memberships:'userMembershipHistory',
   uzeflife_audit:'uzeflifeAuditHistory',uzeflife_notifications:'uzeflifeNoticeHistory',
   uzeflife:'uzeflifeState'
  };
  let projectionComplete=true;
  try{
   const projected=JSON.parse(await readFile(resolve(normalizedSource),'utf8'));
   const seasons=collections.get('seasons')??0;
   const checks=Object.entries(operationalMapping).map(([root,table])=>[
     root,table,collections.get(root)??0
   ]);
   checks.push(['leagues','leagues',(collections.get('leagues')??0)*seasons]);
   checks.push(['clubs','clubs',(collections.get('clubs')??0)*seasons]);
   projectionComplete=checks.every(([,table,expected])=>
     Array.isArray(projected[table])&&projected[table].length===expected);
  }catch{projectionComplete=false;}
  if(!projectionComplete)blockers.push('SOURCE_PROJECTION_COVERAGE_MISMATCH');
  if(projectionComplete){
   const binding=fileURLToPath(new URL('./verifyEflNormalizedSourceBinding.mjs',import.meta.url));
   const replay=spawnSync(process.execPath,[binding,resolve(source),resolve(archive),
    resolve(normalizedSource)],{encoding:'utf8',maxBuffer:1024*1024,timeout:210000});
   sourceNormalizedBound=replay.status===0;
   if(!sourceNormalizedBound)blockers.push('SOURCE_NORMALIZED_BINDING_FAILED');
  }
  const run=projectionComplete&&sourceNormalizedBound?
   spawnSync(process.execPath,[verifier,resolve(normalizedSource),resolve(normalizedTarget)],{
    encoding:'utf8',maxBuffer:1024*1024,timeout:210000
   }):null;
  sourceTargetParity=run!==null&&run.status===0&&run.stdout.includes('PARITY_OK:');
  if(projectionComplete&&sourceNormalizedBound&&!sourceTargetParity)
   blockers.push('NORMALIZED_TARGET_PARITY_FAILED');
 }
}
const result={
 offlineDataVerified:blockers.length===0&&archiveVerified&&sourceTargetParity,
 sourceDocuments:seen.size,sourceCollections:collections.size,
 counts,unknownRoots,reviewedRoots,archiveVerified,sourceNormalizedBound,sourceTargetParity,
 blockers,telegramSdkVerified:false,productionWriteFreezeVerified:false,
 cutoverReady:false,
 note:'Full data parity is only an offline gate. Telegram-hosted SDK verification, application feature parity, a consistent final delta, and authorized rollback remain mandatory.'
};
console.log(JSON.stringify(result,null,2));
if(!result.offlineDataVerified)process.exitCode=1;
