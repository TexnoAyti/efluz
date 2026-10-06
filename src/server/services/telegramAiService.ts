import { getAiRedisClient, withinAiDeadline } from './telegramAiDeadline';
import { getDeliveredAiAdminDraft, rememberDeliveredAiAdminDraft } from './telegramAiAdminDraft';
/**
 * Telegram AI Assistant Main Orchestration Service
 *
 * Enforces:
 * 1. Unified 6-second processing timeout starting before configuration loading
 * 2. Strict Delivery State transition (pending -> sending -> sent / unknown_timeout)
 *    Pre-dispatch atomic 'sending' state prevents duplicate sends on retries.
 *    Redis outage or delivery claim error FAILS CLOSED: never sends to Telegram.
 * 3. All replies (cooldown warnings, off-topic refusals, AI answers) dispatched
 *    via a single, unified sending claim mechanism.
 * 4. Mid-flight authorization & health re-check immediately before dispatching to Telegram
 *    (enabled, redisAvailable, chatId, threadId).
 * 5. Reply context verification: only loaded when specifically addressed to our exact bot ID
 *    and matching the indexed message for (chatId, threadId, userId). Returns false on missing index or Redis error.
 * 6. Safe HTML entity escaping and length limits (max 1000 chars), with parse_mode: null for plain text.
 * 7. Gemini request abortSignal passing to ensure network requests are genuinely cancelled on timeout.
 */

import { GoogleGenAI } from '@google/genai';
import { KEY_PREFIX } from '../readModel/readModelStore';
import { getTelegramAiConfig } from './telegramAiConfigService';
import { checkAndIncrementAiRateLimits } from './telegramAiRateLimitService';
import { buildAiGroundingContext } from './telegramAiGroundingService';
import { buildTelegramAiSystemPrompt } from './telegramAiPrompt';
import { resolveAiSpeaker, addressAiFact, aiSocialReply } from './telegramAiPersonality';
import { generateGroundedTelegramAnswer, AI_CLARIFICATION_REPLY, aiProviderFailureKind } from './telegramAiReadTools';
import { buildAiFallbackReply } from './telegramAiFallback';
import { isAiAdminCommand } from './telegramAiAdminCatalog';
import { decorateAiCustomEmoji } from './telegramAiCustomEmoji';
import { handleAiAdminCommand, isOwnerAdminPrivateChat, rememberDeliveredAdminPlan } from './telegramAiAdminService';
import { isAiAdminActor } from './telegramAiAdminAccess';
import { isPersonalFixtureQuestion, buildPersonalFixtureReply } from './telegramAiPersonalFixtureService';
import { detectNaturalAdminAction } from './telegramAiAdminLanguage';
import { getConversationIntent, buildConversationTableReply, isSimpleConversationClubAssignmentRequest, isSimpleConversationMatchdayRequest } from './telegramAiConversationCommands';
import { sendTelegramMessage } from './telegramBotService';

export interface TelegramAiMessagePayload {
  updateId: number;
  messageId: number;
  chatId: number;
  threadId: number;
  fromUser: {
    id: number;
    username?: string;
    first_name?: string;
    is_bot?: boolean;
  };
  text: string;
  senderChat?: boolean;
  forwarded?: boolean;
  replyToMessage?: {
    message_id: number;
    from?: {
      id: number;
      is_bot?: boolean;
      username?: string;
    };
    text?: string;
  };
}

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
  selectedClubIds?: string[];
  selectedCompetitionIds?: string[]; selectedFixtureIds?:string[];
}

export type DeliveryClaimResult = 'ok' | 'already_handled' | 'redis_error';

const GLOBAL_TIMEOUT_MS = 6000;
const MAX_CONTEXT_TURNS = 4;
const CONTEXT_TTL_SECONDS = 3600; // Sliding one-hour TTL; scoped to user/chat/topic
const MAX_RESPONSE_CHARS = 1000;
const STANDARD_OFF_TOPIC_REPLY = "Men faqat eFootball va EFL UZ bo‘yicha yordam beraman.";

// Extracts the Telegram Bot User ID from the configured token (<bot_id>:<token_secret>)
export function getConfiguredBotUserId(): number | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  const prefix = token.split(':')[0];
  const id = parseInt(prefix, 10);
  return Number.isSafeInteger(id) ? id : null;
}

