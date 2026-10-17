import { getAiRedisClient } from './telegramAiDeadline';
export function aiOperationsKey(kind: string, date = new Date().toISOString().slice(0,10)) {
  const env = process.env.SUPABASE_DATA_NAMESPACE || process.env.NODE_ENV || 'production';
  const bot = process.env.TELEGRAM_BOT_TOKEN?.split(':')[0] || 'unconfigured';
  return `efluz:v1:telegram:ai:operations:${env}:${bot}:${kind}:${date}`;
}
export const AI_METRIC_LUA = `
-- EFL_AI_METRIC_V1
if not redis.call('SET', KEYS[2], '1', 'NX', 'EX', 172800) then return 0 end
local raw = redis.call('GET', KEYS[1])
local m = raw and cjson.decode(raw) or {requests=0,replies=0,failures=0,elapsedMs=0,providerFailures=0}
if ARGV[1] == 'provider' then
 m.providerFailures=m.providerFailures+1
 m.lastError={kind=ARGV[4],at=ARGV[5]}
else
 m.requests=m.requests+1
 m.elapsedMs=m.elapsedMs+tonumber(ARGV[2])
 if ARGV[1] == 'reply' then m.replies=m.replies+1 end
 if ARGV[1] == 'failed' then m.failures=m.failures+1;m.lastError={kind='delivery_or_state',at=ARGV[5]} end
end
m.updatedAt=ARGV[5]
redis.call('SET',KEYS[1],cjson.encode(m),'EX',691200)
return 1
`;
export async function recordAiObservation(updateId: number, kind: 'reply'|'ignored'|'failed'|'provider', elapsedMs = 0, failure: 'quota'|'busy'|'connection' = 'connection') {
  try {
    const client = getAiRedisClient(AbortSignal.timeout(500)); if (!client) return;
    const key = aiOperationsKey('metrics');
    await client.eval(AI_METRIC_LUA, [key, `${key}:${kind === 'provider' ? 'provider' : 'request'}:${updateId}`], [kind, Math.max(0,Math.round(elapsedMs)), '', failure, new Date().toISOString()]);
  } catch { /* Diagnostics must never prevent an answer or trigger a replay. */ }
}
export async function getAiObservability() {
  const client = getAiRedisClient(AbortSignal.timeout(1500));
  if (!client) return { available: false, data: null };
  try {
    const raw: any = await client.get(aiOperationsKey('metrics'));
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { available: true, data: data ? {...data, averageResponseMs: data.requests ? Math.round(data.elapsedMs/data.requests) : 0} : null };
  } catch { return { available: false, data: null }; }
}
