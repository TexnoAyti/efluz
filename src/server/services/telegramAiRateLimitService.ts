import { getAiRedisClient, withinAiDeadline } from './telegramAiDeadline';
/**
 * Telegram AI Rate Limit & Quota Service
 *
 * Implements:
 * 1. Single atomic Redis Lua script evaluating User, Topic, and Daily limits simultaneously
 * 2. Atomic increment of all 3 counters only if all 3 limits pass
 * 3. Quiet cooldown warning throttler (at most 1 notification per 5 min per user)
 * 4. Production fail-closed contract when Redis is unreachable
 */

import { KEY_PREFIX } from '../readModel/readModelStore';

export interface RateLimitCheckResult {
  allowed: boolean;
  reason?: 'USER_LIMIT_EXCEEDED' | 'TOPIC_LIMIT_EXCEEDED' | 'DAILY_LIMIT_EXCEEDED' | 'REDIS_UNAVAILABLE';
  current?: number;
  limit?: number;
  shouldNotifyUser?: boolean;
}

/**
 * Single Unified Atomic Lua Script:
 * KEYS[1]: user counter key
 * KEYS[2]: topic counter key
 * KEYS[3]: daily counter key
 * KEYS[4]: cooldown notification key
 *
 * ARGV[1]: user limit
 * ARGV[2]: topic limit
 * ARGV[3]: daily limit
 * ARGV[4]: user window (seconds)
 * ARGV[5]: topic window (seconds)
 * ARGV[6]: daily window (seconds)
 * ARGV[7]: cooldown window (seconds)
 *
 * Returns:
 * [1, "OK", userCount]
 * [0, "DAILY", dailyCount]
 * [0, "TOPIC", topicCount]
 * [0, "USER_NOTIFY", userCount]
 * [0, "USER_SILENT", userCount]
 */
const UNIFIED_ATOMIC_RATE_LIMIT_LUA = `
local userKey = KEYS[1]
local topicKey = KEYS[2]
local dailyKey = KEYS[3]
local cooldownKey = KEYS[4]

local userLimit = tonumber(ARGV[1])
local topicLimit = tonumber(ARGV[2])
local dailyLimit = tonumber(ARGV[3])
local userWindow = tonumber(ARGV[4])
local topicWindow = tonumber(ARGV[5])
local dailyWindow = tonumber(ARGV[6])
local cooldownWindow = tonumber(ARGV[7])

-- 1. Check daily limit
local currentDaily = tonumber(redis.call('GET', dailyKey) or '0')
if currentDaily >= dailyLimit then
  return {0, "DAILY", currentDaily}
end

-- 2. Check topic limit
local currentTopic = tonumber(redis.call('GET', topicKey) or '0')
if currentTopic >= topicLimit then
  return {0, "TOPIC", currentTopic}
end

-- 3. Check user limit
local currentUser = tonumber(redis.call('GET', userKey) or '0')
if currentUser >= userLimit then
  local cooldownSet = redis.call('SET', cooldownKey, '1', 'EX', cooldownWindow, 'NX')
  if cooldownSet then
    return {0, "USER_NOTIFY", currentUser}
  else
    return {0, "USER_SILENT", currentUser}
  end
end

-- All checks passed: atomically increment all three counters
local nextDaily = redis.call('INCR', dailyKey)
if nextDaily == 1 then
  redis.call('EXPIRE', dailyKey, dailyWindow)
end

local nextTopic = redis.call('INCR', topicKey)
if nextTopic == 1 then
  redis.call('EXPIRE', topicKey, topicWindow)
end

local nextUser = redis.call('INCR', userKey)
if nextUser == 1 then
  redis.call('EXPIRE', userKey, userWindow)
end

return {1, "OK", nextUser}
`;

// Test-environment memory counters
interface MemoryCounter {
  count: number;
  expiresAt: number;
}
const testMemoryCounters = new Map<string, MemoryCounter>();

export function clearTestRateLimitState(): void {
  testMemoryCounters.clear();
}

/**
 * Synchronous atomic emulation for test environment
 */
function evaluateMemoryRateLimits(params: {
  dailyKey: string;
  topicKey: string;
  userKey: string;
  cooldownKey: string;
  userLimit: number;
  topicLimit: number;
  dailyLimit: number;
  now: number;
}): RateLimitCheckResult {
  const { dailyKey, topicKey, userKey, cooldownKey, userLimit, topicLimit, dailyLimit, now } = params;

  // 1. Daily
  const dailyRecord = testMemoryCounters.get(dailyKey);
  const currentDaily = dailyRecord && dailyRecord.expiresAt > now ? dailyRecord.count : 0;
  if (currentDaily >= dailyLimit) {
    return { allowed: false, reason: 'DAILY_LIMIT_EXCEEDED', current: currentDaily, limit: dailyLimit };
  }

  // 2. Topic
  const topicRecord = testMemoryCounters.get(topicKey);
  const currentTopic = topicRecord && topicRecord.expiresAt > now ? topicRecord.count : 0;
  if (currentTopic >= topicLimit) {
    return { allowed: false, reason: 'TOPIC_LIMIT_EXCEEDED', current: currentTopic, limit: topicLimit };
  }

  // 3. User
  const userRecord = testMemoryCounters.get(userKey);
  const currentUser = userRecord && userRecord.expiresAt > now ? userRecord.count : 0;
  if (currentUser >= userLimit) {
    const cooldownRecord = testMemoryCounters.get(cooldownKey);
    const hasActiveCooldown = cooldownRecord && cooldownRecord.expiresAt > now;
    if (!hasActiveCooldown) {
      testMemoryCounters.set(cooldownKey, { count: 1, expiresAt: now + 300 * 1000 });
      return { allowed: false, reason: 'USER_LIMIT_EXCEEDED', current: currentUser, limit: userLimit, shouldNotifyUser: true };
    } else {
      return { allowed: false, reason: 'USER_LIMIT_EXCEEDED', current: currentUser, limit: userLimit, shouldNotifyUser: false };
    }
  }

  // Atomically increment all
  testMemoryCounters.set(dailyKey, { count: currentDaily + 1, expiresAt: dailyRecord && dailyRecord.expiresAt > now ? dailyRecord.expiresAt : now + 86400 * 1000 });
  testMemoryCounters.set(topicKey, { count: currentTopic + 1, expiresAt: topicRecord && topicRecord.expiresAt > now ? topicRecord.expiresAt : now + 60 * 1000 });
  testMemoryCounters.set(userKey, { count: currentUser + 1, expiresAt: userRecord && userRecord.expiresAt > now ? userRecord.expiresAt : now + 60 * 1000 });

  return { allowed: true, current: currentUser + 1, limit: userLimit };
}