// Test mock hook for isolated offline tests
export type TestAiResponder = (text: string, grounding: string, history?: ConversationTurn[]) => Promise<string>;
let testAiResponder: TestAiResponder | null = null;
let testRedisOutage = false;
let lastModelCallHistory: ConversationTurn[] | null = null;

export function setTestAiResponder(responder: TestAiResponder | null): void {
  testAiResponder = responder;
}

export function setTestRedisOutage(outage: boolean): void {
  testRedisOutage = outage;
}

export function getLastModelCallHistory(): ConversationTurn[] | null {
  return lastModelCallHistory;
}

// In-memory test store for delivery & context
const testDeliveryStore = new Map<number, string>();
const testContextStore = new Map<string, { turns: ConversationTurn[]; expiresAt: number }>();
const testBotMessageStore = new Map<number, { chatId: number; threadId: number; userId: number; expiresAt: number }>();

export function clearTestAiState(): void {
  testDeliveryStore.clear();
  testContextStore.clear();
  testBotMessageStore.clear();
  testAiResponder = null;
  testRedisOutage = false;
  lastModelCallHistory = null;
}

/**
 * Escapes characters for HTML parse mode in Telegram
 */
export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Checks and transitions delivery state in Redis to prevent duplicate sends on retries.
 * States:
 * - 'pending' -> Initial state when update arrives
 * - 'sending' -> Atomic claim BEFORE calling Telegram sendMessage
 * - 'sent'    -> Telegram acknowledged message
 * - 'unknown_timeout' -> Delivery uncertain / timeout; DO NOT auto-retry
 * - 'failed'  -> Terminal failure
 *
 * FAILS CLOSED on Redis error: returns 'redis_error' so callers refuse to send.
 */
export async function claimDeliveryState(
  updateId: number,
  targetState: 'pending' | 'sending' | 'sent' | 'unknown_timeout' | 'failed',
  options?: { signal?: AbortSignal }
): Promise<DeliveryClaimResult> {
  if (testRedisOutage || options?.signal?.aborted) {
    return 'redis_error';
  }

  const client = getAiRedisClient(options?.signal);
  if (!client) {
    if (process.env.NODE_ENV !== 'test') return 'redis_error';
    const existing = testDeliveryStore.get(updateId);
    if (targetState === 'pending') {
      if (existing === 'sending' || existing === 'sent' || existing === 'unknown_timeout') {
        return 'already_handled';
      }
      testDeliveryStore.set(updateId, 'pending');
      return 'ok';
    }
    if (targetState === 'sending') {
      if (existing === 'sending' || existing === 'sent' || existing === 'unknown_timeout') {
        return 'already_handled';
      }
      testDeliveryStore.set(updateId, 'sending');
      return 'ok';
    }
    testDeliveryStore.set(updateId, targetState);
    return 'ok';
  }

  const key = `${KEY_PREFIX}:telegram:ai:delivery:${updateId}`;
  try {
    if (options?.signal?.aborted) return 'redis_error';

    if (targetState === 'pending') {
      const setNx = await client.set(key, 'pending', { nx: true, ex: 86400 });
      if (!setNx) {
        const val = await client.get<string>(key);
        if (val === 'sending' || val === 'sent' || val === 'unknown_timeout') {
          return 'already_handled';
        }
      }
      return 'ok';
    }

    if (targetState === 'sending') {
      // Atomic transition to 'sending': only allowed if not already sending/sent/timeout
      const res = await client.eval(`
        local cur = redis.call('GET', KEYS[1])
        if cur == 'sending' or cur == 'sent' or cur == 'unknown_timeout' then
          return 0
        end
        redis.call('SET', KEYS[1], 'sending', 'EX', 86400)
        return 1
      `, [key], []);
      return res === 1 ? 'ok' : 'already_handled';
    }

    // Terminal states: 'sent', 'unknown_timeout', 'failed'
    await client.set(key, targetState, { ex: 86400 });
    return 'ok';
  } catch (err: any) {
    console.warn('[AI DELIVERY STATE] Redis error during delivery claim:', err?.message || err);
    return 'redis_error';
  }
}

/**
 * Indexes a message sent by the bot to trace reply continuity strictly to the target user in specific chat & thread.
 */
