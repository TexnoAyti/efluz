// Offline structural checks before importing a snapshot.
// Reports broken source references without modifying any database.
import {readFile} from 'node:fs/promises';

export function validateSnapshotReferences(snapshot) {
  const errors=[];
  const get=(table)=>Array.isArray(snapshot[table])?snapshot[table]:[];
  const ids=(table)=>new Set(get(table).map(x=>String(x.id)));
  const users=ids('users'),seasons=ids('seasons'),leagues=ids('leagues'),
        clubs=ids('clubs'),competitions=ids('competitions'),
        fixtures=ids('fixtures'),submissions=ids('resultSubmissions');
  const checks=[
    ['leagues',[['season_id',seasons]]],
    ['clubs',[['league_id',leagues]]],
    ['competitions',[['season_id',seasons],['league_id',leagues]]],
    ['clubOccupancies',[['user_id',users],['season_id',seasons],['league_id',leagues],['club_id',clubs]]],
    ['participants',[['competition_id',competitions],['season_id',seasons],['club_id',clubs],['owner_user_id',users]]],
    ['fixtures',[['season_id',seasons],['competition_id',competitions],['league_id',leagues],['home_club_id',clubs],['away_club_id',clubs]]],
    ['resultSubmissions',[['fixture_id',fixtures],['submitted_by_user_id',users],['club_id',clubs]]],
    ['disputes',[['fixture_id',fixtures],['season_id',seasons],['home_submission_id',submissions],['away_submission_id',submissions],['resolved_by_user_id',users]]],
    ['notifications',[['user_id',users]]],
    ['auditLogs',[['actor_user_id',users]]],
    ['matchAccess',[['match_id',fixtures]]],
    ['matchMessages',[['match_id',fixtures]]],
  ];
  for(const [table,fields] of checks){
    for(const row of get(table)){
      for(const [field,related] of fields){
        const value=row[field];
        if(value===null||value===undefined||value==='') continue;
        if(!related.has(String(value))) errors.push({table,id:row.id??row.match_id,field,code:'MISSING_REFERENCE'});
      }
    }
  }
  const activeClubs=new Set();
  for(const row of get('clubOccupancies')){
    if(String(row.status).toUpperCase()!=='ACTIVE')continue;
    const unique=String(row.season_id)+':'+String(row.club_id);
    if(activeClubs.has(unique))errors.push({table:'clubOccupancies',id:row.id,field:'club_id',code:'DOUBLE_OWNER'});
    activeClubs.add(unique);
  }
  return {ok:errors.length===0,errors};
}
if(process.argv[1]?.endsWith('validateServerlessReferences.mjs')){
  const file=process.argv[2];
  if(!file){console.error('Usage: node scripts/validateServerlessReferences.mjs normalized-snapshot.json');process.exit(2);}
  const {ok,errors}=validateSnapshotReferences(JSON.parse(await readFile(file,'utf8')));
  console.log(JSON.stringify({ok,errorCount:errors.length,errors:errors.slice(0,100)},null,2));
  if(!ok)process.exitCode=1;
}
