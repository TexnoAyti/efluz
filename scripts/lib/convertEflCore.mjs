// Pure, offline mapping of verified legacy EFLUZ documents into staging rows.
// The legacy leagues/clubs are global: create season-scoped copies so ownership
// remains valid without claiming an older club belongs to the new season.
// Raw source archive is an independent prerequisite for lossless retention.
const nonempty=x=>typeof x==='string'&&x.trim()?x.trim():null;
const str=(x,fallback='')=>x==null?fallback:String(x);
const bool=x=>x===true||x===1;
export function epoch(value){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)
    return value>1e11?value:value*1000;
  if(typeof value==='string'){
    const n=Date.parse(value);
    if(Number.isFinite(n))return n;
  }
  throw Error('UNSUPPORTED_TIMESTAMP');
}
const time=(value,fallback=0)=>epoch(value)??fallback;
const score=x=>x==null?null:Number.isSafeInteger(x)&&x>=0&&x<=99?x:fail('INVALID_SCORE');
const jsonValue=x=>{if(x===undefined||x===null)return null;if(typeof x!=='string')return x;try{return JSON.parse(x);}catch{return {legacyText:x};}};
function fail(code){throw Error(code);}
const active=x=>str(x).toUpperCase()==='ACTIVE';
const relationId=(seasonId,id)=>'s'+seasonId.length+':'+seasonId+':'+id;
function source(collections,kind){
 const rows=collections[kind]??[];
 if(!Array.isArray(rows))fail('INVALID_SOURCE_COLLECTION');
 const map=new Map();
 for(const entry of rows){
  if(!entry||typeof entry!=='object'||!nonempty(entry.document_id)||
     !entry.data||typeof entry.data!=='object'||Array.isArray(entry.data))
    fail('INVALID_SOURCE_DOCUMENT');
  if(map.has(entry.document_id))fail('DUPLICATE_SOURCE_DOCUMENT');
  map.set(entry.document_id,{...entry.data});
 }
 return map;
}
const required=(value,code)=>nonempty(value)??fail(code);
export function convertEflCore(collections,options={}){
 // Historical records with vanished references must never gain fabricated
 // users or competitions. They can be quarantined only by explicit opt-in.
 const quarantine=options.quarantineHistoricalOrphans===true;
 const quarantined={releasedOccupancies:0,notifications:0,participants:0,resolvedDisputes:0};
 const users=source(collections,'users'),seasons=source(collections,'seasons');
 const leagues=source(collections,'leagues'),clubs=source(collections,'clubs');
 const competitions=source(collections,'competitions');
 const occupancies=source(collections,'club_occupancies');
 const fixtures=source(collections,'fixtures');
 const overrides=source(collections,'durable_fixture_overrides');
 const participants=source(collections,'competition_participants');
 const submissions=source(collections,'result_submissions');
 const disputes=source(collections,'disputes');
 const notifications=source(collections,'notifications');
 const auditLogs=source(collections,'audit_logs');
 // The base fixture is not safe to migrate if a durable correction diverges.
 // Production currently contains matching overrides, but verify every export
 // independently because source rows can change before the cutover snapshot.
 for(const [fixtureId,patch] of overrides){
  const fixture=fixtures.get(fixtureId);
  if(!fixture)fail('OVERRIDE_WITHOUT_FIXTURE');
  for(const key of ['status','homeScore','awayScore','homeClubId','awayClubId']){
   if(Object.hasOwn(patch,key)&&patch[key]!==fixture[key])
    fail('FIXTURE_OVERRIDE_MISMATCH');
  }
 }

 const output={users:[],seasons:[],leagues:[],clubs:[],competitions:[],
   clubOccupancies:[],fixtures:[],participants:[],resultSubmissions:[],
   disputes:[],matchAccess:[],notifications:[],auditLogs:[]};
 const userById=new Map();
 const canonicalUserIdById=new Map();
 const groups=new Map();
 for(const [id,d] of users){
  const telegram_id=required(str(d.telegramId),'USER_WITHOUT_TELEGRAM');
  const row={id,d,telegram_id,createdAt:time(d.createdAt)};
  const group=groups.get(telegram_id)??[];
  group.push(row);groups.set(telegram_id,group);
 }
 // Legacy source can contain repeated user documents for one Telegram identity.
 // Keep one deterministic canonical row for the normalized unique index, while
 // remapping every legacy reference and retaining every original row in the
 // private raw archive. Prefer an admin profile, then the newest profile.
 for(const [telegram_id,group] of groups){
  group.sort((a,b)=>Number(bool(b.d.isAdmin))-Number(bool(a.d.isAdmin))||
    b.createdAt-a.createdAt||a.id.localeCompare(b.id));
  const canonical=group[0];
  for(const row of group){
   canonicalUserIdById.set(row.id,canonical.id);
   userById.set(row.id,telegram_id);
  }
  const d=canonical.d;
  output.users.push({id:canonical.id,telegram_id,username:d.username??null,first_name:str(d.firstName),
   last_name:str(d.lastName),is_admin:bool(d.isAdmin),is_banned:bool(d.isSuspended),
   created_at:time(d.createdAt),updated_at:time(d.updatedAt,time(d.createdAt))});
 }
 for(const [id,d] of seasons){
  output.seasons.push({id,name:required(d.name,'SEASON_WITHOUT_NAME'),
   status:required(d.status,'SEASON_WITHOUT_STATUS').toUpperCase(),
   is_active:active(d.status),settings:{registrationOpen:bool(d.registrationOpen),
    sourceSeasonId:d.sourceSeasonId??null},starts_at:time(d.startDate)||null,
   ends_at:time(d.endDate)||null,created_at:time(d.createdAt),
   updated_at:time(d.updatedAt,time(d.createdAt))});
 }
 // Source leagues and clubs are global; each season receives its own identity.
 // Keep a reversible deterministic mapping for all cross-domain references.
 for(const [seasonId] of seasons){
  for(const [id,d] of leagues){
   output.leagues.push({id:relationId(seasonId,id),season_id:seasonId,
    name:required(d.name,'LEAGUE_WITHOUT_NAME'),country:str(d.country),
    continent:'EUROPE',logo_url:d.logoUrl??d.logo??null,
    capacity:20,sort_order:Number.isSafeInteger(d.tier)?d.tier:0,
    status:'CLOSED',current_round:0,
    created_at:time(d.createdAt),updated_at:time(d.updatedAt,time(d.createdAt))});
  }
  for(const [id,d] of clubs){
   const leagueId=required(d.leagueId,'CLUB_WITHOUT_LEAGUE');
   if(!leagues.has(leagueId))fail('CLUB_LEAGUE_MISSING');
   output.clubs.push({id:relationId(seasonId,id),
    league_id:relationId(seasonId,leagueId),
    name:required(d.name,'CLUB_WITHOUT_NAME'),short_name:str(d.shortName),
    country:str(d.country),logo_url:d.logoUrl??d.logo??null,
    stadium:'',sort_order:0,created_at:time(d.createdAt),
    updated_at:time(d.updatedAt,time(d.createdAt))});
  }
 }
 const competitionSeason=new Map();
 for(const [id,d] of competitions){
  const seasonId=required(d.seasonId,'COMPETITION_WITHOUT_SEASON');
  if(!seasons.has(seasonId))fail('COMPETITION_SEASON_MISSING');
  competitionSeason.set(id,seasonId);
  if(d.leagueId!=null&&!leagues.has(d.leagueId))fail('COMPETITION_LEAGUE_MISSING');
  output.competitions.push({id,season_id:seasonId,
   league_id:d.leagueId==null?null:relationId(seasonId,d.leagueId),
   name:required(d.name,'COMPETITION_WITHOUT_NAME'),
   type:required(d.type,'COMPETITION_WITHOUT_TYPE'),
   schedule_mode:str(d.scheduleMode,'GENERATED_SCHEDULE'),
   status:required(d.status,'COMPETITION_WITHOUT_STATUS'),
   format_config:d.formatConfig??null,
   current_matchday:d.currentMatchday??null,
   is_matchday_open:bool(d.isMatchdayOpen),
   created_at:time(d.createdAt),updated_at:time(d.updatedAt,time(d.createdAt))});
 }
 const uniqueClubOwner=new Set(),uniquePlayerLeague=new Set();
 const currentOwners=new Map();
 for(const [id,d] of occupancies){
  const seasonId=required(d.seasonId,'OCCUPANCY_WITHOUT_SEASON');
  const clubId=required(d.clubId,'OCCUPANCY_WITHOUT_CLUB');
  const userId=d.userId==null?null:String(d.userId);
  if(!seasons.has(seasonId)||!clubs.has(clubId))
    fail('OCCUPANCY_REFERENCE_MISSING');
  if(!userId||!users.has(userId)){
    if(quarantine&&str(d.status).toUpperCase()==='RELEASED'){
      quarantined.releasedOccupancies++;continue;
    }
    fail('OCCUPANCY_REFERENCE_MISSING');
  }
  const leagueId=required(clubs.get(clubId).leagueId,'CLUB_WITHOUT_LEAGUE');
  const telegram_id=userById.get(userId);
  const canonicalUserId=canonicalUserIdById.get(userId)??userId;
  const status=str(d.status,'RELEASED').toUpperCase();
  if(status==='ACTIVE'){
   const canonicalUserId=canonicalUserIdById.get(userId);
   const cKey=seasonId+':'+clubId,pKey=seasonId+':'+leagueId+':'+canonicalUserId;
   if(uniqueClubOwner.has(cKey))fail('DUPLICATE_ACTIVE_CLUB');
   if(uniquePlayerLeague.has(pKey))fail('SECOND_CLUB_IN_LEAGUE');
   uniqueClubOwner.add(cKey);uniquePlayerLeague.add(pKey);
   currentOwners.set(cKey,telegram_id);
  }
  output.clubOccupancies.push({id,season_id:seasonId,
    league_id:relationId(seasonId,leagueId),
    club_id:relationId(seasonId,clubId),user_id:canonicalUserId,telegram_id,
    status,joined_at:time(d.claimedAt),
    released_at:time(d.releasedAt)||null,
    updated_at:time(d.updatedAt,time(d.claimedAt))});
 }
 for(const [id,d] of fixtures){
  const seasonId=required(d.seasonId,'FIXTURE_WITHOUT_SEASON');
  const compId=required(d.competitionId,'FIXTURE_WITHOUT_COMPETITION');
  if(competitionSeason.get(compId)!==seasonId)fail('FIXTURE_COMPETITION_SEASON_MISMATCH');
  const comp=competitions.get(compId);
  const home=d.homeClubId??null,away=d.awayClubId??null;
  for(const club of [home,away])if(club!==null&&!clubs.has(club))fail('FIXTURE_CLUB_MISSING');
  const status=str(d.status,'SCHEDULED').toUpperCase();
  const isConfirmed=status==='CONFIRMED';
  if(isConfirmed&&(score(d.homeScore)===null||score(d.awayScore)===null))
    fail('CONFIRMED_SCORE_MISSING');
  const round=d.matchday;
  if(!Number.isSafeInteger(round)||round<0)fail('INVALID_MATCHDAY');
  const homeTelegram=home?currentOwners.get(seasonId+':'+home)??null:null;
  const awayTelegram=away?currentOwners.get(seasonId+':'+away)??null:null;
  output.fixtures.push({id,season_id:seasonId,
    competition_id:compId,league_id:comp.leagueId==null?null:relationId(seasonId,comp.leagueId),
    round,home_club_id:home?relationId(seasonId,home):null,
    away_club_id:away?relationId(seasonId,away):null,
    home_telegram_id:homeTelegram,away_telegram_id:awayTelegram,
    home_score:score(d.homeScore),away_score:score(d.awayScore),status,
    confirmation_status:isConfirmed?'CONFIRMED':'NONE',
    scheduled_at:time(d.scheduledAt)||null,
    played_at:time(d.resultConfirmedAt)||null,
    updated_at:time(d.updatedAt)});
  if(homeTelegram&&awayTelegram&&homeTelegram!==awayTelegram)
    output.matchAccess.push({match_id:id,home_telegram_id:homeTelegram,
      away_telegram_id:awayTelegram,writable:false,updated_at:time(d.updatedAt)});
 }
 for(const [id,d] of participants){
  const seasonId=required(d.seasonId,'PARTICIPANT_WITHOUT_SEASON');
  const compId=required(d.competitionId,'PARTICIPANT_WITHOUT_COMPETITION');
  if(!clubs.has(d.clubId)||!seasons.has(seasonId))
    fail('PARTICIPANT_REFERENCE_MISSING');
  if(!competitionSeason.has(compId)){
    if(quarantine){quarantined.participants++;continue;}
    fail('PARTICIPANT_REFERENCE_MISSING');
  }
  if(competitionSeason.get(compId)!==seasonId)
    fail('PARTICIPANT_REFERENCE_MISSING');
  output.participants.push({id,competition_id:compId,season_id:seasonId,
   club_id:relationId(seasonId,d.clubId),owner_user_id:d.ownerUserId==null?null:canonicalUserIdById.get(d.ownerUserId)??d.ownerUserId,
   seed_number:Number.isSafeInteger(d.seedNumber)?d.seedNumber:null,
   source_competition_id:d.sourceCompetitionId??null,
   source_position:Number.isSafeInteger(d.sourcePosition)?d.sourcePosition:null,
   qualification_reason:d.qualificationReason??null,created_at:time(d.createdAt)});
 }
 for(const [id,d] of submissions){
  const fid=required(d.fixtureId,'SUBMISSION_WITHOUT_FIXTURE');
  const f=fixtures.get(fid);if(!f)fail('SUBMISSION_FIXTURE_MISSING');
  if(!clubs.has(d.clubId)||!users.has(d.submittedByUserId))
    fail('SUBMISSION_OWNER_MISSING');
  const row={id,fixture_id:fid,submitted_by_user_id:canonicalUserIdById.get(d.submittedByUserId)??d.submittedByUserId,
   club_id:relationId(f.seasonId,d.clubId),home_score:score(d.homeScore),
   away_score:score(d.awayScore),proof_url:d.proofUrl??null,
   created_at:time(d.createdAt)};
  for(const side of ['homeExtraTimeScore','awayExtraTimeScore','homePenaltyScore','awayPenaltyScore']){
   const snake=side.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
   row[snake]=score(d[side]);
  }
  output.resultSubmissions.push(row);
 }
 for(const [id,d] of disputes){
  const fid=required(d.fixtureId,'DISPUTE_WITHOUT_FIXTURE');
  const f=fixtures.get(fid);
  if(!f){
   // Missing fixture references are permitted only for already-resolved
   // historical disputes and only with explicit archival quarantine.
   // Open or pending disputes are never discarded.
   if(quarantine&&['RESOLVED','CLOSED','DISMISSED'].includes(str(d.status).toUpperCase())){
    quarantined.resolvedDisputes++;continue;
   }
   fail('DISPUTE_FIXTURE_MISSING');
  }
  output.disputes.push({id,fixture_id:fid,season_id:required(d.seasonId,'DISPUTE_WITHOUT_SEASON'),
   home_submission_id:d.homeSubmissionId??null,
   away_submission_id:d.awaySubmissionId??null,
   status:required(d.status,'DISPUTE_WITHOUT_STATUS'),
   resolved_by_user_id:d.resolvedByUserId==null?null:canonicalUserIdById.get(d.resolvedByUserId)??d.resolvedByUserId,
   resolution_notes:d.resolutionNotes??null,
   created_at:time(d.createdAt),resolved_at:time(d.resolvedAt)||null});
 }
 for(const [id,d] of notifications){
  if(!users.has(d.userId)){
    if(quarantine){quarantined.notifications++;continue;}
    fail('NOTIFICATION_USER_MISSING');
  }
  output.notifications.push({id,user_id:canonicalUserIdById.get(d.userId)??d.userId,
   type:required(d.type,'NOTIFICATION_WITHOUT_TYPE'),
   title:str(d.title),message:str(d.message),data:d.data??null,
   is_read:bool(d.isRead),created_at:time(d.createdAt)});
 }
 for(const [id,d] of auditLogs){
  // System jobs have no actor; preserve without attributing to an admin.
  output.auditLogs.push({id,actor_user_id:d.actorUserId==null?'SYSTEM':canonicalUserIdById.get(d.actorUserId)??str(d.actorUserId),
   actor_username:str(d.actorUsername),action:required(d.action,'AUDIT_WITHOUT_ACTION'),
   entity_type:str(d.entityType,'SYSTEM'),entity_id:str(d.entityId,id),
   old_value:jsonValue(d.oldValueJson),new_value:jsonValue(d.newValueJson),
   created_at:time(d.createdAt,time(d.timestamp))});
 }
 return {rows:output,report:{mappedTables:Object.keys(output),
   scopedLeagueCopies:output.leagues.length,scopedClubCopies:output.clubs.length,
   sourceFixtures:fixtures.size,reconciledFixtureOverrides:overrides.size,notificationsPreserved:output.notifications.length,
   auditLogsPreserved:output.auditLogs.length,
   quarantinedHistorical:quarantined,stagingMatchAccessWritable:false,
   requiresLegacyArchive:true,cutoverReady:false}};
}