export async function indexBotSentMessage(
  messageId: number,
  chatId: number,
  threadId: number,
  targetUserId: number,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const client = getAiRedisClient(options?.signal);
  const key = `${KEY_PREFIX}:telegram:ai:botmsg:${chatId}:${threadId}:${messageId}`;
  const payload = JSON.stringify({ chatId, threadId, userId: targetUserId });

  if (!client) {
    testBotMessageStore.set(messageId, {
      chatId,
      threadId,
      userId: targetUserId,
      expiresAt: Date.now() + CONTEXT_TTL_SECONDS * 1000,
    });
    return;
  }

  try {
    if (options?.signal?.aborted) return;
    await client.set(key, payload, { ex: CONTEXT_TTL_SECONDS });
  } catch (err: any) {
    console.warn('[AI BOT MSG INDEX] Failed to index bot message ID:', err?.message || err);
  }
}

/**
 * Checks whether a reply was targeted specifically to our bot and originated
 * from a message previously addressed to this exact user in this exact chat & thread.
 * Returns false if index is absent, expired, or if Redis encounters an error.
 */
export async function isReplyToOurBotForUser(
  replyToMessage: TelegramAiMessagePayload['replyToMessage'],
  currentChatId: number,
  currentThreadId: number,
  currentUserId: number,
  options?: { signal?: AbortSignal }
): Promise<boolean> {
  if (!replyToMessage) return false;
  if (options?.signal?.aborted) return false;

  const botUserId = getConfiguredBotUserId();
  const repliedUser = replyToMessage.from;

  // 1. Must be strictly from our bot ID
  if (botUserId === null) return false;
  if (!repliedUser?.is_bot || Number(repliedUser.id) !== Number(botUserId)) {
    return false;
  }

  if (testRedisOutage) {
    return false;
  }

  // 2. Check if the message ID was indexed for this chat, thread, and user
  const client = getAiRedisClient(options?.signal);
  const msgKey = `${KEY_PREFIX}:telegram:ai:botmsg:${currentChatId}:${currentThreadId}:${replyToMessage.message_id}`;

  if (!client) {
    const record = testBotMessageStore.get(replyToMessage.message_id);
    if (!record || record.expiresAt <= Date.now()) {
      return false;
    }
    return (
      Number(record.chatId) === Number(currentChatId) &&
      Number(record.threadId) === Number(currentThreadId) &&
      Number(record.userId) === Number(currentUserId)
    );
  }

  try {
    if (options?.signal?.aborted) return false;
    const raw = await client.get<string | { chatId: number; threadId: number; userId: number }>(msgKey);
    if (!raw) {
      return false; // Indeks yo'q bo'lsa false qaytaring
    }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }
    return (
      Number(parsed.chatId) === Number(currentChatId) &&
      Number(parsed.threadId) === Number(currentThreadId) &&
      Number(parsed.userId) === Number(currentUserId)
    );
  } catch (err: any) {
    console.warn('[AI BOT MSG INDEX] Redis error verifying bot reply index:', err?.message || err);
    return false; // Redis xato bo'lsa false qaytaring!
  }
}

/**
 * Reads conversation context from Redis
 */
async function getConversationContext(
  chatId: number,
  threadId: number,
  userId: number,
  options?: { signal?: AbortSignal }
): Promise<ConversationTurn[]> {
  if (testRedisOutage || options?.signal?.aborted) return [];

  const client = getAiRedisClient(options?.signal);
  const contextKey = `${KEY_PREFIX}:telegram:ai:context:${chatId}:${threadId}:${userId}`;

  if (!client) {
    const record = testContextStore.get(contextKey);
    if (!record || record.expiresAt <= Date.now()) return [];
    return record.turns;
  }

  try {
    if (options?.signal?.aborted) return [];
    const raw = await client.get<string | any[]>(contextKey);
    if (!raw) return [];
    const parsed: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: any): ConversationTurn => ({
      role: item?.role === 'model' ? 'model' : 'user',
      text: String(item?.text || ''),
      selectedClubIds: Array.isArray(item?.selectedClubIds) ? item.selectedClubIds.filter((id: unknown) => typeof id === 'string').slice(0, 4) : undefined,
      selectedFixtureIds:Array.isArray(item?.selectedFixtureIds)?item.selectedFixtureIds.filter((id:unknown)=>typeof id==='string').slice(0,2):undefined,
      selectedCompetitionIds: Array.isArray(item?.selectedCompetitionIds) ? item.selectedCompetitionIds.filter((id: unknown) => typeof id === 'string').slice(0, 5) : undefined,
    })).slice(-MAX_CONTEXT_TURNS);
  } catch {
    return [];
  }
}

