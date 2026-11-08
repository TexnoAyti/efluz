// First-party Telegram Serverless read-only API bridge for EFLUZ.
// In Serverless mode never contact the legacy Vercel /api origin.
// Only explicitly mapped, response-validated GET operations are allowed.
// Legacy session tokens and Telegram initData must never be forwarded.
import {callEflTransport, type EflOperation} from './serverlessTransport';

type Mapping = {operation:EflOperation; input:Record<string,unknown>; shape:'health'|'seasons'|'leagues'|'competitions'|'fixtures'|'notifications'|'competitionFixtures'};
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
      if(typeof row.id!=='string'||!/^season-20\\d{2}-\\d{2}$/.test(row.id)||
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
  if(mapping.shape==='competitionFixtures'){
    if(!Array.isArray(item.fixtures)||!item.competition||typeof item.competition!=='object')
      throw new Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
    const fixtures=item.fixtures.map((fixture:unknown)=>{
      if(!fixture||typeof fixture!=='object')throw new Error('SERVERLESS_FIXTURE_CONTRACT_MISMATCH');
      const row=fixture as Record<string,unknown>;
      if(typeof row.id!=='string'||!row.id||typeof row.status!=='string')
        throw new Error('SERVERLESS_FIXTURE_CONTRACT_MISMATCH');
      const round=Number(row.round);
      if(!Number.isSafeInteger(round)||round<0)
        throw new Error('SERVERLESS_FIXTURE_ROUND_INVALID');
      return {...row,matchday:round};
    });
    return {fixtures,stale:Boolean(item.stale),degraded:Boolean(item.degraded)};
  }
  const prop=mapping.shape==='competitions'?'competitions':mapping.shape==='fixtures'?'fixtures':'notifications';
  if(!Array.isArray(item[prop]))throw new Error('SERVERLESS_RESPONSE_CONTRACT_MISMATCH');
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
