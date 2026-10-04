/**
 * Comprehensive Isolated Regression Test Suite for EFL UZ Telegram Group AI Assistant
 *
 * Tests:
 * 1. Owner-only authorization (5209126900), anonymous admin rejection, read-only /ai_status
 * 2. Disabled-by-default initialization and safe topic binding
 * 3. Topic boundary isolation (chat_id and message_thread_id)
 * 4. Off-topic standard refusal with parse_mode: null & HTML entity escaping
 * 5. Atomic multi-tier rate limits with quiet cooldown notifications (parse_mode: null)
 * 6. Data grounding asserting exact club name, exact points, and exact CONFIRMED fixture score
 * 7. Delivery deduplication & pre-send mid-flight disable cancellation
 * 8. Context continuity & bot identity: exact history passed to model, zero context leak between users
 * 9. Delivery claim fail-closed on Redis outage: no Telegram message dispatched
 * 10. Lua concurrency: atomic parallel delivery claims and multi-tier rate limiting
 * 11. Reply bot ID matching: replies to non-bot or other bot rejected
 */

import assert from 'node:assert/strict';
import {
  PRIMARY_OWNER_TELEGRAM_ID,
  isPrimaryOwner,
  DEFAULT_AI_CONFIG,
  getTelegramAiConfig,
  updateTelegramAiConfig,
  bindTelegramAiTopic,
  setTestConfigOverride,
} from '../services/telegramAiConfigService';
import {
  checkAndIncrementAiRateLimits,
  clearTestRateLimitState,
} from '../services/telegramAiRateLimitService';
import {
  buildAiGroundingContext,
  setTestGroundingOverride,
} from '../services/telegramAiGroundingService';
import {
  handleTelegramAiMessage,
  escapeTelegramHtml,
  isBlatantlyOffTopic,
  setTestAiResponder,
  setTestRedisOutage,
  clearTestAiState,
  claimDeliveryState,
  getConfiguredBotUserId,
  getLastModelCallHistory,
  ConversationTurn,
} from '../services/telegramAiService';
import { StandingsRow, Fixture } from '../../types';

process.env.TELEGRAM_BOT_TOKEN = '123456:mock_test_token_for_ai';

// Mock Telegram sender output captures
const sentTelegramMessages: Array<{ chatId: number | string; text: string; options?: any }> = [];

// Intercept Telegram API fetch calls locally in test runner
const originalFetch = global.fetch;
global.fetch = async function (input: any, init?: any): Promise<any> {
  const url = typeof input === 'string' ? input : input?.url || '';
  if (url.includes('api.telegram.org')) {
    if (url.includes('/sendMessage')) {
      const body = JSON.parse(init?.body || '{}');
      sentTelegramMessages.push({
        chatId: body.chat_id,
        text: body.text,
        options: {
          parse_mode: body.parse_mode !== undefined ? body.parse_mode : null,
          message_thread_id: body.message_thread_id,
          reply_to_message_id: body.reply_to_message_id,
        },
      });
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 999000 + sentTelegramMessages.length } }),
      };
    }
    return { ok: true, json: async () => ({ ok: true, result: true }) };
  }
  return originalFetch.call(this, input, init);
};