/**
 * Appends bounded conversation turns; selected club IDs survive history trimming
 */
async function saveConversationContext(
  chatId: number,
  threadId: number,
  userId: number,
  userText: string,
  modelText: string,
  options?: { signal?: AbortSignal; history?: ConversationTurn[]; selectedClubIds?: string[]; selectedCompetitionIds?: string[]; selectedFixtureIds?:string[] }
): Promise<void> {
  if (testRedisOutage || options?.signal?.aborted) return;

  const client = getAiRedisClient(options?.signal);
  const contextKey = `${KEY_PREFIX}:telegram:ai:context:${chatId}:${threadId}:${userId}`;

  const existing = options?.history || [];
  const updated: ConversationTurn[] = [
    ...existing,
    { role: 'user' as const, text: userText.slice(0, 700), selectedClubIds: options?.selectedClubIds || [], selectedFixtureIds:options?.selectedFixtureIds||[], selectedCompetitionIds: options?.selectedCompetitionIds || [] },
    { role: 'model' as const, text: modelText.slice(0, 500) },
  ].slice(-MAX_CONTEXT_TURNS);

  if (!client) {
    testContextStore.set(contextKey, {
      turns: updated,
      expiresAt: Date.now() + CONTEXT_TTL_SECONDS * 1000,
    });
    return;
  }

  try {
    if (options?.signal?.aborted) return;
    await client.set(contextKey, JSON.stringify(updated), { ex: CONTEXT_TTL_SECONDS });
  } catch (err: any) {
    console.warn('[AI CONTEXT] Error saving context to Redis:', err?.message || err);
  }
}

/**
 * Simple heuristic to detect if query is blatantly off-topic before calling Gemini
 */
export function isBlatantlyOffTopic(text: string): boolean {
  const lower = text.toLowerCase();
  const offTopicKeywords = [
    'ob-havo', 'ob havo', 'dollar kursi', 'valyuta', 'retsept', 'ovqat',
    'python kod', 'javascript yozib ber', 'fizika', 'matematika masala',
    'siyosat', 'prezident', 'urush', 'film tavsiya', 'kino', 'musiqa'
  ];
  return offTopicKeywords.some((k) => lower.includes(k));
}

/**
 * Unified Dispatcher: All replies (cooldown warning, off-topic standard refusal, and AI answers)
 * are routed through this single function.
 *
 * Guarantees:
 * 1. Pre-send re-check: enabled, redisAvailable, chatId, threadId
 * 2. Atomic claim transition to 'sending' before calling Telegram.
 *    If claim returns 'already_handled' OR 'redis_error' (outage), fails closed: DOES NOT SEND.
 * 3. Sends message with exact parse_mode (or null for plain text)
 * 4. On send success: claims 'sent' and indexes bot message ID.
 * 5. On send failure/timeout: marks 'unknown_timeout' to prevent duplicate retry spam.
 */
