// First-party Telegram Serverless read-only API bridge for EFLUZ.
// In Serverless mode never contact the legacy Vercel /api origin.
// Only explicitly mapped, response-validated GET operations are allowed.
// Legacy session tokens and Telegram initData must never be forwarded.
import {callEflTransport, type EflOperation} from './serverlessTransport';
import {normalizeNativeFixture} from './nativeFixtureAdapter';

type Mapping = {operation:EflOperation; input:Record<string,unknown>; shape:'health'|'seasons'|'leagues'|'leagueClubs'|'clubDetail'|'clubFixtures'|'fixtureDetail'|'competitions'|'fixtures'|'notifications'|'competitionFixtures'};
function pathOf(endpoint:string):URL {
  if (!endpoint.startsWith('/api/') || endpoint.startsWith('//'))
    throw new Error('SERVERLESS_RELATIVE_API_ONLY');
  return new URL(endpoint,'https://efl-staging.invalid');
}
export function mapEflReadRequest(endpoint:string,method='GET'):Mapping {
  if (method.toUpperCase() !== 'GET') throw new Error('SERVERLESS_WRITE_NOT_MIGRATED');
  const url=pathOf(endpoint);
  const path=url.pathname;
  const seasonId=url.searchParams.get('seasonId')||'season-2026-27';
  if (!/^season-20\d\d-\d\d$/.test(seasonId))
    throw new Error('SERVERLESS_INVALID_SEASON');
  if (path==='/api/health') return {operation:'health',input:{},shape:'health'};
  if (path==='/api/seasons') return {operation:'seasons',input:{},shape:'seasons'};
  if (path==='/api/leagues') return {operation:'leagues',input:{seasonId},shape:'leagues'};
  const leagueClubsMatch=/^\/api\/leagues\/([a-zA-Z0-9_:-]{1,120})\/clubs$/.exec(path);
  if(leagueClubsMatch && url.searchParams.has('seasonId'))
    return {operation:'leagueClubs',input:{seasonId,leagueId:leagueClubsMatch[1]},shape:'leagueClubs'};
  const clubFixtureMatch=/^\/api\/clubs\/([A-Za-z0-9_:-]{1,120})\/fixtures$/.exec(path);
  if(clubFixtureMatch && url.searchParams.has('seasonId'))
    return {operation:'clubFixtures',input:{clubId:clubFixtureMatch[1],seasonId},shape:'clubFixtures'};
  const clubDetailMatch=/^\/api\/clubs\/([A-Za-z0-9_:-]{1,120})$/.exec(path);
  if(clubDetailMatch && url.searchParams.has('seasonId'))
    return {operation:'clubDetail',input:{clubId:clubDetailMatch[1],seasonId},shape:'clubDetail'};
  const fixtureDetailMatch=/^\/api\/fixtures\/([A-Za-z0-9_:-]{1,120})$/.exec(path);
  if(fixtureDetailMatch)
    return {operation:'fixtureDetail',input:{fixtureId:fixtureDetailMatch[1]},shape:'fixtureDetail'};
  if (path==='/api/competitions' && !url.searchParams.has('view'))
    return {operation:'competitions',input:{seasonId,limit:100},shape:'competitions'};
  // Domestic cup bracket reads have their own scoped endpoint. Do not use
  // the general fixtures feed because its schema and pagination differ.
  const cupMatch=/^\/api\/competitions\/([a-zA-Z0-9_:-]{1,120})\/fixtures$/.exec(path);
  if(cupMatch && !url.searchParams.has('status') && !url.searchParams.has('matchday'))
    return {operation:'competitionDetail',input:{competitionId:cupMatch[1],seasonId,limit:100},shape:'competitionFixtures'};
  if (path==='/api/me/matches' && !url.searchParams.has('status'))
    return {operation:'myFixtures',input:{seasonId,limit:100},shape:'fixtures'};
  if (path==='/api/me/notifications')
    return {operation:'notifications',input:{limit:50},shape:'notifications'};
  throw new Error('SERVERLESS_ROUTE_NOT_MIGRATED');
}
export function normalizeEflReadResponse(mapping:Mapping,response:unknown):unknown {
  if (!response||typeof response!=='object'||(response as {ok?:boolean}).ok!==true)
    throw new Error('SERVERLESS_RESPONSE_UNVERIFIED');
  const item=response as Record<string,unknown>;
  if(mapping.shape==='health') {
    if(item.service!=='efluz-serverless')throw new Error('SERVERLESS_WRONG_SERVICE');
    return item;
  }
  if(mapping.shape==='seasons'){
    if(!Array.isArray(item.seasons))throw new Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
    const seasons=item.seasons.map((value:unknown)=>{
      if(!value||typeof value!=='object')throw new Error('SERVERLESS_SEASON_CONTRACT_MISMATCH');
      const row=value as Record<string,unknown>;
      if(typeof row.id!=='string'||!/^season-20\d{2}-\d{2}$/.test(row.id)||
         typeof row.name!=='string'||!['active','registration','upcoming','completed'].includes(String(row.status)))
        throw new Error('SERVERLESS_SEASON_CONTRACT_MISMATCH');
      return value;
    });
    return {seasons};
  }
  if(mapping.shape==='leagues'){
    if(!Array.isArray(item.leagues))throw new Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
    const leagues=item.leagues.map((value:unknown)=>{
      if(!value||typeof value!=='object')throw new Error('SERVERLESS_LEAGUE_CONTRACT_MISMATCH');
      const row=value as Record<string,unknown>;
      if(typeof row.id!=='string'||!row.id||typeof row.name!=='string'||typeof row.country!=='string')
        throw new Error('SERVERLESS_LEAGUE_CONTRACT_MISMATCH');
      return {...row,logoUrl:typeof row.logoUrl==='string'?row.logoUrl:'',
        totalClubs:Number.isSafeInteger(row.capacity)?row.capacity:undefined,
        tier:1,createdAt:typeof row.createdAt==='string'?row.createdAt:''};
    });
    return {leagues};
  }
  if(mapping.shape==='leagueClubs'){
    if(!Array.isArray(item.clubs))throw new Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
    const clubs=item.clubs.map((value:unknown)=>{
      if(!value||typeof value!=='object')throw new Error('SERVERLESS_CLUB_CONTRACT_MISMATCH');
      const row=value as Record<string,unknown>;
      if(typeof row.id!=='string'||!row.id||typeof row.name!=='string'||
        typeof row.leagueId!=='string'||typeof row.country!=='string'||
        typeof row.shortName!=='string')
        throw new Error('SERVERLESS_CLUB_CONTRACT_MISMATCH');
      return {...row,isTaken:row.isTaken===true,isCurrentUserClub:row.isCurrentUserClub===true,
        active:true,logoUrl:typeof row.logoUrl==='string'?row.logoUrl:'',
        createdAt:typeof row.createdAt==='string'?row.createdAt:''};
    });
    return {clubs};
  }
  if(mapping.shape==='clubDetail'){
    const row=item.club;
    if(!row||typeof row!=='object')throw Error('SERVERLESS_CLUB_CONTRACT_MISMATCH');
    const club=row as Record<string,unknown>;
    if(typeof club.id!=='string'||!club.id||typeof club.name!=='string'||
       typeof club.leagueId!=='string'||typeof club.country!=='string'||
       typeof club.shortName!=='string')
      throw Error('SERVERLESS_CLUB_CONTRACT_MISMATCH');
    return {club:{...club,
      isTaken:club.isTaken===true,isCurrentUserClub:club.isCurrentUserClub===true,
      active:true,logoUrl:typeof club.logoUrl==='string'?club.logoUrl:'',
      createdAt:typeof club.createdAt==='string'?club.createdAt:''}};
  }
  if(mapping.shape==='clubFixtures'||mapping.shape==='fixtureDetail'){
    const rows=mapping.shape==='fixtureDetail'?[item.fixture]:item.fixtures;
    if(!Array.isArray(rows))throw Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
    const fixtures=rows.map(normalizeNativeFixture);
    return mapping.shape==='fixtureDetail'?{fixture:fixtures[0]}:
      {fixtures,stale:Boolean(item.stale),degraded:Boolean(item.degraded)};
  }
  if(mapping.shape==='competitionFixtures'){
    if(!Array.isArray(item.fixtures)||!item.competition||typeof item.competition!=='object')
      throw new Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
    const fixtures=item.fixtures.map((row:unknown)=>{
      if(!row||typeof row!=='object')
        throw Error('SERVERLESS_FIXTURE_CONTRACT_MISMATCH');
      return normalizeNativeFixture({...row,
        seasonId:(row as Record<string,unknown>).seasonId??mapping.input.seasonId,
        competitionId:(row as Record<string,unknown>).competitionId??mapping.input.competitionId});
    });
    return {fixtures,stale:Boolean(item.stale),degraded:Boolean(item.degraded)};
  }
  if(mapping.shape==='competitions'){
    if(!Array.isArray(item.competitions))throw new Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
    const competitions=item.competitions.map((value:unknown)=>{
      if(!value||typeof value!=='object')throw new Error('SERVERLESS_COMPETITION_CONTRACT_MISMATCH');
      const row=value as Record<string,unknown>;
      if(typeof row.id!=='string'||!row.id||typeof row.seasonId!=='string'||
        typeof row.name!=='string'||typeof row.type!=='string')
        throw new Error('SERVERLESS_COMPETITION_CONTRACT_MISMATCH');
      const status=String(row.status||'').toLowerCase();
      if(!['upcoming','active','completed'].includes(status))
        throw new Error('SERVERLESS_COMPETITION_STATUS_MISMATCH');
      return {...row,status,
        formatConfig:row.formatConfig&&typeof row.formatConfig==='object'?row.formatConfig:{}};
    });
    return {competitions,stale:Boolean(item.stale),degraded:Boolean(item.degraded)};
  }
  const prop=mapping.shape==='fixtures'?'fixtures':'notifications';
  if(!Array.isArray(item[prop]))throw new Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
  if(mapping.shape==='fixtures')return {
    fixtures:(item.fixtures as unknown[]).map(normalizeNativeFixture),
    stale:Boolean(item.stale),degraded:Boolean(item.degraded)
  };
  // Do not synthesize season-one records when staging data has not been imported.
  return {[prop]:item[prop],stale: Boolean(item.stale),degraded:Boolean(item.degraded)};
}
export async function requestViaEflServerless<T>(endpoint:string,method='GET'):Promise<T> {
  const mapping=mapEflReadRequest(endpoint,method);
  const result=await callEflTransport<unknown>({
    operation:mapping.operation,
    input:mapping.input,
    preferred:'telegram-serverless',
    vercel:()=>Promise.reject(new Error('SERVERLESS_VERCEL_FALLBACK_FORBIDDEN')),
  });
  return normalizeEflReadResponse(mapping,result) as T;
}