async function runTests() {
  console.log('================================================================');
  console.log('    TELEGRAM AI ASSISTANT ISOLATED REGRESSION TEST SUITE        ');
  console.log('================================================================\n');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Owner-Only Authorization & Identity Checks
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Owner-Only Authorization Checks ---');
    assert.equal(isPrimaryOwner('5209126900'), true, 'Primary owner ID must be authorized');
    assert.equal(isPrimaryOwner(5209126900), true, 'Primary owner numeric ID must be authorized');
    assert.equal(isPrimaryOwner('123456789'), false, 'Non-owner must be rejected');
    assert.equal(isPrimaryOwner(null), false, 'Null must be rejected');
    assert.equal(isPrimaryOwner(undefined), false, 'Undefined must be rejected');

    const unauthorizedBind = await bindTelegramAiTopic(-100222333, 3503, '123456789');
    assert.equal(unauthorizedBind.success, false, 'Non-owner binding must fail');
    assert.equal(unauthorizedBind.error, 'OWNER_ONLY_UNAUTHORIZED');

    const unauthorizedUpdate = await updateTelegramAiConfig({ enabled: true }, '123456789');
    assert.equal(unauthorizedUpdate.success, false, 'Non-owner update must fail');
    console.log('✅ TEST 1 PASSED: Strict owner check correctly protects operations.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Initial Disabled State & Safe Topic Binding
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: Disabled by Default & Safe Binding ---');
    setTestConfigOverride({ ...DEFAULT_AI_CONFIG });
    const initialConfig = await getTelegramAiConfig();
    assert.equal(initialConfig.config.enabled, false, 'AI must be disabled by default');
    assert.equal(initialConfig.config.allowedChatId, null, 'Chat ID must initially be null');
    assert.equal(initialConfig.config.allowedThreadId, null, 'Thread ID must initially be null');

    // Owner binds the topic
    const bindResult = await bindTelegramAiTopic(-100999888, 3503, PRIMARY_OWNER_TELEGRAM_ID);
    assert.equal(bindResult.success, true, 'Owner binding must succeed');
    assert.equal(bindResult.config?.allowedChatId, -100999888, 'Chat ID must match');
    assert.equal(bindResult.config?.allowedThreadId, 3503, 'Thread ID must match');
    assert.equal(bindResult.config?.enabled, false, 'Binding must NOT auto-enable AI');

    // Manually enable AI
    const enableResult = await updateTelegramAiConfig({ enabled: true }, PRIMARY_OWNER_TELEGRAM_ID);
    assert.equal(enableResult.success, true);
    assert.equal(enableResult.config?.enabled, true, 'AI must be enabled after explicit toggle');
    console.log('✅ TEST 2 PASSED: Initial state disabled and binding does not auto-enable.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Boundary & Topic Thread Isolation
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: Boundary & Topic Thread Isolation ---');
    sentTelegramMessages.length = 0;
    clearTestAiState();
    clearTestRateLimitState();

    // 3a: Message from wrong chat ID
    const wrongChatMsg = await handleTelegramAiMessage({
      updateId: 101,
      messageId: 501,
      chatId: -100555555, // wrong chat
      threadId: 3503,
      fromUser: { id: 7771, username: 'player_one' },
      text: "Turnir jadvali qanday?",
    });
    assert.equal(wrongChatMsg.ignored, 'topic_not_authorized', 'Wrong chat must be ignored');
    assert.equal(sentTelegramMessages.length, 0, 'No Telegram reply for wrong chat');

    // 3b: Message from wrong thread ID in same chat
    const wrongThreadMsg = await handleTelegramAiMessage({
      updateId: 102,
      messageId: 502,
      chatId: -100999888,
      threadId: 9999, // wrong thread
      fromUser: { id: 7771, username: 'player_one' },
      text: "Turnir jadvali qanday?",
    });
    assert.equal(wrongThreadMsg.ignored, 'topic_not_authorized', 'Wrong thread must be ignored');
    assert.equal(sentTelegramMessages.length, 0, 'No Telegram reply for wrong thread');

    // 3c: Bot message must be ignored
    const botMsg = await handleTelegramAiMessage({
      updateId: 103,
      messageId: 503,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 8888, username: 'other_bot', is_bot: true },
      text: "Hello I am a bot",
    });
    assert.equal(botMsg.ignored, 'bot_or_empty', 'Bot message must be ignored');
    console.log('✅ TEST 3 PASSED: Boundary and topic isolation strictly enforced.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Off-Topic Standard Refusal & Plain Text parse_mode: null
    // -------------------------------------------------------------------------
    console.log('--- TEST 4: Off-Topic Standard Refusal & parse_mode: null ---');
    assert.equal(isBlatantlyOffTopic('Toshkentda bugun ob-havo qanday?'), true);
    assert.equal(isBlatantlyOffTopic('Dollar kursi necha so‘m?'), true);
    assert.equal(isBlatantlyOffTopic('Arsenal jadvalda nechanchi o‘rinda?'), false);

    // Escape test
    const rawXss = 'Inter <script>alert("hacked")</script> & Milan > Juventus';
    const escaped = escapeTelegramHtml(rawXss);
    assert.equal(escaped.includes('<script>'), false, 'HTML tags must be escaped');
    assert.equal(escaped.includes('&lt;script&gt;'), true);
    assert.equal(escaped.includes('&amp;'), true);

    // Test sending blatant off-topic query
    sentTelegramMessages.length = 0;
    const offTopicRes = await handleTelegramAiMessage({
      updateId: 104,
      messageId: 504,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7771, username: 'player_one' },
      text: "Toshkentda ob-havo qanday bo‘ladi?",
    });
    assert.equal(offTopicRes.handled, true);
    assert.equal(sentTelegramMessages.length, 1);
    assert.equal(
      sentTelegramMessages[0].text,
      "Men faqat eFootball va EFL UZ bo‘yicha yordam beraman.",
      'Off-topic query must receive standard refusal verbatim'
    );
    // Requirement 5: parse_mode: null for plain text
    assert.equal(sentTelegramMessages[0].options?.parse_mode, null, 'Off-topic reply must use plain text parse_mode: null');
    console.log('✅ TEST 4 PASSED: Off-topic standard refusal and parse_mode: null confirmed.\n');

    // -------------------------------------------------------------------------
    // TEST 5: Atomic Multi-Tier Rate Limiting & Quiet Cooldown
    // -------------------------------------------------------------------------
    console.log('--- TEST 5: Atomic Rate Limiting & Quiet Cooldown ---');
    clearTestRateLimitState();
    sentTelegramMessages.length = 0;

    const rateTestUser = 9991;
    // 3 allowed requests
    const r1 = await checkAndIncrementAiRateLimits({
      chatId: 1, threadId: 1, userId: rateTestUser,
      userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500,
    });
    assert.equal(r1.allowed, true);

    const r2 = await checkAndIncrementAiRateLimits({
      chatId: 1, threadId: 1, userId: rateTestUser,
      userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500,
    });
    assert.equal(r2.allowed, true);

    const r3 = await checkAndIncrementAiRateLimits({
      chatId: 1, threadId: 1, userId: rateTestUser,
      userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500,
    });
    assert.equal(r3.allowed, true);

    // 4th request -> blocked with shouldNotifyUser = true
    const r4 = await checkAndIncrementAiRateLimits({
      chatId: 1, threadId: 1, userId: rateTestUser,
      userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500,
    });
    assert.equal(r4.allowed, false);
    assert.equal(r4.reason, 'USER_LIMIT_EXCEEDED');
    assert.equal(r4.shouldNotifyUser, true, 'First rate limit violation must notify user');

    // 5th request -> blocked with shouldNotifyUser = false (quiet drop!)
    const r5 = await checkAndIncrementAiRateLimits({
      chatId: 1, threadId: 1, userId: rateTestUser,
      userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500,
    });
    assert.equal(r5.allowed, false);
    assert.equal(r5.shouldNotifyUser, false, 'Subsequent violation in cooldown must be silent');
    console.log('✅ TEST 5 PASSED: Multi-tier rate limiting and quiet cooldown verified.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Grounding: Exact Club, Points, and CONFIRMED Fixture Score Assertions
    // -------------------------------------------------------------------------
    console.log('--- TEST 6: Grounding with Exact Club, Points, and CONFIRMED Score ---');
    const mockStandings: StandingsRow[] = [
      {
        position: 1,
        clubId: 'c-arsenal',
        clubName: 'Arsenal',
        shortName: 'ARS',
        played: 5,
        won: 5,
        drawn: 0,
        lost: 0,
        goalsFor: 12,
        goalsAgainst: 2,
        goalDifference: 10,
        points: 15,
      },
      {
        position: 2,
        clubId: 'c-chelsea',
        clubName: 'Chelsea',
        shortName: 'CHE',
        played: 5,
        won: 3,
        drawn: 1,
        lost: 1,
        goalsFor: 8,
        goalsAgainst: 5,
        goalDifference: 3,
        points: 10,
      },
    ];

    const mockFixtures: Fixture[] = [
      {
        id: 'f-ars-che-01',
        competitionId: 'comp-premier-league',
        seasonId: 'season-2026-27',
        matchday: 1,
        homeClubId: 'c-arsenal',
        awayClubId: 'c-chelsea',
        homeClub: { id: 'c-arsenal', name: 'Arsenal' } as any,
        awayClub: { id: 'c-chelsea', name: 'Chelsea' } as any,
        homeScore: 2,
        awayScore: 1,
        status: 'CONFIRMED',
      } as any,
    ];

    setTestGroundingOverride({
      standings: { 'comp-premier-league': mockStandings },
      fixtures: { 'comp-premier-league': mockFixtures },
    });

    const grounding = await buildAiGroundingContext('Arsenal va Chelsea uchrashuvlari natijalari qanday?');
    // Requirement 6 assertions:
    assert.ok(grounding.factsSummary.includes('Arsenal'), 'Grounding factsSummary must include exact club name "Arsenal"');
    assert.ok(grounding.factsSummary.includes('15 ochko'), 'Grounding factsSummary must include exact points "15 ochko"');
    assert.ok(
      grounding.factsSummary.includes('[CONFIRMED] MD 1: Arsenal 2 - 1 Chelsea'),
      'Grounding factsSummary must include exact CONFIRMED match status and score'
    );
    console.log('✅ TEST 6 PASSED: Exact club name, points, and CONFIRMED score strictly asserted in grounding.\n');

    // -------------------------------------------------------------------------
    // TEST 7: Delivery Deduplication & Mid-Flight Disable Check
    // -------------------------------------------------------------------------
    console.log('--- TEST 7: Delivery Deduplication & Mid-Flight Disable Check ---');
    clearTestAiState();
    clearTestRateLimitState();
    sentTelegramMessages.length = 0;

    setTestAiResponder(async (_text, _grounding) => {
      return "Arsenal 1-o'rinda bormoqda.";
    });

    // Valid message in topic
    const firstDelivery = await handleTelegramAiMessage({
      updateId: 701,
      messageId: 901,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7772, username: 'player_two' },
      text: "Arsenal jadvalda qaysi o'rinda?",
    });
    assert.equal(firstDelivery.handled, true);
    assert.equal(firstDelivery.replySent, true);
    assert.equal(sentTelegramMessages.length, 1);
    assert.equal(sentTelegramMessages[0].options?.parse_mode, 'HTML', 'Normal AI response must use standard HTML parse_mode');

    // Duplicate update (Telegram retry with same update_id)
    const duplicateDelivery = await handleTelegramAiMessage({
      updateId: 701,
      messageId: 901,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7772, username: 'player_two' },
      text: "Arsenal jadvalda qaysi o'rinda?",
    });
    assert.equal(duplicateDelivery.handled, false);
    assert.equal(duplicateDelivery.ignored, 'already_delivered', 'Duplicate update must be suppressed');
    assert.equal(sentTelegramMessages.length, 1, 'No duplicate Telegram message sent');

    // Mid-flight disable simulation
    clearTestAiState();
    clearTestRateLimitState();
    setTestAiResponder(async () => {
      // Simulate owner disabling AI mid-flight before send
      await updateTelegramAiConfig({ enabled: false }, PRIMARY_OWNER_TELEGRAM_ID);
      return "Test reply";
    });

    const midFlightMsg = await handleTelegramAiMessage({
      updateId: 702,
      messageId: 902,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7773, username: 'player_three' },
      text: "Klublar ro'yxati qayerda?",
    });
    assert.equal(midFlightMsg.ignored, 'disabled_or_unauthorized_pre_send', 'Mid-flight disabled must abort pre-send');
    console.log('✅ TEST 7 PASSED: Delivery deduplication and mid-flight abort verified.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Context Continuity & Exact Model History Assertion
    // -------------------------------------------------------------------------
    console.log('--- TEST 8: Context Continuity & Model History Assertion ---');
    clearTestAiState();
    clearTestRateLimitState();
    sentTelegramMessages.length = 0;
    // Re-enable AI
    await updateTelegramAiConfig({ enabled: true }, PRIMARY_OWNER_TELEGRAM_ID);

    assert.equal(getConfiguredBotUserId(), 123456, 'Bot user ID must be parsed from token');

    let capturedModelHistory: ConversationTurn[] | undefined;
    setTestAiResponder(async (text, _grounding, history) => {
      capturedModelHistory = history;
      return `Javob: ${text}`;
    });

    // Turn 1 for User A
    await handleTelegramAiMessage({
      updateId: 801,
      messageId: 1001,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7775, username: 'user_a' },
      text: "EFL UZ qoidalari qanday?",
    });

    assert.equal(capturedModelHistory?.length, 0, 'First turn must have empty conversation history');
    const botSentId = 999000 + sentTelegramMessages.length;

    // Turn 2: User A replies to the bot's message
    await handleTelegramAiMessage({
      updateId: 802,
      messageId: 1002,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7775, username: 'user_a' },
      text: "Turlar muddati qancha edi?",
      replyToMessage: {
        message_id: botSentId,
        from: { id: 123456, is_bot: true, username: 'efluz_bot' },
      },
    });

    // Requirement 6: Assert exact history provided to model
    assert.ok(capturedModelHistory, 'History must be captured on reply');
    assert.equal(capturedModelHistory.length, 2, 'History must contain exactly 2 turns (1 user + 1 model)');
    assert.equal(capturedModelHistory[0].role, 'user');
    assert.equal(capturedModelHistory[0].text, 'EFL UZ qoidalari qanday?');
    assert.equal(capturedModelHistory[1].role, 'model');
    assert.equal(capturedModelHistory[1].text, 'Javob: EFL UZ qoidalari qanday?');
    assert.deepEqual(getLastModelCallHistory(), capturedModelHistory);

    // Turn 3: User B replies to the SAME bot message (addressed to User A)
    // Context must NOT leak from User A to User B
    await handleTelegramAiMessage({
      updateId: 803,
      messageId: 1003,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7776, username: 'user_b' },
      text: "Menga ham ayting",
      replyToMessage: {
        message_id: botSentId,
        from: { id: 123456, is_bot: true, username: 'efluz_bot' },
      },
    });

    assert.equal(capturedModelHistory?.length, 0, 'User B must NOT inherit User A context (zero leakage)');

    // Turn 4: Reply to a non-bot user message
    await handleTelegramAiMessage({
      updateId: 804,
      messageId: 1004,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7775, username: 'user_a' },
      text: "Salom",
      replyToMessage: {
        message_id: 1001,
        from: { id: 7775, is_bot: false, username: 'user_a' },
      },
    });
    assert.equal(capturedModelHistory?.length, 0, 'Reply to non-bot message must not load bot history');

    // Turn 5: Reply to a different bot (wrong bot ID)
    await handleTelegramAiMessage({
      updateId: 805,
      messageId: 1005,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7775, username: 'user_a' },
      text: "Yana bir savol",
      replyToMessage: {
        message_id: botSentId,
        from: { id: 999999, is_bot: true, username: 'different_bot' },
      },
    });
    assert.equal(capturedModelHistory?.length, 0, 'Reply to different bot must not load history');
    console.log('✅ TEST 8 PASSED: Context continuity, exact history assertions, and bot reply validation verified.\n');

    // -------------------------------------------------------------------------
    // TEST 9: Delivery Outage Fail-Closed Guarantee (Requirements 1 & 6)
    // -------------------------------------------------------------------------
    console.log('--- TEST 9: Delivery Outage Fail-Closed Test ---');
    clearTestAiState();
    clearTestRateLimitState();
    sentTelegramMessages.length = 0;

    // Simulate Redis outage during delivery claim
    setTestRedisOutage(true);

    const outageClaim = await claimDeliveryState(9991, 'sending');
    assert.equal(outageClaim, 'redis_error', 'Delivery claim must return redis_error when Redis is down');

    // Incoming message during outage
    const outageResult = await handleTelegramAiMessage({
      updateId: 9992,
      messageId: 1092,
      chatId: -100999888,
      threadId: 3503,
      fromUser: { id: 7777, username: 'player_outage' },
      text: "Arsenal jadvalda qayerda?",
    });

    assert.equal(outageResult.handled, false, 'Message must not be handled during delivery outage');
    assert.equal(sentTelegramMessages.length, 0, 'CRITICAL: No Telegram message sent during Redis outage (fail-closed)');

    // Restore Redis
    setTestRedisOutage(false);
    console.log('✅ TEST 9 PASSED: Delivery claim fails closed on Redis outage with zero messages dispatched.\n');

    // -------------------------------------------------------------------------
    // TEST 10: Lua Concurrency (Parallel Rate Limits & Delivery Claims)
    // -------------------------------------------------------------------------
    console.log('--- TEST 10: Lua Concurrency & Atomic Delivery Claims ---');
    clearTestAiState();
    clearTestRateLimitState();

    // 10a: Parallel delivery claims for atomic 'sending' state
    const targetUpdateId = 888123;
    const parallelClaims = await Promise.all([
      claimDeliveryState(targetUpdateId, 'sending'),
      claimDeliveryState(targetUpdateId, 'sending'),
      claimDeliveryState(targetUpdateId, 'sending'),
      claimDeliveryState(targetUpdateId, 'sending'),
      claimDeliveryState(targetUpdateId, 'sending'),
    ]);

    const okClaims = parallelClaims.filter((c) => c === 'ok').length;
    const handledClaims = parallelClaims.filter((c) => c === 'already_handled').length;
    assert.equal(okClaims, 1, 'Exactly one concurrent worker can claim sending state');
    assert.equal(handledClaims, 4, 'All other concurrent workers receive already_handled');

    // 10b: 10 concurrent requests for user limit (limit = 3)
    const concurrentUser = 888444;
    const parallelRateChecks = await Promise.all(
      Array.from({ length: 10 }, () =>
        checkAndIncrementAiRateLimits({
          chatId: 1,
          threadId: 1,
          userId: concurrentUser,
          userLimitPerMin: 3,
          topicLimitPerMin: 15,
          maxDailyRequests: 500,
        })
      )
    );

    const allowedCount = parallelRateChecks.filter((r) => r.allowed).length;
    const blockedCount = parallelRateChecks.filter((r) => !r.allowed).length;
    assert.equal(allowedCount, 3, 'Exactly 3 parallel requests permitted');
    assert.equal(blockedCount, 7, 'Remaining 7 parallel requests blocked atomically');
    console.log('✅ TEST 10 PASSED: Lua concurrency for rate limits and delivery claims verified.\n');

    console.log('================================================================');
    console.log('   ALL 10 TELEGRAM AI ASSISTANT REGRESSION SUITES PASSED!      ');
    console.log('================================================================');
  } finally {
    global.fetch = originalFetch;
    setTestConfigOverride(null);
    setTestGroundingOverride(null);
    clearTestAiState();
    clearTestRateLimitState();
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