async function dispatchTelegramAiReply(
  payload: TelegramAiMessagePayload,
  replyText: string,
  signal: AbortSignal,
  options: {
    parse_mode?: string | null;
    reply_markup?: any;
    maxChars?: number;
  } = {}
): Promise<{ ok: boolean; replySent: boolean; ignored?: string; error?: string; botMessageId?: number }> {
  // 1. Deadline check
  if (signal.aborted) {
    console.warn('[AI DISPATCH] Request timed out before message dispatch');
    await claimDeliveryState(payload.updateId, 'unknown_timeout', { signal });
    return { ok: false, replySent: false, ignored: 'TIMEOUT_ABORTED' };
  }

  // 2. Pre-send re-check (Requirement 3): enabled, redisAvailable, chatId, threadId
  const { config: freshConfig, redisAvailable: freshRedis } = await getTelegramAiConfig({ signal });
  if (
    !freshConfig.enabled ||
    (process.env.NODE_ENV === 'production' && !freshRedis) ||
    freshConfig.allowedChatId === null ||
    freshConfig.allowedThreadId === null ||
    (Number(freshConfig.allowedChatId) !== Number(payload.chatId) || Number(freshConfig.allowedThreadId) !== Number(payload.threadId)) && !(isOwnerAdminPrivateChat(payload))
  ) {
    console.warn('[AI DISPATCH] Pre-send re-check failed; aborting send to Telegram');
    await claimDeliveryState(payload.updateId, 'sent', { signal });
    return { ok: false, replySent: false, ignored: 'disabled_or_unauthorized_pre_send' };
  }

  // 3. Pre-dispatch atomic transition to 'sending' (Requirement 1: fail-closed on Redis error)
  const sendClaim = await claimDeliveryState(payload.updateId, 'sending', { signal });
  if (sendClaim !== 'ok') {
    console.warn(`[AI DISPATCH] Pre-dispatch claim was '${sendClaim}', failing closed (not sending)`);
    return {
      ok: false,
      replySent: false,
      ignored: sendClaim === 'already_handled' ? 'already_sending_or_sent' : 'delivery_claim_redis_error_fail_closed',
    };
  }

  // 4. Format message text
  const parseMode = options.parse_mode !== undefined ? options.parse_mode : 'HTML';
  const maxChars = Math.min(options.maxChars || MAX_RESPONSE_CHARS, 4000);
  const textToSend = parseMode === 'HTML'
    ? await decorateAiCustomEmoji(escapeTelegramHtml(replyText.slice(0, maxChars)), signal)
    : replyText.slice(0, maxChars);

  // 5. Dispatch message to Telegram
  const sendResult = await sendTelegramMessage(payload.chatId, textToSend, {
    parse_mode: parseMode,
    message_thread_id: payload.threadId,
    reply_to_message_id: payload.messageId,
    reply_markup: options.reply_markup,
    signal,
  });

  if (sendResult.ok) {
    await claimDeliveryState(payload.updateId, 'sent', { signal });
    const botMsgId = sendResult.result?.message_id;
    if (Number.isSafeInteger(botMsgId)) {
      await indexBotSentMessage(botMsgId, payload.chatId, payload.threadId, payload.fromUser.id, { signal });
    }
    return { ok: true, replySent: true, botMessageId: botMsgId };
  } else {
    console.warn('[AI DISPATCH] Telegram send failed/uncertain:', sendResult.error);
    await claimDeliveryState(payload.updateId, 'unknown_timeout', { signal });
    return { ok: false, replySent: false, error: sendResult.error };
  }
}

/**
 * Main AI Message Handler
 */