/**
 * Checks all tiers of rate limits (Daily, Topic, User) in ONE atomic Redis operation.
 */
export async function checkAndIncrementAiRateLimits(params: {
  chatId: number;
  threadId: number;
  userId: number;
  userLimitPerMin: number;
  topicLimitPerMin: number;
  maxDailyRequests: number;
  signal?: AbortSignal;
}): Promise<RateLimitCheckResult> {
  if (params.signal?.aborted) {
    return { allowed: false, reason: 'REDIS_UNAVAILABLE' };
  }

  const client = getAiRedisClient(params.signal);
  const isProd = process.env.NODE_ENV === 'production';

  const today = new Date().toISOString().slice(0, 10);
  const dailyKey = `${KEY_PREFIX}:telegram:ai:daily:${today}`;
  const topicKey = `${KEY_PREFIX}:telegram:ai:rl:topic:${params.chatId}:${params.threadId}`;
  const userKey = `${KEY_PREFIX}:telegram:ai:rl:user:${params.chatId}:${params.threadId}:${params.userId}`;
  const cooldownKey = `${KEY_PREFIX}:telegram:ai:cooldown:${params.chatId}:${params.threadId}:${params.userId}`;

  if (!client) {
    if (isProd) {
      return { allowed: false, reason: 'REDIS_UNAVAILABLE' };
    }
    return evaluateMemoryRateLimits({
      dailyKey,
      topicKey,
      userKey,
      cooldownKey,
      userLimit: params.userLimitPerMin,
      topicLimit: params.topicLimitPerMin,
      dailyLimit: params.maxDailyRequests,
      now: Date.now(),
    });
  }

  try {
    const rawRes: any = await client.eval(
      UNIFIED_ATOMIC_RATE_LIMIT_LUA,
      [userKey, topicKey, dailyKey, cooldownKey],
      [
        params.userLimitPerMin,
        params.topicLimitPerMin,
        params.maxDailyRequests,
        60,   // user window
        60,   // topic window
        86400, // daily window
        300,  // cooldown window (5 mins)
      ]
    );

    const status = Array.isArray(rawRes) ? Number(rawRes[0]) : 0;
    const code = Array.isArray(rawRes) ? String(rawRes[1]) : 'UNKNOWN';
    const count = Array.isArray(rawRes) ? Number(rawRes[2]) : 0;

    if (status === 1) {
      return { allowed: true, current: count, limit: params.userLimitPerMin };
    }

    if (code === 'DAILY') {
      return { allowed: false, reason: 'DAILY_LIMIT_EXCEEDED', current: count, limit: params.maxDailyRequests };
    }
    if (code === 'TOPIC') {
      return { allowed: false, reason: 'TOPIC_LIMIT_EXCEEDED', current: count, limit: params.topicLimitPerMin };
    }
    if (code === 'USER_NOTIFY') {
      return { allowed: false, reason: 'USER_LIMIT_EXCEEDED', current: count, limit: params.userLimitPerMin, shouldNotifyUser: true };
    }
    // USER_SILENT
    return { allowed: false, reason: 'USER_LIMIT_EXCEEDED', current: count, limit: params.userLimitPerMin, shouldNotifyUser: false };
  } catch (err: any) {
    console.error('[AI RATE LIMIT] Redis atomic rate limit evaluation failed:', err?.message || err);
    return { allowed: false, reason: 'REDIS_UNAVAILABLE' };
  }
}

/**
 * Gets diagnostic metrics about current rate limits & daily usage.
 */
export async function getAiRateLimitMetrics(todayStr?: string): Promise<{
  dailyRequests: number;
  date: string;
}> {
  const date = todayStr || new Date().toISOString().slice(0, 10);
  const client = getAiRedisClient();
  if (!client) {
    const dailyKey = `${KEY_PREFIX}:telegram:ai:daily:${date}`;
    const memory = testMemoryCounters.get(dailyKey);
    return { dailyRequests: memory ? memory.count : 0, date };
  }

  try {
    const dailyKey = `${KEY_PREFIX}:telegram:ai:daily:${date}`;
    const count = await client.get<number | string>(dailyKey);
    return { dailyRequests: Number(count) || 0, date };
  } catch {
    return { dailyRequests: 0, date };
  }
}
