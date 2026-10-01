import assert from 'node:assert/strict';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
process.env.TELEGRAM_BOT_TOKEN = '123456:isolated-fake-token';
const { getUpstashClient, KEY_PREFIX, ReadModelKeys, getFreshKey } = await import('../readModel/readModelStore');
const { enqueueSmartTelegramNotification, notifySmartCupAdvancement, notifySmartCupChampion, notifySmartEuropeanZones } = await import('../services/smartNotificationService');
const { processNotificationQueue } = await import('../services/telegramNotificationQueue');
assert.ok(getUpstashClient());
const client: any = {};
const values = new Map<string, any>();
const hashes = new Map<string, Record<string, any>>();
const jobs: any[] = [];
let rejectQueue = false;
const copy = (v: any) => v == null ? v : JSON.parse(JSON.stringify(v));
client.get = async (key: string) => copy(values.get(key) ?? null);
client.set = async (key: string, value: any, opts?: any) => {
  if (opts?.nx && values.has(key)) return null;
  values.set(key, copy(value)); return 'OK';
};
client.hget = async (key: string, field: string) => copy(hashes.get(key)?.[field] ?? null);
client.hgetall = async (key: string) => copy(hashes.get(key) || {});
client.hset = async (key: string, fields: any) => { hashes.set(key, {...hashes.get(key), ...copy(fields)}); return 1; };
client.hdel = async (key: string, field: string) => { delete hashes.get(key)?.[field]; return 1; };
client.rpush = async (_key: string, job: string) => { jobs.push(JSON.parse(job)); return jobs.length; };
client.eval = async (script: string, keys: string[], args: any[]) => {
  if (script.includes('local accepted')) {
    if (rejectQueue) throw Error('QUEUE_UNAVAILABLE');
    if (values.has(keys[0])) return 0;
    values.set(keys[0], '1');
    await client.hset(keys[1], {[args[1]]: JSON.parse(args[2])});
    jobs.push(JSON.parse(args[3])); return 1;
  }
  if (script.includes('local count')) {
    if (values.get(keys[2]) !== args[0]) return null;
    const i = jobs.findIndex(j => (j.availableAt || 0) <= Number(args[1]));
    if (i < 0) return null;
    const job = jobs.splice(i, 1)[0]; job.claimedAt = args[1];
    await client.hset(keys[1], {[job.jobId]: job}); return copy(job);
  }
  if (values.get(keys[0]) === args[0]) values.delete(keys[0]);
  return 1;
};
let sends = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init: any) => {
  const url = typeof input === 'string' ? input : input.url;
  if (new URL(url).hostname === 'redis.test.invalid') {
    const decode = (v: any) => { try { return JSON.parse(v); } catch { return v; } };
    const execute = async (c: any[]) => {
      const [name, key, ...args] = c;
      switch (String(name).toLowerCase()) {
        case 'get': return client.get(key);
        case 'set': return client.set(key, decode(args[0]), {nx: args.includes('nx')});
        case 'hget': return client.hget(key, args[0]);
        case 'hgetall': return Object.entries(await client.hgetall(key)).flatMap(([k,v]) => [k, JSON.stringify(v)]);
        case 'hset': {
          const fields: any = {};
          for(let i=0;i<args.length;i+=2) fields[args[i]]=decode(args[i+1]);
          return client.hset(key, fields);
        }
        case 'hdel': return client.hdel(key, args[0]);
        case 'rpush': return client.rpush(key, args[0]);
        case 'eval': {
          const n = Number(args[0]);
          return client.eval(key, args.slice(1, 1+n), args.slice(1+n));
        }
        default: throw Error('Unsupported isolated Redis command: '+name);
      }
    };
    const body=JSON.parse(init.body);
    const batch = Array.isArray(body[0]);
    const results=[];
    for(const command of batch ? body : [body]) {
      try { const result=await execute(command); results.push({result: String(command[0]).toLowerCase() === 'hgetall' ? result : typeof result === 'object' && result !== null ? JSON.stringify(result) : result}); }
      catch(e:any) { results.push({error:e.message}); }
    }
    const encode = (v:any):any => typeof v === 'string' && v !== 'OK' ? Buffer.from(v).toString('base64') : Array.isArray(v) ? v.map(encode) : v;
    const encoded=results.map(r => 'result' in r ? {...r,result:encode(r.result)} : r);
    return new Response(JSON.stringify(batch ? encoded : encoded[0]));
  }
  assert.equal(new URL(url).hostname, 'api.telegram.org');
  assert.equal(JSON.parse(init.body).chat_id, 10001);
  sends++;
  return new Response(JSON.stringify({ok: true, result: {message_id: sends}}));
};
try {
  const params = { userId: 'owner-a', seasonId: 'season-a', eventId: 'matchday-open:a', title: 'Test', body: 'Isolated test' };
  assert.equal(await enqueueSmartTelegramNotification(params), true);
  assert.equal(jobs[0].requiresRecipientLookup, true);
  assert.equal(await enqueueSmartTelegramNotification(params), false);
  await processNotificationQueue();
  assert.equal(sends, 0); assert.equal(jobs.length, 1);
  assert.ok(jobs[0].availableAt > Date.now());
  values.set(`${KEY_PREFIX}:private:recipient-directory:season-a`, [{userId:'owner-a', telegramId:10001, messageable:true}]);
  jobs[0].availableAt = 0;
  const result = await processNotificationQueue();
  assert.equal(result.succeeded, 1); assert.equal(sends, 1); assert.equal(jobs.length, 0);
  const records = Object.values(hashes.get(`${KEY_PREFIX}:telegram:broadcasts`) || {}) as any[];
  assert.equal(records[0].recipients[0].status, 'SENT');
  assert.equal(records[0].metrics.sentCount, 1);
  values.set(`${KEY_PREFIX}:private:recipient-directory:season-b`, [{userId:'owner-a', telegramId:10001, messageable:false}]);
  assert.equal(await enqueueSmartTelegramNotification({...params, seasonId:'season-b', eventId:'blocked'}), false);
  // A user suspended after enqueue is skipped when the pending job is resolved.
  assert.equal(await enqueueSmartTelegramNotification({...params, seasonId:'season-c', eventId:'suspended-later'}), true);
  values.set(`${KEY_PREFIX}:private:recipient-directory:season-c`, [{userId:'owner-a', telegramId:10001, messageable:false}]);
  await processNotificationQueue();
  assert.equal(sends, 1);
  assert.equal((Object.values(hashes.get(`${KEY_PREFIX}:telegram:broadcasts`) || {}) as any[])[1].metrics.skippedCount, 1);
  const fixtureKey = ReadModelKeys.competitionFixtures('cup-test', 'season-d');
  values.set(getFreshKey(fixtureKey), {data:[{id:'source',seasonId:'season-d',competitionId:'cup-test',homeClubId:'club-a',awayClubId:'club-b',homeOwnerId:'owner-a',status:'CONFIRMED',homeScore:1,awayScore:0},{id:'target',seasonId:'season-d',competitionId:'cup-test',homeClubId:'club-a'}]});
  assert.equal(await notifySmartCupAdvancement({competitionId:'cup-test',seasonId:'season-d',sourceFixtureId:'source',targetFixtureId:'target',winnerClubId:'club-a'}), true);
  assert.equal(await notifySmartCupChampion({competitionId:'cup-test',seasonId:'season-d',sourceFixtureId:'source',winnerClubId:'club-a'}), true);
  assert.equal(await notifySmartEuropeanZones({competitionId:'cup-test',seasonId:'season-d',rows:[{clubId:'club-a',clubName:'Club A',position:1,zone:'DIRECT_R16',zoneLabel:'R16'}]}),1);
  assert.equal(jobs.length,3);
  assert.ok(jobs.every(job=>job.userId==='owner-a' && job.requiresRecipientLookup));
  assert.equal(await notifySmartCupChampion({competitionId:'cup-test',seasonId:'season-d',sourceFixtureId:'source',winnerClubId:'unrelated-club'}), false);
  console.log('PASS cup advancement/champion and European events recover recipients from fixture snapshots without extra Firestore reads.');
  rejectQueue = true;
  assert.equal(await enqueueSmartTelegramNotification({...params, eventId:'redis-outage'}), false);
  console.log('PASS cold directory events retained, deduplicated, delivered after recovery; suspended users skipped. Redis total outage remains unavailable. No Firestore/network calls.');
} finally { globalThis.fetch = originalFetch; }