export async function handleTelegramAiMessage(
  payload: TelegramAiMessagePayload
): Promise<{ ok: boolean; handled: boolean; replySent?: boolean; error?: string; ignored?: string }> {
  // 1. Basic filter: ignore bot messages, empty text, or invalid IDs
  if (payload.fromUser.is_bot || !payload.text?.trim()) {
    return { ok: true, handled: false, ignored: 'bot_or_empty' };
  }

  // 2. Start unified 6-second processing timeout BEFORE reading configuration (Requirement 2)
  let intent = getConversationIntent(payload.text);
  const owner = isAiAdminActor(payload.fromUser.id);
  const replyConfirmation = Boolean(payload.replyToMessage && /^(?:ha|xa|yes|xop)$/i.test(payload.text.trim()));
  let ownerControl = owner && (isAiAdminCommand(payload.text) || ['admin','confirm','cancel','help'].includes(intent) || replyConfirmation);
  const rootController = new AbortController();
  const deadlineAt = Date.now() + (owner ? 30000 : GLOBAL_TIMEOUT_MS);
  const globalTimeout = setTimeout(() => rootController.abort(), owner ? 30000 : GLOBAL_TIMEOUT_MS);

  try {
    // 3. Load configuration under deadline with fail-closed guarantee
    const { config, redisAvailable } = await getTelegramAiConfig({ signal: rootController.signal });
    if (!config.enabled) {
      return { ok: true, handled: false, ignored: 'ai_disabled' };
    }
    if (!redisAvailable && process.env.NODE_ENV === 'production') {
      return { ok: true, handled: false, ignored: 'redis_unavailable_prod' };
    }

    console.info('[TELEGRAM_AI_SCOPE]', JSON.stringify({ chatId: payload.chatId, threadId: payload.threadId, allowedChatId: config.allowedChatId, allowedThreadId: config.allowedThreadId, enabled: config.enabled }));
    // 4. Strict Boundary Validation: Chat ID and Thread ID must match configured allowed topic
    if (
      config.allowedChatId === null ||
      config.allowedThreadId === null ||
      (Number(payload.chatId) !== Number(config.allowedChatId) || Number(payload.threadId) !== Number(config.allowedThreadId)) && !(isOwnerAdminPrivateChat(payload))
    ) {
      return { ok: true, handled: false, ignored: 'topic_not_authorized' };
    }

    if (owner && intent === 'chat' && await getDeliveredAiAdminDraft(payload, rootController.signal)) {
      intent = 'admin'; ownerControl = true;
    }
    // 5. Initial delivery check: prevent duplicate processing on webhook retry
    const initDelivery = await claimDeliveryState(payload.updateId, 'pending', { signal: rootController.signal });
    if (initDelivery !== 'ok') {
      return {
        ok: true,
        handled: false,
        ignored: initDelivery === 'already_handled' ? 'already_delivered' : 'delivery_claim_redis_error_fail_closed',
      };
    }

    // 6. Multi-tier atomic rate limiting (Daily -> Topic -> User in ONE atomic Redis operation)
    const rateLimit = await checkAndIncrementAiRateLimits({
      chatId: payload.chatId,
      threadId: payload.threadId,
      userId: payload.fromUser.id,
      userLimitPerMin: ownerControl ? 20 : config.rateLimitUserPerMin,
      topicLimitPerMin: ownerControl ? 20 : config.rateLimitTopicPerMin,
      control: ownerControl,
      countDaily: ownerControl ? /^\/ai_admin(?:@[a-zA-Z0-9_]+)?\s+(?!\{)/i.test(payload.text) && !(isSimpleConversationMatchdayRequest(payload.text) || isSimpleConversationClubAssignmentRequest(payload.text) || detectNaturalAdminAction(payload.text)) || /^\/ai_read(?:@[a-zA-Z0-9_]+)?\s+(?!\{)/i.test(payload.text) && !detectNaturalAdminAction(payload.text) || intent === 'admin' && !(isSimpleConversationMatchdayRequest(payload.text) || isSimpleConversationClubAssignmentRequest(payload.text) || detectNaturalAdminAction(payload.text)) : intent === 'chat' && !isPersonalFixtureQuestion(payload.text) && !replyConfirmation && !/^\//.test(payload.text),
      maxDailyRequests: config.maxDailyRequests,
      signal: rootController.signal,
    });

    if (!rateLimit.allowed) {
      if (rateLimit.shouldNotifyUser) {
        // Cooldown warning dispatched via unified dispatch path
        await dispatchTelegramAiReply(
          payload,
          rateLimit.reason === 'DAILY_LIMIT_EXCEEDED' ? 'AI’ning bugungi so‘rov limiti tugagan. Bazadagi jadval va o‘yinlarni oddiy so‘rov bilan ko‘rish mumkin.' : rateLimit.reason === 'TOPIC_LIMIT_EXCEEDED' ? 'Bu mavzuda so‘rovlar ko‘payib ketdi. Bir daqiqadan keyin qayta yozing.' : `Bir daqiqada ${rateLimit.limit} ta so‘rov mumkin. Biroz kutib qayta yozing.`,
          rootController.signal,
          { parse_mode: null }
        );
      } else {
        await claimDeliveryState(payload.updateId, 'sent', { signal: rootController.signal });
      }
      return { ok: true, handled: true, ignored: rateLimit.reason };
    }

    // 9. Reply Context: verify reply is addressed specifically to our bot and belongs to this user & chat & thread
    let history: ConversationTurn[] = payload.replyToMessage ? [] : await getConversationContext(
      payload.chatId, payload.threadId, payload.fromUser.id, { signal: rootController.signal }
    );
    if (payload.replyToMessage) {
      const isOurReply = await isReplyToOurBotForUser(
        payload.replyToMessage,
        payload.chatId,
        payload.threadId,
        payload.fromUser.id,
        { signal: rootController.signal }
      );
      if (isOurReply) {
        history = await getConversationContext(payload.chatId, payload.threadId, payload.fromUser.id, {
          signal: rootController.signal,
        });
      }
    }

    const scope = {
      previousUserQueries: history.filter(turn => turn.role === 'user').map(turn => turn.text),
      selectedClubIds: [...history].reverse().find(turn => turn.role === 'user' && turn.selectedClubIds !== undefined)?.selectedClubIds,
      selectedFixtureIds:[...history].reverse().find(turn=>turn.role==='user'&&turn.selectedFixtureIds!==undefined)?.selectedFixtureIds,
      selectedCompetitionIds: [...history].reverse().find(turn => turn.role === 'user' && turn.selectedCompetitionIds !== undefined)?.selectedCompetitionIds,
    };
    if (isPersonalFixtureQuestion(payload.text) && !['admin','confirm','cancel','help'].includes(intent)) {
      const personal = payload.senderChat || payload.forwarded
        ? {text:'Raqibingizni aniqlash uchun shaxsiy Telegram akkauntingizdan o‘zingiz yozing.',clubIds:[]}
        : await buildPersonalFixtureReply(payload.text,payload.fromUser.id,rootController.signal);
      const result = await dispatchTelegramAiReply(payload,personal.text,rootController.signal,{parse_mode:null});
      if(result.replySent) await saveConversationContext(payload.chatId,payload.threadId,payload.fromUser.id,payload.text,personal.text,{signal:rootController.signal,history,selectedClubIds:personal.clubIds,selectedFixtureIds:'fixtureIds' in personal?personal.fixtureIds:[]});
      return {ok:result.ok,handled:true,replySent:result.replySent,ignored:result.ignored};
    }
    if (intent === 'standings' || intent === 'fixtures') {
      const table = await buildConversationTableReply(payload.text, intent, scope, rootController.signal);
      const result = await dispatchTelegramAiReply(payload, table.text, rootController.signal, { parse_mode: null, maxChars: 4000 });
      if (result.replySent) await saveConversationContext(payload.chatId, payload.threadId, payload.fromUser.id, payload.text, table.text, { signal: rootController.signal, history, selectedClubIds: table.clubIds||[], selectedCompetitionIds: table.competitionIds, selectedFixtureIds:table.fixtureIds });
      return { ok: result.ok, handled: true, replySent: result.replySent, ignored: result.ignored };
    }
    if (isAiAdminCommand(payload.text) || ['admin','confirm','cancel'].includes(intent) || replyConfirmation || intent === 'help' && owner) {
      const text = await handleAiAdminCommand(payload, rootController.signal, JSON.stringify(scope), scope);
      const token = /\/ai_confirm ([a-f0-9]{24})/.exec(text)?.[1];
      const visible = token ? text.replace(/\n\/ai_(?:confirm|cancel) [a-f0-9]{24}/g, '') + '\n“Tasdiqlash” tugmasini bosing yoki “tasdiqlayman” deb yozing.' : text;
      const result = await dispatchTelegramAiReply(payload, visible, rootController.signal, { parse_mode: null, reply_markup: token ? { inline_keyboard: [[{ text: 'Tasdiqlash', callback_data: 'ai:confirm:' + token }, { text: 'Bekor qilish', callback_data: 'ai:cancel:' + token }]] } : undefined });
      if (result.replySent && token && result.botMessageId) await rememberDeliveredAdminPlan(payload, text, result.botMessageId, rootController.signal);
      if (result.replySent && !token && result.botMessageId && owner) await rememberDeliveredAiAdminDraft(payload, text, result.botMessageId, rootController.signal);
      if (result.replySent && intent === 'admin') await saveConversationContext(payload.chatId, payload.threadId, payload.fromUser.id, payload.text, visible, { signal: rootController.signal, history, selectedClubIds: scope.selectedClubIds, selectedCompetitionIds: scope.selectedCompetitionIds });
      return { ok: result.ok, handled: true, replySent: result.replySent, ignored: result.ignored };
    }
    if (intent === 'help' || /^\/[a-z_]+/i.test(payload.text)) {
      const text = 'Jadval uchun “La Liga jadvalini tashla”, o‘yinlar uchun “Angliya Kubogi yarim final o‘yinlarini ko‘rsat” deb yozing. Liga haqida gaplashgan bo‘lsak, “jadval tashla” ham yetadi.';
      const result = await dispatchTelegramAiReply(payload, text, rootController.signal, { parse_mode: null });
      return { ok: result.ok, handled: true, replySent: result.replySent };
    }

    // 7. Check blatant off-topic before calling Gemini to save quota
    if (isBlatantlyOffTopic(payload.text)) {
      // Off-topic refusal dispatched via unified dispatch path with parse_mode: null
      const dispatchRes = await dispatchTelegramAiReply(
        payload,
        STANDARD_OFF_TOPIC_REPLY,
        rootController.signal,
        { parse_mode: null }
      );
      return { ok: true, handled: true, replySent: dispatchRes.replySent, ignored: dispatchRes.ignored };
    }

    if (rootController.signal.aborted) throw new Error('TIMEOUT_ABORTED');

    const speaker = resolveAiSpeaker(payload);
    const social = aiSocialReply(payload.text, speaker, payload.messageId);
    if (social) {
      const result = await dispatchTelegramAiReply(payload, social, rootController.signal, { parse_mode: 'HTML' });
      if (result.replySent) await saveConversationContext(payload.chatId, payload.threadId, payload.fromUser.id, payload.text, social, { signal: rootController.signal, history });
      return { ok: result.ok, handled: true, replySent: result.replySent, ignored: result.ignored };
    }
    const grounding = await buildAiGroundingContext(payload.text, undefined, {
      signal: rootController.signal,
      replyVariation: payload.messageId,
      previousUserQueries: history.filter(turn => turn.role === 'user').map(turn => turn.text),
      selectedClubIds: [...history].reverse().find(turn => turn.role === 'user' && turn.selectedClubIds !== undefined)?.selectedClubIds,
    });

    // Save history capture for test verification
    lastModelCallHistory = history;

    // 10. Generate response via Gemini (or Test Mock)
    let replyText = '';
    const modelController = new AbortController();
    const modelTimeout = setTimeout(() => modelController.abort(), Math.max(0, deadlineAt - Date.now() - 1800));
    const modelSignal = AbortSignal.any([rootController.signal, modelController.signal]);

    try {
    if (grounding.factualAnswer) {
      replyText = addressAiFact(grounding.factualAnswer, speaker, payload.messageId, history.filter(h => h.role === 'model').map(h => h.text));
    } else if (testAiResponder) {
      replyText = await withinAiDeadline(modelSignal, () => testAiResponder!(payload.text, grounding.factsSummary, history));
    } else {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        console.error('[AI GEMINI] Missing API configuration; using local reply');
        replyText = buildAiFallbackReply(payload.text, grounding);
      } else {
        const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
        const ai = new GoogleGenAI({ apiKey });

        const systemPrompt = buildTelegramAiSystemPrompt(grounding.factsSummary, speaker);

        const contents = [
          ...history.map((h) => ({
            role: h.role,
            parts: [{ text: h.text }],
          })),
          { role: 'user', parts: [{ text: payload.text.slice(0, 700) }] },
        ];

        try {
          replyText = await generateGroundedTelegramAnswer({ ai, model: modelName, contents, systemPrompt, signal: modelSignal, deadlineAt: deadlineAt - 1800 });
        } catch (apiErr: any) {
          const errMsg = String(apiErr?.message || '');
          if (rootController.signal.aborted) {
            console.warn('[AI GEMINI] Gemini call cancelled due to deadline timeout');
            await claimDeliveryState(payload.updateId, 'unknown_timeout', { signal: rootController.signal });
            return { ok: false, handled: false, error: 'TIMEOUT_ABORTED' };
          }
          console.error('[AI GEMINI]', aiProviderFailureKind(apiErr), 'Error calling Gemini:', errMsg);
          replyText = buildAiFallbackReply(payload.text, grounding);
        }
      }
    }
    } catch (error) {
      if (rootController.signal.aborted) throw error;
      console.warn('[AI LOCAL_REPLY] Generation failed or exceeded model budget');
      replyText = buildAiFallbackReply(payload.text, grounding);
    } finally {
      clearTimeout(modelTimeout);
    }

    if (!replyText?.trim()) {
      replyText = AI_CLARIFICATION_REPLY;
    }

    // 11. Dispatch AI response via unified dispatch path
    const dispatchRes = await dispatchTelegramAiReply(
      payload,
      replyText,
      rootController.signal,
      { parse_mode: 'HTML' }
    );

    if (dispatchRes.replySent) {
      // Save context for future turns
      await saveConversationContext(
        payload.chatId,
        payload.threadId,
        payload.fromUser.id,
        payload.text,
        replyText,
        { signal: rootController.signal, history, selectedClubIds: grounding.selectedClubIds, selectedCompetitionIds: grounding.detectedCompetitions }
      );
      return { ok: true, handled: true, replySent: true };
    } else {
      return {
        ok: dispatchRes.ok,
        handled: dispatchRes.ok || false,
        replySent: false,
        ignored: dispatchRes.ignored,
        error: dispatchRes.error,
      };
    }
  } catch (err: any) {
    console.error('[AI HANDLER ERROR]', err?.message || err);
    await claimDeliveryState(payload.updateId, 'unknown_timeout', { signal: rootController.signal });
    return { ok: false, handled: false, error: err?.message || 'UNKNOWN_ERROR' };
  } finally {
    clearTimeout(globalTimeout);
  }
}
