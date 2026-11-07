#!/usr/bin/env node
// Read-only source graph audit. Input: private PostgreSQL JSONL export.
// No personal information, user IDs or score details are ever printed.
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';

const path=process.argv[2];
if(!path){console.error('Usage: node scripts/auditEflDomainGraph.mjs private-source.jsonl');process.exit(2);}
const interesting=new Set(['users','seasons','leagues','clubs','club_occupancies',
  'competitions','competition_participants','fixtures','result_submissions',
  'disputes','durable_fixture_overrides','notifications']);
const roots=new Map([...interesting].map(name=>[name,new Map()]));
const errors={};
function defect(type){errors[type]=(errors[type]||0)+1;}
function id(d){return String(d.id||'');}
for await(const line of createInterface({input:createReadStream(path,{encoding:'utf8'}),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const doc=JSON.parse(line);
 if(doc.space!=='production'||typeof doc.collection_path!=='string'||!doc.data||
    typeof doc.data!=='object'||Array.isArray(doc.data))throw Error('INVALID_SOURCE');
 const root=doc.collection_path.split('/')[0];
 if(!interesting.has(root))continue;
 const key=String(doc.document_id||'');
 if(!key)throw Error('INVALID_SOURCE_ID');
 const set=roots.get(root);
 if(set.has(key))defect('DUPLICATE_SOURCE_ID');
 else set.set(key,doc.data);
}
const s=type=>roots.get(type);
const owns=(type,value)=>value==null||value===''||s(type).has(String(value));
for(const d of s('clubs').values())if(!owns('leagues',d.leagueId))defect('CLUB_WITHOUT_LEAGUE');
for(const d of s('competitions').values()){
 if(!owns('seasons',d.seasonId))defect('COMPETITION_WITHOUT_SEASON');
 if(!owns('leagues',d.leagueId))defect('COMPETITION_WITHOUT_LEAGUE');
}
const activeByClub=new Set(),activeByUserLeague=new Set();
for(const d of s('club_occupancies').values()){
 if(!owns('users',d.userId))defect('OCCUPANCY_WITHOUT_USER');
 if(!owns('seasons',d.seasonId))defect('OCCUPANCY_WITHOUT_SEASON');
 if(!owns('clubs',d.clubId))defect('OCCUPANCY_WITHOUT_CLUB');
 if(String(d.status).toUpperCase()!=='ACTIVE')continue;
 const clubKey=String(d.seasonId)+':'+String(d.clubId);
 if(activeByClub.has(clubKey))defect('DUPLICATE_ACTIVE_CLUB');
 activeByClub.add(clubKey);
 const leagueId=s('clubs').get(String(d.clubId))?.leagueId;
 if(!leagueId)continue;
 const userKey=String(d.seasonId)+':'+String(leagueId)+':'+String(d.userId);
 if(activeByUserLeague.has(userKey))defect('SECOND_CLUB_SAME_LEAGUE');
 activeByUserLeague.add(userKey);
}
let pendingOpponentCount=0,confirmedCount=0;
for(const d of s('fixtures').values()){
 if(!owns('seasons',d.seasonId))defect('FIXTURE_WITHOUT_SEASON');
 if(!owns('competitions',d.competitionId))defect('FIXTURE_WITHOUT_COMPETITION');
 for(const side of ['homeClubId','awayClubId']){
  if(d[side]===null||d[side]===undefined||d[side]===''){pendingOpponentCount++;continue;}
  if(!owns('clubs',d[side]))defect('FIXTURE_WITHOUT_CLUB');
 }
 if(String(d.status).toUpperCase()==='CONFIRMED'){
  confirmedCount++;
  if(!Number.isSafeInteger(d.homeScore)||d.homeScore<0||
     !Number.isSafeInteger(d.awayScore)||d.awayScore<0)
    defect('CONFIRMED_WITHOUT_VALID_SCORE');
 }
}
for(const d of s('competition_participants').values()){
 if(!owns('seasons',d.seasonId))defect('PARTICIPANT_WITHOUT_SEASON');
 if(!owns('clubs',d.clubId))defect('PARTICIPANT_WITHOUT_CLUB');
 if(!owns('competitions',d.competitionId))defect('PARTICIPANT_WITHOUT_COMPETITION');
}
for(const d of s('result_submissions').values()){
 if(!owns('users',d.submittedByUserId))defect('SUBMISSION_WITHOUT_USER');
 if(!owns('fixtures',d.fixtureId))defect('SUBMISSION_WITHOUT_FIXTURE');
 if(!owns('clubs',d.clubId))defect('SUBMISSION_WITHOUT_CLUB');
}
// Do not create fabricated Telegram identities for deleted or missing users.
// Notification history can remain in the private archive until explicitly
// reconciled, but is never silently omitted from a normalized live import.
for(const d of s('notifications').values()){
 if(!owns('users',d.userId)||!d.userId)
  defect('NOTIFICATION_WITHOUT_USER');
}
for(const d of s('disputes').values()){
 if(!owns('fixtures',d.fixtureId))defect('DISPUTE_WITHOUT_FIXTURE');
}
// Legacy durable overrides are part of the authoritative fixture state.
// Refuse a migration snapshot where the base fixture and override disagree:
// standings, cup brackets and award outcomes would otherwise diverge.
let reconciledOverrides=0;
for(const [fixtureId,override] of s('durable_fixture_overrides')){
 const fixture=s('fixtures').get(fixtureId);
 if(!fixture){defect('OVERRIDE_WITHOUT_FIXTURE');continue;}
 const keys=['status','homeScore','awayScore','homeClubId','awayClubId'];
 if(keys.some(key=>Object.hasOwn(override,key)&&override[key]!==fixture[key]))
  defect('FIXTURE_OVERRIDE_MISMATCH');
 else reconciledOverrides++;
}
const globalLeagueRows=[...s('leagues').values()].filter(d=>!d.seasonId).length;
const result={ok:Object.keys(errors).length===0,
 counts:Object.fromEntries([...roots].map(([name,items])=>[name,items.size])),
 confirmedFixtures:confirmedCount,pendingOpponentSlots:pendingOpponentCount,
 fixtureOverrides:s('durable_fixture_overrides').size,
 reconciledFixtureOverrides:reconciledOverrides,
 globalLeagueRowsNeedingSeasonMapping:globalLeagueRows,errorsByType:errors,
 cutoverReady:false};
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
