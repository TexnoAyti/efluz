// First-party Telegram Serverless read-only API bridge for EFLUZ.
// In Serverless mode never contact the legacy Vercel /api origin.
// Only explicitly mapped, response-validated GET operations are allowed.
// Legacy session tokens and Telegram initData must never be forwarded.
import {callEflTransport, type EflOperation} from './serverlessTransport';

type Mapping = {operation:EflOperation; input:Record<string,unknown>; shape:'health'|'competitions'|'fixtures'|'notifications'};
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
  if (path==='/api/competitions' && !url.searchParams.has('view'))
    return {operation:'competitions',input:{seasonId,limit:100},shape:'competitions'};
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
