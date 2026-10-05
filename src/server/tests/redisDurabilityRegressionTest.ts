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
    const catalogKey = model.ReadModelKeys.competitions(seasonId);
    await model.redisSetRaw(catalogKey, { data: [
      { id: 'catalog-la', seasonId, currentMatchday: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'catalog-pl', seasonId, currentMatchday: 1, updatedAt: '2026-01-01T00:00:00.000Z' },
    ] });
    await Promise.all([
      model.patchCompetitionMatchdayCatalog({ id: 'catalog-la', seasonId, currentMatchday: 3, updatedAt: '2026-02-01T00:00:00.000Z' } as any),
      model.patchCompetitionMatchdayCatalog({ id: 'catalog-pl', seasonId, currentMatchday: 4, updatedAt: '2026-02-01T00:00:00.000Z' } as any),
    ]);
    await model.patchCompetitionMatchdayCatalog({ id: 'catalog-la', seasonId, currentMatchday: 2, updatedAt: '2026-01-15T00:00:00.000Z' } as any);
    const catalog = (await model.redisGetFresh<any[]>(catalogKey))!.data;
    assert.equal(catalog.find(c => c.id === 'catalog-la').currentMatchday, 3);
    assert.equal(catalog.find(c => c.id === 'catalog-pl').currentMatchday, 4);
    assert.equal(await client.ttl(model.getLkgKey(catalogKey)), -1);
    console.log('PASS actual Redis Lua: parallel league controls retain both changes and reject stale round state.');
    const outbox = await import('../outbox/redisOutbox');
    const outboxId = 'atomic-outbox-real';
    const outboxMutation = { mutationId: outboxId, operation: 'MARK_READ', entityType: 'NOTIFICATION_READ', entityId: 'atomic-outbox-notification', userId: 'atomic-outbox-owner', seasonId,
      payload: { userId: 'atomic-outbox-owner', readAt: new Date().toISOString() }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), retryCount: 0, nextRetryAt: Date.now(), lastError: null, status: 'PENDING' as const, revision: undefined as string | undefined };
    // A malformed index must fail before publishing an unreachable record.
    await client.set(outbox.OUTBOX_KEYS.pending(), 'invalid-index-type');
    await assert.rejects(outbox.persistDurableMutation(outboxMutation), /OUTBOX_PENDING_TYPE_INVALID/);
    assert.equal(await client.get(outbox.OUTBOX_KEYS.mutation(outboxId)), null);
    assert.equal(await client.sismember(outbox.OUTBOX_KEYS.all(), outboxId), 0);
    await client.del(outbox.OUTBOX_KEYS.pending());
    await outbox.persistDurableMutation(outboxMutation);
    assert.equal((await outbox.getDurableMutation(outboxId))?.status, 'PENDING');
    assert.equal(await client.ttl(outbox.OUTBOX_KEYS.mutation(outboxId)), -1);
    assert.equal(await client.zcard(outbox.OUTBOX_KEYS.pending()), 1);
    assert.equal(await client.sismember(outbox.OUTBOX_KEYS.all(), outboxId), 1);
    const oldRevision = outboxMutation.revision;
    await outbox.markMutationSyncing(outboxId, oldRevision);
    await outbox.persistDurableMutation(outboxMutation);
    assert.notEqual(outboxMutation.revision, oldRevision);
    assert.equal(await outbox.markMutationSynced(outboxId, oldRevision), false);
    assert.equal((await outbox.getDurableMutation(outboxId))?.status, 'PENDING');
    assert.equal(await client.zcard(outbox.OUTBOX_KEYS.pending()), 1);
    await db.collection(COLLECTIONS.NOTIFICATIONS).doc(outboxMutation.entityId).set({ userId: outboxMutation.userId, isRead: false });
    model.clearProcessMemoryForTest();
    const recovery = await import('../sync/scheduleReconciliation');
    const [recoveredA, recoveredB] = await Promise.all([recovery.reconcileDurableMutations(), recovery.reconcileDurableMutations()]);
    assert.equal([recoveredA, recoveredB].filter(Boolean).length, 1);
    assert.equal((recoveredA || recoveredB)?.synced, 1);
    assert.equal((await outbox.getDurableMutation(outboxId))?.status, 'SYNCED');
    assert.equal(await client.zcard(outbox.OUTBOX_KEYS.pending()), 0);
    assert.equal((await db.collection(COLLECTIONS.NOTIFICATIONS).doc(outboxMutation.entityId).get()).data()?.isRead, true);
    console.log('PASS actual Redis: atomic outbox rejects corrupt index before publication, retains permanent receipt and recovers from cold memory with one scheduled worker.');

    await import('./matchdayControlRegressionTest');
    await import('./notificationReadPersistenceRegressionTest');
    await import('./notificationModerationRegressionTest');

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

    // More than one batch, with a future retry at the head of the same queue.
    const ids = Array.from({length: 61}, (_, i) => `bulk-${i}`);
    for (let i=0; i<ids.length; i++) await db.collection(COLLECTIONS.USERS).doc(ids[i]).set({username:ids[i],telegramId:String(2000+i)});
    await queue.syncRecipientDirectory(seasonId);
    const bulk = await queue.enqueueTelegramBroadcast({...params,requestId:'bulk-continuation-001',selectedUserIds:ids});
    await queue.enqueueTelegramBroadcast({...params,requestId:'bulk-continuation-001',selectedUserIds:ids});
    assert.equal(await client.llen(`${model.KEY_PREFIX}:telegram:queue`),61, 'Enqueue retry is idempotent');
    const delayed:any = await client.lpop(`${model.KEY_PREFIX}:telegram:queue`);
    delayed.availableAt = Date.now()+5000;
    await client.lpush(`${model.KEY_PREFIX}:telegram:queue`,JSON.stringify(delayed));
    const sentTo = new Map<string, number>();
    let retryAttemptAt=0;
    let rejectedOnce=false;
    globalThis.fetch=async (input:any,init?:any) => {
      if (String(input).startsWith('https://api.telegram.org/')) {
        const id=String(JSON.parse(init.body).chat_id);
        if (id === delayed.telegramId) assert.ok(Date.now() >= delayed.availableAt,'Deferred job sent before backoff');
        if (id === '2060' && !rejectedOnce) {
          rejectedOnce=true; retryAttemptAt=Date.now();
          return new Response(JSON.stringify({ok:false,error_code:429,description:'retry',parameters:{retry_after:2}}),{status:429});
        }
        if(id === '2060') assert.ok(Date.now()-retryAttemptAt>=2000,'429 retried before backoff');
        sentTo.set(id,(sentTo.get(id)||0)+1);
        return new Response(JSON.stringify({ok:true,result:{message_id:100+sends++}}),{status:200});
      }
      return originalFetch(input,init);
    };
    const originalCollection=db.collection;
    (db as any).collection=()=>{throw new Error('Queue drain must make ZERO Firestore reads or writes');};
    try {
      await queue.processNotificationQueue(25);
      assert.equal(sentTo.size,25,'Future head must not block 25 ready jobs');
      assert.equal(sentTo.has(delayed.telegramId),false);
      let continuations=0;
      await queue.drainNotificationQueue({deadline:Date.now(),continueDrain:async hop=>{
        assert.equal(hop,1); continuations++;
        // Model the next Vercel invocation and its waitUntil lifecycle.
        const pending:Promise<unknown>[]=[];
        const symbol=Symbol.for('@vercel/request-context');
        const previous=(globalThis as any)[symbol];
        (globalThis as any)[symbol]={get:()=>({waitUntil:(p:Promise<unknown>)=>pending.push(p)})};
        process.env.VERCEL='1';
        try { queue.scheduleNotificationQueueDrain(hop); assert.equal(pending.length,1); await Promise.all(pending); }
        finally { delete process.env.VERCEL; (globalThis as any)[symbol]=previous; }
      }});
      assert.equal(continuations,1,'Expired invocation budget hands off');
      assert.equal(sentTo.size,61,'All recipients drained beyond the first batch');
      assert.ok([...sentTo.values()].every(n=>n===1),'No duplicate successful delivery');
      assert.equal(await client.llen(`${model.KEY_PREFIX}:telegram:queue`),0);
      assert.equal((await queue.getBroadcastDetails(bulk.id))?.metrics.sentCount,61);
      await queue.drainNotificationQueue();
      assert.equal(sentTo.size,61);
      // Verify authenticated HTTP handoff stays on the configured Vercel host.
      const savedFetch=globalThis.fetch;
      process.env.VERCEL='1'; process.env.VERCEL_URL='efluz-preview.vercel.app'; process.env.CRON_SECRET='isolated-secret';
      let handoffs=0;
      globalThis.fetch=async (input:any,init?:any) => {
        assert.equal(String(input),'https://efluz-preview.vercel.app/api/internal/telegram-worker?hop=2');
        assert.equal(init.method,'POST'); assert.equal(init.headers.authorization,'Bearer isolated-secret');
        assert.equal(init.redirect,'error'); handoffs++;
        return new Response('{}',{status:202});
      };
      try { await queue.triggerNotificationContinuation(2); assert.equal(handoffs,1); }
      finally { globalThis.fetch=savedFetch; delete process.env.VERCEL; delete process.env.VERCEL_URL; delete process.env.CRON_SECRET; }
      console.log('PASS >25 recipients, waitUntil continuation, deferred head bypass, 429 backoff, idempotency and zero Firestore access');
    } finally { (db as any).collection=originalCollection; }
    globalThis.fetch=originalFetch;
    console.log('PASS: broadcast retries deduplicate, concurrent workers send once, interrupted jobs remain visible without blind resend');
    const backup = await import('../services/notificationBackupQueue');
    const envelope = { broadcastId: 'smart-real-backup', dedupeKey: 'dedupe-real-backup', record: '{}', job: '{}' };
    await backup.persistBackupNotification(envelope, client);
    await backup.persistBackupNotification(envelope, client);
    assert.equal(await client.zcard(`${model.KEY_PREFIX}:telegram:backup:pending`), 1);
    assert.equal(await client.ttl(`${model.KEY_PREFIX}:telegram:backup:records`), -1);
    assert.equal(await backup.recoverBackupNotifications(25, client, client), 1);
    assert.equal(await client.llen(`${model.KEY_PREFIX}:telegram:queue`), 1);
    // The saved broadcast deduplicates replay even after the transient key expires.
    await client.del(envelope.dedupeKey);
    await backup.persistBackupNotification(envelope, client);
    assert.equal(await backup.recoverBackupNotifications(25, client, client), 1);
    assert.equal(await client.llen(`${model.KEY_PREFIX}:telegram:queue`), 1);
    assert.equal(await client.zcard(`${model.KEY_PREFIX}:telegram:backup:pending`), 0);
    const incomplete = { ...envelope, broadcastId: 'smart-incomplete-backup', dedupeKey: 'dedupe-incomplete-backup' };
    await client.set(incomplete.dedupeKey, '1');
    await backup.persistBackupNotification(incomplete, client);
    await assert.rejects(backup.recoverBackupNotifications(25, client, client), /UNCONFIRMED/);
    assert.equal(await client.zcard(`${model.KEY_PREFIX}:telegram:backup:pending`), 1);
    console.log('PASS actual Redis Lua: durable backup, duplicate and late replay, incomplete primary write retains backup.');
    await import('./approvedFixtureRestorationRegressionTest');
    console.log('PASS actual Redis Lua: one-time approved fixture restore appends to durable snapshots and survives retry.');
    await import('./tournamentImageDownloadRegressionTest');

    // Real Redis Lua test for Telegram AI Rate Limiting & Delivery Claim Transitions
    const aiRateService = await import('../services/telegramAiRateLimitService');
    const aiService = await import('../services/telegramAiService');

    // 1. Parallel rate limiting via atomic Redis Lua script on real Redis
    const realUser = 999888;
    const realParallelResults = await Promise.all(
      Array.from({ length: 10 }, () =>
        aiRateService.checkAndIncrementAiRateLimits({
          chatId: -100999888,
          threadId: 3503,
          userId: realUser,
          userLimitPerMin: 3,
          topicLimitPerMin: 15,
          maxDailyRequests: 500,
        })
      )
    );
    const realAllowed = realParallelResults.filter((r) => r.allowed).length;
    const realBlocked = realParallelResults.filter((r) => !r.allowed).length;
    assert.equal(realAllowed, 3, 'Real Redis Lua must permit exactly 3 requests');
    assert.equal(realBlocked, 7, 'Real Redis Lua must atomically block remaining 7 requests');

    // 2. Real Redis atomic delivery claim ('sending' state transition)
    const realUpdateId = 777999;
    const realClaims = await Promise.all([
      aiService.claimDeliveryState(realUpdateId, 'sending'),
      aiService.claimDeliveryState(realUpdateId, 'sending'),
      aiService.claimDeliveryState(realUpdateId, 'sending'),
    ]);
    const realClaimOk = realClaims.filter((c) => c === 'ok').length;
    const realClaimHandled = realClaims.filter((c) => c === 'already_handled').length;
    assert.equal(realClaimOk, 1, 'Real Redis Lua must allow exactly one claim to sending state');
    assert.equal(realClaimHandled, 2, 'Concurrent delivery claims must return already_handled');

    // 3. Bot message indexing in real Redis (isolated dummy bot identity)
    process.env.TELEGRAM_BOT_TOKEN = '123456:isolated_redis_test_token';
    await aiService.indexBotSentMessage(888777, -100999888, 3503, 12345);
    const isReplyMatch = await aiService.isReplyToOurBotForUser(
      { message_id: 888777, from: { id: aiService.getConfiguredBotUserId() || 123456, is_bot: true } },
      -100999888,
      3503,
      12345
    );
    assert.equal(isReplyMatch, true, 'Real Redis bot message index must match target chat/thread/user');

    const isWrongUserMatch = await aiService.isReplyToOurBotForUser(
      { message_id: 888777, from: { id: aiService.getConfiguredBotUserId() || 123456, is_bot: true } },
      -100999888,
      3503,
      99999
    );
    assert.equal(isWrongUserMatch, false, 'Different user must NOT match bot message index');
    // Fail closed on transport errors and cancel an in-flight Redis request.
    const healthyFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error('isolated Redis transport outage'); };
      assert.equal(await aiService.claimDeliveryState(777998, 'sending'), 'redis_error');
      const blockedRate = await aiRateService.checkAndIncrementAiRateLimits({
        chatId: -100999888, threadId: 3503, userId: 12345,
        userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500,
      });
      assert.equal(blockedRate.allowed, false);
      let transportAborted = false;
      globalThis.fetch = async (_input: any, init?: any) => new Promise<Response>((_resolve, reject) => {
        const onAbort = () => { transportAborted = true; reject(new Error('isolated Redis request aborted')); };
        if (init?.signal?.aborted) onAbort();
        else init?.signal?.addEventListener('abort', onAbort, { once: true });
      });
      const controller = new AbortController();
      const pendingClaim = aiService.claimDeliveryState(777997, 'sending', { signal: controller.signal });
      await new Promise(resolve => setTimeout(resolve, 20));
      controller.abort();
      assert.equal(await pendingClaim, 'redis_error');
      assert.equal(transportAborted, true, 'Abort must reach the actual Redis fetch transport');
    } finally { globalThis.fetch = healthyFetch; }

    const today = new Date().toISOString().slice(0, 10);
    const dailyKey = 'efluz:v1:telegram:ai:daily:' + today;
    const beforeBudget = Number(await client.get(dailyKey));
    const budgetParams = { chatId: -100555777, threadId: 3503, userId: 555, userLimitPerMin: 20, topicLimitPerMin: 1, maxDailyRequests: beforeBudget };
    const dailyNotice = await aiRateService.checkAndIncrementAiRateLimits(budgetParams);
    assert.equal(dailyNotice.reason, 'DAILY_LIMIT_EXCEEDED'); assert.equal(dailyNotice.shouldNotifyUser, true);
    assert.equal((await aiRateService.checkAndIncrementAiRateLimits(budgetParams)).shouldNotifyUser, false);
    assert.equal((await aiRateService.checkAndIncrementAiRateLimits({ ...budgetParams, countDaily: false })).allowed, true);
    assert.equal(Number(await client.get(dailyKey)), beforeBudget, 'Deterministic commands do not consume Gemini budget');
    assert.equal((await aiRateService.checkAndIncrementAiRateLimits({ ...budgetParams, countDaily: false, userId: 556 })).reason, 'TOPIC_LIMIT_EXCEEDED');
    assert.equal((await aiRateService.checkAndIncrementAiRateLimits({ ...budgetParams, countDaily: false, control: true })).allowed, true, 'Owner controls have bounded separate bucket');
    console.log('PASS actual Redis Lua: cached reads remain available after model daily budget, daily/topic warning cooldown, isolated owner control bucket');
    console.log('PASS actual Redis Lua: AI assistant atomic rate limiting, delivery claim transitions, and reply indexing.');

    const adminAI = await import('../services/telegramAiAdminService');
    const aiConfig = await import('../services/telegramAiConfigService');
    aiConfig.setTestConfigOverride({ ...aiConfig.DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -100123, allowedThreadId: 3503 });
    const adminPayload = (text: string) => ({ updateId: 99222, messageId: 1, chatId: -100123, threadId: 3503, fromUser: { id: 5209126900 }, text });
    let adminExecutions = 0;
    adminAI.setTestAiAdminHooks(async () => { adminExecutions++; await new Promise(resolve => setTimeout(resolve, 20)); return { status: 200, data: { success: true } }; });
    const adminSignal = new AbortController().signal;
    const adminProposal = await adminAI.handleAiAdminCommand(adminPayload('/ai_admin {"action":"club_release","targetId":"club-arsenal"}'), adminSignal);
    const adminToken = /\/ai_confirm ([a-f0-9]{24})/.exec(adminProposal)![1];
    await Promise.all(Array.from({ length: 8 }, () => adminAI.handleAiAdminCommand(adminPayload('/ai_confirm ' + adminToken), adminSignal)));
    assert.equal(adminExecutions, 1, 'Actual Redis Lua must claim exactly one admin mutation');
    const adminKey = 'efluz:v1:telegram:ai:admin:' + adminToken;
    assert.equal((await client.get<any>(adminKey)).state, 'done');
    assert.equal(await client.ttl(adminKey), -1, 'Execution record is permanent; delivery retries cannot erase mutation deduplication');
    const expiredProposal = await adminAI.handleAiAdminCommand(adminPayload('/ai_admin {"action":"club_release","targetId":"club-arsenal"}'), adminSignal);
    const expiredToken = /\/ai_confirm ([a-f0-9]{24})/.exec(expiredProposal)![1];
    const expiredKey = 'efluz:v1:telegram:ai:admin:' + expiredToken;
    const expiredRecord = await client.get<any>(expiredKey);
    await client.set(expiredKey, JSON.stringify({ ...expiredRecord, expiresAt: Date.now() - 1 }));
    assert.match(await adminAI.handleAiAdminCommand(adminPayload('/ai_confirm ' + expiredToken), adminSignal), /muddati/);
    assert.equal(adminExecutions, 1);
    const adminFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error('Redis unavailable'); };
      await adminAI.handleAiAdminCommand(adminPayload('/ai_confirm ' + adminToken), adminSignal);
      const unavailablePlan = await adminAI.handleAiAdminCommand(adminPayload('/ai_admin {"action":"club_release","targetId":"club-arsenal"}'), adminSignal);
      assert.ok(!unavailablePlan.includes('/ai_confirm ')); assert.equal(adminExecutions, 1);
    } finally { globalThis.fetch = adminFetch; adminAI.setTestAiAdminHooks(); aiConfig.setTestConfigOverride(null); }
    console.log('PASS actual Redis Lua: owner admin confirmation concurrency, permanent claim, expiry, Redis outage fail-closed; no real mutations or Telegram messages');

    await import('./durableClubClaimRegressionTest');
    console.log('Redis durability regression passed; Telegram transport was mocked, no real messages sent.');
  } finally { globalThis.fetch = isolatedFetch; bridge.close(); }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
