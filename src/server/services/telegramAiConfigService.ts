import { getAiRedisClient, withinAiDeadline } from './telegramAiDeadline';
/**
 * Telegram AI Assistant Configuration Service
 *
 * Enforces:
 * 1. Strict primary owner authorization (Telegram ID: 5209126900)
 * 2. Disabled by default initialization
 * 3. Durable PostgreSQL/Redis persistence with fail-closed behavior on outage
 * 4. Topic binding without auto-enabling AI
 */

import { KEY_PREFIX } from '../readModel/readModelStore';

export const PRIMARY_OWNER_TELEGRAM_ID = '5209126900';

export interface TelegramAiConfig {
  enabled: boolean;
  allowedChatId: number | null;
  allowedThreadId: number | null;
  groupUsername: string;
  rateLimitUserPerMin: number;
  rateLimitTopicPerMin: number;
  maxDailyRequests: number;
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_AI_CONFIG: TelegramAiConfig = {
  enabled: false,
  allowedChatId: null,
  allowedThreadId: null,
  groupUsername: process.env.TELEGRAM_GROUP_USERNAME?.trim() || '@efleagueuz',
  rateLimitUserPerMin: 3,
  rateLimitTopicPerMin: 15,
  maxDailyRequests: 500,
  updatedAt: new Date().toISOString(),
  updatedBy: 'system_default',
};

// In-memory test store used ONLY in unit tests when Redis is mock-bypassed
let testConfigOverride: TelegramAiConfig | null = null;

export function setTestConfigOverride(config: TelegramAiConfig | null): void {
  testConfigOverride = config;
}

export function isPrimaryOwner(telegramId: string | number | undefined | null): boolean {
  if (telegramId === undefined || telegramId === null) return false;
  return String(telegramId).trim() === PRIMARY_OWNER_TELEGRAM_ID;
}

export function getAiConfigRedisKey(): string {
  return `${KEY_PREFIX}:telegram:ai_config`;
}

/**
 * Retrieves the current AI configuration.
 * Fail-closed in production if the durable state store is unavailable.
 */
export async function getTelegramAiConfig(options?: { signal?: AbortSignal }): Promise<{ config: TelegramAiConfig; redisAvailable: boolean }> {
  if (options?.signal?.aborted) {
    return {
      config: { ...DEFAULT_AI_CONFIG, enabled: false },
      redisAvailable: false,
    };
  }

  if (testConfigOverride) {
    return { config: { ...testConfigOverride }, redisAvailable: true };
  }

  const client = getAiRedisClient(options?.signal);
  if (!client) {
    // Fail-closed: do not allow AI to run if Redis is unavailable in production
    return {
      config: { ...DEFAULT_AI_CONFIG, enabled: false },
      redisAvailable: false,
    };
  }

  try {
    const raw = await client.get<string | TelegramAiConfig>(getAiConfigRedisKey());
    if (!raw) {
      // A new PostgreSQL installation stays disabled until the owner configures
      // it. Do not invent a topic or enable sending while importing old state.
      if (process.env.DATABASE_PROVIDER === 'supabase') return {config:{...DEFAULT_AI_CONFIG},redisAvailable:true};
      // Store default configuration atomically
      await client.set(getAiConfigRedisKey(), JSON.stringify(DEFAULT_AI_CONFIG), { nx: true });
      return getTelegramAiConfig(options);

    }

    const parsed: TelegramAiConfig = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      config: {
        ...DEFAULT_AI_CONFIG,
        ...parsed,
        // Guarantee numbers and booleans
        enabled: Boolean(parsed.enabled),
        allowedChatId: parsed.allowedChatId !== null ? Number(parsed.allowedChatId) : null,
        allowedThreadId: parsed.allowedThreadId !== null ? Number(parsed.allowedThreadId) : null,
        rateLimitUserPerMin: Number(parsed.rateLimitUserPerMin) || DEFAULT_AI_CONFIG.rateLimitUserPerMin,
        rateLimitTopicPerMin: Number(parsed.rateLimitTopicPerMin) || DEFAULT_AI_CONFIG.rateLimitTopicPerMin,
        maxDailyRequests: Number(parsed.maxDailyRequests) || DEFAULT_AI_CONFIG.maxDailyRequests,
      },
      redisAvailable: true,
    };
  } catch (err: any) {
    console.error('[AI CONFIG] Failed to read durable state, failing closed:', err?.message || err);
    return {
      config: { ...DEFAULT_AI_CONFIG, enabled: false },
      redisAvailable: false,
    };
  }
}

/**
 * Updates AI configuration.
 * Strictly requires primary owner identity (ID: 5209126900).
 */
export async function updateTelegramAiConfig(
  updates: Partial<TelegramAiConfig>,
  actorTelegramId: string | number
): Promise<{ success: boolean; config?: TelegramAiConfig; error?: string }> {
  if (!isPrimaryOwner(actorTelegramId)) {
    return { success: false, error: 'OWNER_ONLY_UNAUTHORIZED' };
  }

  const client = getAiRedisClient();
  if (!client && !testConfigOverride) {
    return { success: false, error: 'REDIS_UNAVAILABLE_CANNOT_PERSIST' };
  }

  const currentResult = await getTelegramAiConfig();
  const base = currentResult.config;

  const nextConfig: TelegramAiConfig = {
    ...base,
    ...updates,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actorTelegramId),
  };

  if (testConfigOverride) {
    testConfigOverride = nextConfig;
    return { success: true, config: nextConfig };
  }

  try {
    await client!.set(getAiConfigRedisKey(), JSON.stringify(nextConfig));
    return { success: true, config: nextConfig };
  } catch (err: any) {
    console.error('[AI CONFIG] Failed to save durable config:', err?.message || err);
    return { success: false, error: 'REDIS_PERSISTENCE_FAILED' };
  }
}

/**
 * Binds the Telegram Chat ID and Message Thread ID to the AI Assistant.
 * Strictly requires primary owner identity.
 * Does NOT automatically enable AI — enabled state remains unchanged.
 */
export async function bindTelegramAiTopic(
  chatId: number,
  threadId: number,
  actorTelegramId: string | number
): Promise<{ success: boolean; config?: TelegramAiConfig; error?: string }> {
  if (!isPrimaryOwner(actorTelegramId)) {
    return { success: false, error: 'OWNER_ONLY_UNAUTHORIZED' };
  }

  return updateTelegramAiConfig(
    {
      allowedChatId: chatId,
      allowedThreadId: threadId,
    },
    actorTelegramId
  );
}
