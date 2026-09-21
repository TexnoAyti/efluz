import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

async function main() {
  assert.equal(process.env.NODE_ENV, 'test');
  const command = (args: any[]) => new Promise<any>((resolve,reject) => {
    const socket=net.createConnection({host:'127.0.0.1',port:Number(process.env.REDIS_TEST_PORT)});
    const chunks=[Buffer.from(`*${args.length}\r\n`)];
    for(const arg of args) { const data=Buffer.from(String(arg)); chunks.push(Buffer.from(`$${data.length}\r\n`),data,Buffer.from('\r\n')); }
    socket.on('connect',()=>socket.write(Buffer.concat(chunks)));
    socket.on('error',reject);
    let buffer=Buffer.alloc(0);
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      let position=0;
      const incomplete=Symbol();
      const parse=():any=>{
        const end=buffer.indexOf('\r\n',position);
        if(end<0) throw incomplete;
        const kind=String.fromCharCode(buffer[position]);
        const value=buffer.subarray(position+1,end).toString(); position=end+2;
        if(kind===':') return Number(value);
        if(kind==='+') return value;
        if(kind==='-') return {error:value};
        const count=Number(value);
        if(count===-1) return null;
        if(kind==='$') { if(buffer.length<position+count+2) throw incomplete; const text=buffer.subarray(position,position+count).toString(); position+=count+2; return text; }
        if(kind==='*') return Array.from({length:count},()=>parse());
        throw new Error('Invalid RESP');
      };
      try { const result=parse(); socket.destroy(); resolve(result); }
      catch(error) { if(error!==incomplete) {socket.destroy();reject(error);} }
    });
  });
  const bridge = http.createServer(async (req,res) => {
    let body=''; for await (const chunk of req) body += chunk;
    try {
      const encode = (v:any):any => req.headers['upstash-encoding'] === 'base64' ? typeof v === 'string' ? Buffer.from(v).toString('base64') : Array.isArray(v) ? v.map(encode) : v : v;
      const run = async (args:any[]) => { const result=await command(args); return result?.error ? {error:result.error} : {result:encode(result)}; };
      const input=JSON.parse(body);
      const result:any = Array.isArray(input[0]) ? [] : await run(input);
      if(Array.isArray(input[0])) for(const args of input) result.push(await run(args));
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(result));
    } catch(error:any) { res.statusCode=500; res.end(JSON.stringify({error:error.message})); }
  });
  await new Promise<void>(resolve=>bridge.listen(0,'127.0.0.1',resolve));
  const address=bridge.address() as any;
  // Exercise the production HTTPS-only configuration contract while routing
  // this test's transport exclusively through the isolated loopback bridge.
  const redisOrigin = 'https://redis.test.invalid';
  const isolatedFetch = globalThis.fetch;
  globalThis.fetch = (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin === redisOrigin) {
      return isolatedFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
    }
    return isolatedFetch(input, init);
  };
  process.env.UPSTASH_REDIS_REST_URL=redisOrigin;
  process.env.UPSTASH_REDIS_REST_TOKEN='isolated-local-only';
  const model=await import('../readModel/readModelStore');
  const client=model.getUpstashClient()!;
  assert.ok(client, 'Redis test must use the real Redis bridge, never in-memory fallback');
  const firebase=await import('../firebase/admin');
  const {COLLECTIONS}=await import('../firebase/collections');
  const queue=await import('../services/telegramNotificationQueue');
  const db=firebase.getFirestoreDb();
  const seasonId='season-2026-27';
  try {
    await model.redisSetRaw('atomic-test',{data:[{id:'kept'}]});
    await assert.rejects(model.redisSetRaw('atomic-test',{data:[]}),/SNAPSHOT_REJECTED/);
    assert.equal(await client.ttl(model.getLkgKey('atomic-test')),-1);
    assert.equal((await model.redisGetFresh<any[]>('atomic-test'))?.data[0].id,'kept');
    await model.invalidateDataset('atomic-test');
    assert.equal(await model.redisGetFresh('atomic-test'),null);
    assert.equal((await model.redisGetLkg<any[]>('atomic-test'))?.data[0].id,'kept');
    console.log('PASS: actual Redis Lua publishes atomically and preserves permanent snapshot');

    const fixture={id:'fixture-real',seasonId,competitionId:'comp-fa-cup-2026',status:'SCHEDULED',homeClubId:null,awayClubId:null,matchday:1,updatedAt:'2026-01-01T00:00:00.000Z'};
    await db.collection(COLLECTIONS.FIXTURES).doc(fixture.id).set(fixture);
    await model.buildAdminFixturesSnapshot(seasonId);
    await db.collection(COLLECTIONS.FIXTURES).doc(fixture.id).update({homeScore:2,awayScore:1,status:'CONFIRMED',updatedAt:'2026-02-01T00:00:00.000Z'});
    await model.refreshChangedFixtureReadModel(fixture.id);
    const patched=await model.redisGetFresh<any[]>(model.ReadModelKeys.adminFixtures(seasonId));
    assert.equal(patched?.data[0].homeScore,2);
    assert.equal(patched?.data[0].status,'CONFIRMED');
    console.log('PASS: single-fixture Redis patch updates results without rebuilding the season');

    await db.collection(COLLECTIONS.USERS).doc('recipient-one').set({username:'one',telegramId:'1001'});
    await db.collection(COLLECTIONS.USERS).doc('recipient-two').set({username:'two',telegramId:'1002'});
    await queue.syncRecipientDirectory(seasonId);
    let sends=0;
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async (input:any,init?:any) => {
      if (String(input).startsWith('https://api.telegram.org/')) { sends++; return new Response(JSON.stringify({ok:true,result:{message_id:sends}}),{status:200}); }
      return originalFetch(input,init);
    };
    process.env.TELEGRAM_BOT_TOKEN='dummy-test-token';
    const params={adminUserId:'real-admin',adminUsername:'admin',title:'Tur',body:'Test local delivery',type:'NEW_MATCHDAY' as const,targetAudience:'SELECTED_RECIPIENTS' as const,selectedUserIds:['recipient-one','recipient-one'],seasonId,requestId:'stable-request-001'};
    const first=await queue.enqueueTelegramBroadcast(params);
    const retry=await queue.enqueueTelegramBroadcast(params);
    assert.equal(first.id,retry.id);
    assert.equal(first.metrics.totalRecipients,1);
    assert.equal(await client.llen(`${model.KEY_PREFIX}:telegram:queue`),1);
    await Promise.all([queue.processNotificationQueue(),queue.processNotificationQueue()]);
    assert.equal(sends,1);
    assert.equal((await queue.getBroadcastDetails(first.id))?.metrics.sentCount,1);
    assert.equal(await client.hlen(`${model.KEY_PREFIX}:telegram:processing`),0);
    const second=await queue.enqueueTelegramBroadcast({...params,requestId:'stable-request-002',selectedUserIds:['recipient-two']});
    const interrupted:any=await client.lpop(`${model.KEY_PREFIX}:telegram:queue`);
    await client.hset(`${model.KEY_PREFIX}:telegram:processing`,{[interrupted.jobId]:{...interrupted,claimedAt:Date.now()-130000}});
    await queue.processNotificationQueue();
    const details=await queue.getBroadcastDetails(second.id);
    assert.equal(details?.metrics.failedCount,1);
    assert.match(details?.recipients[0].error || '',/DELIVERY_UNKNOWN/);
    assert.equal(sends,1);
    globalThis.fetch=originalFetch;
    console.log('PASS: broadcast retries deduplicate, concurrent workers send once, interrupted jobs remain visible without blind resend');
    console.log('Redis durability regression passed; Telegram transport was mocked, no real messages sent.');
  } finally { globalThis.fetch = isolatedFetch; bridge.close(); }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
