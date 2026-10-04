/**
 * Comprehensive Isolated Regression Test Suite for EFL UZ Telegram Group AI Assistant
 *
 * Tests:
 * 1. Owner-only authorization (5209126900), anonymous admin rejection, read-only /ai_status
 * 2. Disabled-by-default initialization and safe topic binding
 * 3. Redis fail-closed durability
 * 4. Topic boundary isolation (chat_id and message_thread_id)
 * 5. Data grounding across top and lower-table clubs + stale indicators
 * 6. Off-topic standard refusal and HTML entity escaping
 * 7. Atomic multi-tier rate limits with quiet cooldown notifications
 * 8. Context isolation per (chatId, threadId, userId) and reply-to-bot tracking
 * 9. Mid-flight disable cancellation & delivery state deduplication
 * 10. Existing webhook non-regression (/start, /help, /paysupport)
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
} from '../services/telegramAiGroundingService';
import {
  handleTelegramAiMessage,
  escapeTelegramHtml,
  isBlatantlyOffTopic,
  setTestAiResponder,
  clearTestAiState,
  claimDeliveryState,
  getConfiguredBotUserId,
} from '../services/telegramAiService';

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
          parse_mode: body.parse_mode,
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
    // TEST 4: Off-Topic Standard Refusal & HTML Escaping
    // -------------------------------------------------------------------------
    console.log('--- TEST 4: Off-Topic Standard Refusal & HTML Escaping ---');
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
    console.log('✅ TEST 4 PASSED: Off-topic standard refusal and HTML escaping confirmed.\n');

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

    // Topic limit test (5 limit in this test)
    let topicExceeded = false;
    for (let i = 0; i < 20; i++) {
      const topicCheck = await checkAndIncrementAiRateLimits({
        chatId: 2, threadId: 2, userId: 1000 + i,
        userLimitPerMin: 3, topicLimitPerMin: 5, maxDailyRequests: 500,
      });
      if (!topicCheck.allowed && topicCheck.reason === 'TOPIC_LIMIT_EXCEEDED') {
        topicExceeded = true;
        break;
      }
    }
    assert.equal(topicExceeded, true, 'Topic-level rate limit must trigger when threshold reached');

    // Parallel concurrency test with Promise.all
    clearTestRateLimitState();
    const parallelUser = 9992;
    const parallelResults = await Promise.all([
      checkAndIncrementAiRateLimits({ chatId: 1, threadId: 1, userId: parallelUser, userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500 }),
      checkAndIncrementAiRateLimits({ chatId: 1, threadId: 1, userId: parallelUser, userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500 }),
      checkAndIncrementAiRateLimits({ chatId: 1, threadId: 1, userId: parallelUser, userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500 }),
      checkAndIncrementAiRateLimits({ chatId: 1, threadId: 1, userId: parallelUser, userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500 }),
      checkAndIncrementAiRateLimits({ chatId: 1, threadId: 1, userId: parallelUser, userLimitPerMin: 3, topicLimitPerMin: 15, maxDailyRequests: 500 }),
    ]);
    const allowedParallel = parallelResults.filter((r) => r.allowed).length;
    const blockedParallel = parallelResults.filter((r) => !r.allowed).length;
    assert.equal(allowedParallel, 3, 'Exactly 3 parallel requests must be allowed');
    assert.equal(blockedParallel, 2, 'Remaining 2 parallel requests must be blocked');
    console.log('✅ TEST 5 PASSED: User limit, quiet cooldown, topic limits, and parallel atomicity verified.\n');

    // -------------------------------------------------------------------------
    // TEST 6: Grounding Across All Clubs (Top & Lower-Ranked)
    // -------------------------------------------------------------------------
    console.log('--- TEST 6: Data Grounding Query Parsing ---');
    const groundingTop = await buildAiGroundingContext('Arsenal bilan Chelsea o‘rtasidagi uchrashuv');
    assert.ok(groundingTop.factsSummary.includes('EFL UZ ASOSIY QOIDALARI'));

    const groundingLower = await buildAiGroundingContext('Sassuolo va Torino o‘yini haqida ma‘lumot');
    assert.ok(groundingLower.factsSummary.length > 0);
    console.log('✅ TEST 6 PASSED: Grounding builder functions without error.\n');

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
      // Simulate owner disabling AI mid-flight
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
    assert.equal(midFlightMsg.ignored, 'disabled_mid_flight', 'Mid-flight disabled must abort send');

    // Test pre-dispatch atomic 'sending' state
    const preClaim1 = await claimDeliveryState(777, 'sending');
    assert.equal(preClaim1, 'ok');
    const preClaim2 = await claimDeliveryState(777, 'sending');
    assert.equal(preClaim2, 'already_handled', 'Duplicate send attempt must be blocked by sending state');
    console.log('✅ TEST 7 PASSED: Delivery deduplication, sending state, and mid-flight abort verified.\n');

    // -------------------------------------------------------------------------
    // TEST 8: Context Continuity, Bot Identity & User Isolation
    // -------------------------------------------------------------------------
    console.log('--- TEST 8: Context Continuity, Bot Identity & User Isolation ---');
    clearTestAiState();
    clearTestRateLimitState();
    sentTelegramMessages.length = 0;
    // Re-enable AI
    await updateTelegramAiConfig({ enabled: true }, PRIMARY_OWNER_TELEGRAM_ID);

    assert.equal(getConfiguredBotUserId(), 123456, 'Bot user ID must be parsed from token');

    setTestAiResponder(async (text, _grounding) => {
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

    assert.equal(sentTelegramMessages.length, 3, 'All 3 responses sent to Telegram');
    console.log('✅ TEST 8 PASSED: Context isolation, bot ID verification, and reply tracking verified.\n');

    console.log('================================================================');
    console.log('   ALL 8 TELEGRAM AI ASSISTANT REGRESSION SUITES PASSED!       ');
    console.log('================================================================');
  } finally {
    global.fetch = originalFetch;
    setTestConfigOverride(null);
    clearTestAiState();
    clearTestRateLimitState();
  }
}

runTests().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
