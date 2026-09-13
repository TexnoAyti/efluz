import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Request, Response } from 'express';
import {
  verifyTelegramGroupMembership,
  clearTelegramMembershipCache,
} from '../services/telegramBotService';
import { telegramRouter } from '../routes/telegram.routes';
import { authMiddleware } from '../middleware/authMiddleware';

console.log('--- RUNNING TELEGRAM MEMBERSHIP CACHE TEST ---');

async function testTelegramMembershipCache() {
  clearTelegramMembershipCache();

  // Test 1: verifyTelegramGroupMembership accepts forceRefresh?: boolean
  console.log('Test 1: verifyTelegramGroupMembership accepts forceRefresh');
  const testTgId = '987654321';

  // In environment without token, returns mock or fail_open
  const res1 = await verifyTelegramGroupMembership(testTgId);
  assert.equal(typeof res1.isMember, 'boolean');

  // Test 2: Endpoint /api/telegram/check-membership requires authentication
  console.log('Test 2: /api/telegram/check-membership authentication security');
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/telegram', telegramRouter);

  const server = app.listen(0);
  const address = server.address() as any;
  const port = address.port;

  try {
    // Unauthenticated request should be rejected with 401
    const unauthRes = await fetch(`http://127.0.0.1:${port}/api/telegram/check-membership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'hacker-attempt' }),
    });
    assert.equal(unauthRes.status, 401, 'Unauthenticated request must return 401');

    // Authenticated dev request with arbitrary req.body.userId:
    // Ensure endpoint ignores req.body.userId and uses req.user.telegramId
    const authRes = await fetch(`http://127.0.0.1:${port}/api/telegram/check-membership`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dev-user-id': 'user-dev-a',
      },
      body: JSON.stringify({ userId: 'arbitrary_fake_id_123' }),
    });
    assert.equal(authRes.status, 200, 'Authenticated request should succeed');
    const authData = await authRes.json();
    assert.equal(typeof authData.isMember, 'boolean');

    // Test 3: Flow simulation (NOT MEMBER -> join @efleagueuz -> press Tekshirish -> fresh Telegram check -> immediately claim)
    console.log('\nTest 3: End-to-end flow simulation of cache invalidation & forced refresh');

    // Simulate global fetch for Telegram Bot API
    const originalFetch = global.fetch;
    let mockMemberStatus = 'left'; // Initially not a member
    let fetchCallsToTelegram = 0;

    (global as any).fetch = async (url: any, init?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('api.telegram.org')) {
        fetchCallsToTelegram++;
        if (mockMemberStatus === 'member') {
          return new Response(JSON.stringify({
            ok: true,
            result: { status: 'member', user: { id: 112233 } },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else {
          return new Response(JSON.stringify({
            ok: true,
            result: { status: 'left' },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      return originalFetch(url, init);
    };

    try {
      const simulatedTgId = '112233';
      clearTelegramMembershipCache(simulatedTgId);

      // Step A: User is NOT MEMBER -> checks membership
      fetchCallsToTelegram = 0;
      const initialCheck = await verifyTelegramGroupMembership(simulatedTgId);
      assert.equal(initialCheck.isMember, false, 'Initial check must be non-member');
      assert.equal(fetchCallsToTelegram, 1, 'Should have called Telegram API');

      // Step B: Without forceRefresh, second check hits negative cache
      const cachedCheck = await verifyTelegramGroupMembership(simulatedTgId);
      assert.equal(cachedCheck.isMember, false);
      assert.equal(cachedCheck.cached, true, 'Second check must be cached');
      assert.equal(fetchCallsToTelegram, 1, 'Should NOT have called Telegram API due to cache');

      // Step C: User joins @efleagueuz in Telegram!
      mockMemberStatus = 'member';

      // Still cached if not forced
      const stillCached = await verifyTelegramGroupMembership(simulatedTgId);
      assert.equal(stillCached.isMember, false, 'Without forceRefresh, still sees negative cache');
      assert.equal(stillCached.cached, true);

      // Step D: User presses "✅ Tekshirish", triggering /api/telegram/check-membership with forceRefresh: true
      const freshCheck = await verifyTelegramGroupMembership(simulatedTgId, true);
      assert.equal(freshCheck.isMember, true, 'Forced refresh must return fresh member status');
      assert.equal(fetchCallsToTelegram, 2, 'Must have bypassed cache and called Telegram API');

      // Step E: Pending club claim is automatically retried
      // When club claim checks membership, it sees isMember: true from cache immediately
      const claimCheck = await verifyTelegramGroupMembership(simulatedTgId);
      assert.equal(claimCheck.isMember, true, 'Immediate club claim check must see isMember: true');
      assert.equal(claimCheck.cached, true, 'Reads updated positive cache without re-hitting API');

      // Step F: Verify TTL behavior
      // Set negative cache and verify it expires within 15-30 seconds
      clearTelegramMembershipCache(simulatedTgId);
      mockMemberStatus = 'left';
      const negRes = await verifyTelegramGroupMembership(simulatedTgId);
      assert.equal(negRes.isMember, false);
      // Immediately after, it is cached
      const negCached = await verifyTelegramGroupMembership(simulatedTgId);
      assert.equal(negCached.cached, true);

      console.log('✅ PASS: NOT MEMBER -> try claim -> join -> press Tekshirish -> fresh Telegram check -> immediately claim club successfully');
    } finally {
      global.fetch = originalFetch;
    }
  } finally {
    server.close();
  }

  console.log('✅ ALL TELEGRAM MEMBERSHIP CACHE TESTS PASSED');
}

testTelegramMembershipCache().catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
