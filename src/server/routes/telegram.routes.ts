import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import {
  handleTelegramStart,
  verifyTelegramGroupMembership,
  TelegramMembershipResult,
  sendTelegramMessage,
  answerTelegramCallback,
  inspectTelegramConnection,
} from '../services/telegramBotService';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';
import {
  PREMIUM_DEFAULT_SEASON_ID,
  PREMIUM_PRICE_STARS,
  answerPremiumPreCheckout,
  createPremiumStarsInvoice,
  getPremiumCareerSnapshot,
  getPremiumEntitlement,
  grantPremiumEntitlement,
  handlePremiumSuccessfulPayment,
  isPremiumPublicEnabled,
  listPremiumEntitlements,
  revokePremiumEntitlement,
} from '../services/premiumService';
import {
  PRIMARY_OWNER_TELEGRAM_ID,
  isPrimaryOwner,
  getTelegramAiConfig,
  bindTelegramAiTopic,
} from '../services/telegramAiConfigService';
import { getAiRateLimitMetrics } from '../services/telegramAiRateLimitService';
import { handleTelegramAiMessage } from '../services/telegramAiService';
import { isAiAdminCommand } from '../services/telegramAiAdminCatalog';
import { archiveCommunityMessage } from '../services/telegramAiCommunitySources';

export const telegramRouter = Router();
// A processing lease is separate from acknowledgement: failed work remains retryable.
const recentWebhookUpdates = new Map<number, { value: string; expiresAt: number }>();
const WEBHOOK_LEASE_SECONDS = 120;
const WEBHOOK_DONE_SECONDS = 86400;

async function claimTelegramUpdate(updateId: number, owner: string): Promise<'claimed' | 'done' | 'busy'> {
  const client = getUpstashClient();
  const key = `${KEY_PREFIX}:telegram:webhook-update:${updateId}`;
  if (client) {
    if (await client.set(key, owner, { nx: true, ex: WEBHOOK_LEASE_SECONDS })) return 'claimed';
    const value = await client.get<string>(key);
    // '1' is the completed marker used by the previous implementation.
    return value === 'done' || value === '1' ? 'done' : 'busy';
  }
  const now = Date.now();
  for (const [id, record] of recentWebhookUpdates) if (record.expiresAt <= now) recentWebhookUpdates.delete(id);
  const record = recentWebhookUpdates.get(updateId);
  if (record) return record.value === 'done' ? 'done' : 'busy';
  recentWebhookUpdates.set(updateId, { value: owner, expiresAt: now + WEBHOOK_LEASE_SECONDS * 1000 });
  return 'claimed';
}

async function settleTelegramUpdate(updateId: number, owner: string, completed: boolean): Promise<void> {
  const client = getUpstashClient();
  if (client) {
    // Ownership checks stop an expired worker from completing/releasing a newer lease.
    await client.eval(`
      if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
      if ARGV[2] == 'done' then
        return redis.call('SET', KEYS[1], 'done', 'EX', ARGV[3])
      end
      return redis.call('DEL', KEYS[1])
    `, [`${KEY_PREFIX}:telegram:webhook-update:${updateId}`], [owner, completed ? 'done' : 'release', WEBHOOK_DONE_SECONDS]);
    return;
  }
  if (recentWebhookUpdates.get(updateId)?.value !== owner) return;
  if (completed) recentWebhookUpdates.set(updateId, { value: 'done', expiresAt: Date.now() + WEBHOOK_DONE_SECONDS * 1000 });
  else recentWebhookUpdates.delete(updateId);
}

function normalizedSeasonId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : PREMIUM_DEFAULT_SEASON_ID;
}

/**
 * Telegram Webhook Handler
 * Telegram sends JSON updates to this endpoint.
 */
telegramRouter.post('/webhook', async (req: Request, res: Response) => {
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret) {
    res.status(503).json({ error: 'Webhook is not configured' });
    return;
  }
  if (secretToken !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized webhook secret token' });
    return;
  }

  const update = req.body;
  if (!update || typeof update !== 'object') {
    res.status(200).json({ ok: true, ignored: 'empty_update' });
    return;
  }
  if (!Number.isSafeInteger(update.update_id)) {
    res.status(200).json({ ok: true, ignored: 'invalid_update_id' });
    return;
  }
  const owner = randomUUID();
  let claimed = false;
  try {
    const claim = await claimTelegramUpdate(update.update_id, owner);
    if (claim === 'done') {
      res.status(200).json({ ok: true, ignored: 'duplicate_update' });
      return;
    }
    if (claim === 'busy') {
      res.status(503).json({ ok: false, error: 'update_in_progress' });
      return;
    }
    claimed = true;
    const sourceMessage = update.channel_post || update.edited_channel_post || update.edited_message || update.message;
    if (sourceMessage) {
      try { await archiveCommunityMessage(sourceMessage); }
      catch { console.warn('[AI_COMMUNITY_ARCHIVE_UNAVAILABLE]'); }
    }
    console.info('[TELEGRAM_UPDATE_RECEIVED]', JSON.stringify({ updateId: update.update_id, kind: update.callback_query ? 'callback' : update.message ? 'message' : Object.keys(update).filter(key => key !== 'update_id').join(','), chatId: update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? null, threadId: update.message?.message_thread_id ?? update.callback_query?.message?.message_thread_id ?? null, hasText: typeof update.message?.text === 'string', command: /^\/([a-z_]+)/i.exec(update.message?.text || '')?.[1] || null, anonymous: Boolean(update.message?.sender_chat) }));
    let response: Record<string, unknown> = { ok: true, ignored: 'unhandled_update_type' };
    if (typeof update.callback_query?.data === 'string' && /^ai:(confirm|cancel):[a-f0-9]{24}$/.test(update.callback_query.data)) {
      const callback = update.callback_query;
      const message = callback.message;
      if (!message || !Number.isSafeInteger(message.chat?.id) || !Number.isSafeInteger(callback.from?.id)) {
        response = { ok: true, ignored: 'invalid_ai_callback' };
      } else {
        const [, command, token] = callback.data.split(':');
        const result = await handleTelegramAiMessage({
          updateId: update.update_id, messageId: message.message_id,
          chatId: message.chat.id, threadId: message.message_thread_id || 0,
          fromUser: callback.from, text: `/ai_${command} ${token}`,
        });
        await answerTelegramCallback(callback.id, isPrimaryOwner(callback.from.id) ? result.replySent ? 'Javob yuborildi' : 'Buyruq bajarilishi tasdiqlanmadi. Bot holatini tekshiring.' : 'Bu tugma faqat asosiy admin uchun.', !isPrimaryOwner(callback.from.id));
        console.info('[TELEGRAM_AI_OUTCOME]', JSON.stringify({ handled: result.handled, replySent: result.replySent, ignored: result.ignored, error: result.error }));
        response = { ok: true, handled: 'ai_admin_callback', result };
      }
    } else if (update.pre_checkout_query) {
      const result = await answerPremiumPreCheckout(update.pre_checkout_query);
      response = { ok: true, handled: 'premium_pre_checkout', result };
    } else {
      const message = update.message;
      if (message?.successful_payment) {
        const result = await handlePremiumSuccessfulPayment(message);
        // The transaction deduplicates by charge ID, including retries after a Redis outage.
        if (result?.handled && result?.userId && !result?.idempotent) {
          await sendTelegramMessage(
            message.chat?.id || message.from?.id,
            `<b>EFL UZ Premium faollashtirildi</b>\n\nMavsum: <b>${result.seasonId === 'season-2026-27' ? '2026/27' : result.seasonId}</b>\nTo‘lov: <b>${PREMIUM_PRICE_STARS} ⭐</b>\n\nMavsum uchun Premium imkoniyatlaringiz faollashdi.`,
            { parse_mode: 'HTML' }
          ).catch(() => undefined);
        }
        response = { ok: true, handled: 'premium_successful_payment', result };
      } else if (typeof message?.text === 'string' && Number.isSafeInteger(message.chat?.id) && Number.isSafeInteger(message.from?.id)) {
        const command = /^\/(start|help|paysupport|bind_ai_topic|ai_status)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/i.exec(message.text.trim())?.[1]?.toLowerCase();
        if (command === 'start') {
          const result = await handleTelegramStart(message.chat.id, message.from, { message_thread_id: message.message_thread_id, reply_to_message_id: message.message_id });
          if (!result.ok || !result.messageSent) throw new Error('START_MESSAGE_NOT_SENT: ' + (result.error || 'unknown')); 
          response = { ok: true, handled: 'start', result };
        } else if (command === 'help' || command === 'paysupport') {
          const group = (process.env.TELEGRAM_GROUP_USERNAME || '@efleagueuz').trim().replace(/^@/, '');
          const text = command === 'paysupport'
            ? 'Premium to‘lovi yoki faollashishi bilan muammo bo‘lsa, rasmiy guruhdagi administratorga murojaat qiling. To‘lov sanasi va Telegram to‘lov chekingizni yuboring. Parol va tasdiqlash kodlarini yubormang.'
            : 'EFL UZ’ni ochish uchun /start bosing. Ilovada klub tanlash, uchrashuvlar va turnir jadvalini ko‘rishingiz mumkin. Yordam uchun rasmiy guruhdagi administratorga murojaat qiling.';
          const result = await sendTelegramMessage(message.chat.id, text, {
            message_thread_id: message.message_thread_id,
            reply_to_message_id: message.message_id,
            reply_markup: { inline_keyboard: [[{ text: 'Administrator bilan bog‘lanish', url: `https://t.me/${group}` }]] },
          });
          if (!result.ok) throw new Error('SUPPORT_MESSAGE_NOT_SENT');
          response = { ok: true, handled: command };
        } else if (command === 'bind_ai_topic') {
          if (message.sender_chat || !isPrimaryOwner(message.from?.id)) {
            await sendTelegramMessage(message.chat.id, `Faqat asosiy admin (ID: ${PRIMARY_OWNER_TELEGRAM_ID}) bu buyruqni ishlatishi mumkin. Anonim admin rejimidan foydalanish taqiqlangan.`, {
              message_thread_id: message.message_thread_id,
              reply_to_message_id: message.message_id,
              parse_mode: null,
            }).catch(() => undefined);
            response = { ok: true, handled: 'bind_ai_topic', rejected: 'unauthorized_owner_only' };
          } else if (!message.message_thread_id) {
            await sendTelegramMessage(message.chat.id, "Ushbu buyruqni faqat guruhning AI yordamchi uchun mo'ljallangan mavzusi (forum topic) ichida yozish kerak.", {
              reply_to_message_id: message.message_id,
              parse_mode: null,
            }).catch(() => undefined);
            response = { ok: true, handled: 'bind_ai_topic', rejected: 'thread_id_missing' };
          } else {
            const bindResult = await bindTelegramAiTopic(message.chat.id, message.message_thread_id, message.from.id);
            if (!bindResult.success) {
              await sendTelegramMessage(message.chat.id, `Xatolik: mavzuni bog'lab bo'lmadi (${bindResult.error}). Redis xizmati ulanganligini tekshiring.`, {
                message_thread_id: message.message_thread_id,
                reply_to_message_id: message.message_id,
                parse_mode: null,
              }).catch(() => undefined);
              response = { ok: true, handled: 'bind_ai_topic', error: bindResult.error };
            } else {
              const replyMsg =
                `✅ <b>Mavzu muvaffaqiyatli bog'landi!</b>\n\n` +
                `• Chat ID: <code>${message.chat.id}</code>\n` +
                `• Topic/Thread ID: <code>${message.message_thread_id}</code>\n\n` +
                `<i>Eslatma: Xavfsizlik uchun AI dastlab o'chiq (OFF) holatda qoladi. Uni faollashtirish uchun veb Admin paneldagi Telegram AI bo'limidan 'Yoqish' tugmasini bosing.</i>`;
              await sendTelegramMessage(message.chat.id, replyMsg, {
                message_thread_id: message.message_thread_id,
                reply_to_message_id: message.message_id,
                parse_mode: 'HTML',
              });
              response = { ok: true, handled: 'bind_ai_topic', bound: true, config: bindResult.config };
            }
          }
        } else if (command === 'ai_status') {
          if (message.sender_chat || !isPrimaryOwner(message.from?.id)) {
            await sendTelegramMessage(message.chat.id, `Faqat asosiy admin (ID: ${PRIMARY_OWNER_TELEGRAM_ID}) bu buyruqni ishlatishi mumkin. Anonim admin rejimidan foydalanish taqiqlangan.`, {
              message_thread_id: message.message_thread_id,
              reply_to_message_id: message.message_id,
              parse_mode: null,
            }).catch(() => undefined);
            response = { ok: true, handled: 'ai_status', rejected: 'unauthorized_owner_only' };
          } else {
            const { config, redisAvailable } = await getTelegramAiConfig();
            const rateMetrics = await getAiRateLimitMetrics();
            const statusMsg =
              `🤖 <b>EFL UZ Telegram AI Holati:</b>\n\n` +
              `• AI Xizmati: <b>${config.enabled ? '🟢 FAOL (ON)' : "🔴 O'CHIQ (OFF)"}</b>\n` +
              `• Bog'langan Chat ID: <code>${config.allowedChatId ?? "Bog'lanmagan"}</code>\n` +
              `• Bog'langan Thread ID: <code>${config.allowedThreadId ?? "Bog'lanmagan"}</code>\n` +
              `• Redis Holati: <b>${redisAvailable ? 'Ulangan' : 'Uzilgan (Fail-Closed)'}</b>\n` +
              `• Bugungi so'rovlar: <code>${rateMetrics.dailyRequests}/${config.maxDailyRequests}</code>\n` +
              `• User so'rov limiti: <code>${config.rateLimitUserPerMin} req/min</code>\n` +
              `• Mavzu limiti: <code>${config.rateLimitTopicPerMin} req/min</code>\n\n` +
              `<i>/ai_status faqat ma'lumot beradi va mavzuni o'zgartirmaydi.</i>`;
            await sendTelegramMessage(message.chat.id, statusMsg, {
              message_thread_id: message.message_thread_id,
              reply_to_message_id: message.message_id,
              parse_mode: 'HTML',
            });
            response = { ok: true, handled: 'ai_status' };
          }
        } else if (!command && (Number.isSafeInteger(message.message_thread_id) || isPrimaryOwner(message.from.id) && message.chat.id === message.from.id)) {
          // Regular user message in a forum topic thread: delegate to AI assistant
          const aiResult = await handleTelegramAiMessage({
            updateId: update.update_id,
            messageId: message.message_id,
            chatId: message.chat.id,
            threadId: message.message_thread_id || 0,
            senderChat: Boolean(message.sender_chat),
            forwarded: Boolean(message.forward_origin || message.forward_from || message.forward_from_chat),
            fromUser: message.from,
            text: message.text,
            replyToMessage: message.reply_to_message,
          });
          console.info('[TELEGRAM_AI_OUTCOME]', JSON.stringify({ handled: aiResult.handled, replySent: aiResult.replySent, ignored: aiResult.ignored, error: aiResult.error }));
          response = { ok: true, handled: 'ai_topic_message', result: aiResult };
        }
      }
    }
    await settleTelegramUpdate(update.update_id, owner, true);
    res.status(200).json(response);
  } catch (err: any) {
    console.error('[TELEGRAM WEBHOOK ERROR]', err?.message || err);
    if (claimed) await settleTelegramUpdate(update.update_id, owner, false).catch((releaseError) => {
      console.error('[TELEGRAM WEBHOOK LEASE RELEASE ERROR]', releaseError?.message || releaseError);
    });
    // Non-2xx lets Telegram retry; never acknowledge an unprocessed payment.
    res.status(503).json({ ok: false, error: 'webhook_processing_failed' });
  }
});

/**
 * Status of Telegram Bot configuration
 */
telegramRouter.get('/status', async (req: Request, res: Response) => {
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const hasSticker = Boolean(process.env.TELEGRAM_WELCOME_STICKER_FILE_ID);
  const group = process.env.TELEGRAM_GROUP_USERNAME || '@efleagueuz';
  const webAppUrl = process.env.TELEGRAM_WEBAPP_URL || process.env.APP_URL || 'https://efluz.vercel.app';

  const { config, redisAvailable } = await getTelegramAiConfig();
  const connection = await inspectTelegramConnection(config.allowedChatId, config.allowedThreadId);
  res.json({
    status: 'ok',
    aiEnabled: config.enabled,
    redisAvailable,
    connection,
    configured: hasToken,
    hasSticker,
    group,
    webAppUrl,
  });
});

/**
 * Verification endpoint for group membership.
 * Uses authenticated Telegram user ID (never trusts arbitrary req.body.userId).
 * Always calls verifyTelegramGroupMembership with forceRefresh: true.
 */
telegramRouter.post('/check-membership', requireAuth, async (req: Request, res: Response) => {
  const telegramId = req.user?.telegramId;
  if (!telegramId) {
    res.status(400).json({ error: 'Authenticated user does not have a linked Telegram account' });
    return;
  }

  const result: TelegramMembershipResult = await verifyTelegramGroupMembership(telegramId, true);
  res.json(result);
});

// -----------------------------------------------------------------------------
// PRIVATE PREMIUM LAB
// Public UI is intentionally disabled. These endpoints provide the production
// foundation while the product is being iterated by authorized admins.
// -----------------------------------------------------------------------------
telegramRouter.get('/premium/me', requireAdmin, async (req: Request, res: Response) => {
  const seasonId = normalizedSeasonId(req.query.seasonId);
  try {
    const entitlement = await getPremiumEntitlement(req.user!.id, seasonId);
    res.json({
      seasonId,
      priceStars: PREMIUM_PRICE_STARS,
      publicEnabled: isPremiumPublicEnabled(),
      active: entitlement?.status === 'ACTIVE',
      entitlement,
    });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_STATUS_UNAVAILABLE' });
  }
});

telegramRouter.get('/premium/badges', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { getPremiumClubBadgeIds } = await import('../services/premiumBadgeService');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ clubIds: await getPremiumClubBadgeIds(normalizedSeasonId(req.query.seasonId)) });
  } catch {
    // A badge is decorative; do not treat a failed cache/read as evidence of Premium.
    res.status(503).json({ error: 'PREMIUM_BADGES_UNAVAILABLE' });
  }
});

telegramRouter.post('/premium/invoice', requireAdmin, async (req: Request, res: Response) => {
  const seasonId = normalizedSeasonId(req.body?.seasonId);
  if (!req.user!.telegramId) {
    res.status(400).json({ error: 'TELEGRAM_ACCOUNT_REQUIRED' });
    return;
  }
  try {
    const existing = await getPremiumEntitlement(req.user!.id, seasonId);
    if (existing?.status === 'ACTIVE') {
      res.status(409).json({ error: 'PREMIUM_ALREADY_ACTIVE', entitlement: existing });
      return;
    }
    const invoice = await createPremiumStarsInvoice({
      userId: req.user!.id,
      telegramId: req.user!.telegramId,
      seasonId,
    });
    res.json({ success: true, ...invoice });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_INVOICE_FAILED' });
  }
});

telegramRouter.get('/premium/admin/overview', requireAdmin, async (req: Request, res: Response) => {
  const seasonId = normalizedSeasonId(req.query.seasonId);
  try {
    const entitlements = await listPremiumEntitlements(seasonId);
    const active = entitlements.filter((item) => item.status === 'ACTIVE');
    res.json({
      seasonId,
      priceStars: PREMIUM_PRICE_STARS,
      publicEnabled: isPremiumPublicEnabled(),
      counts: {
        totalRecords: entitlements.length,
        active: active.length,
        revoked: entitlements.filter((item) => item.status === 'REVOKED').length,
        stars: active.filter((item) => item.source === 'TELEGRAM_STARS').length,
        admin: active.filter((item) => item.source === 'ADMIN').length,
      },
      entitlements,
    });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_OVERVIEW_UNAVAILABLE' });
  }
});

telegramRouter.post('/premium/admin/grant', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.body?.userId || '').trim();
  const seasonId = normalizedSeasonId(req.body?.seasonId);
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
  if (!userId) {
    res.status(400).json({ error: 'USER_ID_REQUIRED' });
    return;
  }
  try {
    const entitlement = await grantPremiumEntitlement({
      userId,
      seasonId,
      source: 'ADMIN',
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      note,
    });
    res.json({ success: true, entitlement });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_GRANT_FAILED' });
  }
});

telegramRouter.post('/premium/admin/revoke', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.body?.userId || '').trim();
  const seasonId = normalizedSeasonId(req.body?.seasonId);
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
  if (!userId) {
    res.status(400).json({ error: 'USER_ID_REQUIRED' });
    return;
  }
  try {
    const entitlement = await revokePremiumEntitlement({
      userId,
      seasonId,
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      note,
    });
    res.json({ success: true, entitlement });
  } catch (err: any) {
    res.status(err?.message === 'PREMIUM_SECOND_CLUB_OWNED' ? 409 : 503).json({ error: err?.message || 'PREMIUM_REVOKE_FAILED' });
  }
});

telegramRouter.get('/premium/admin/career/:userId', requireAdmin, async (req: Request, res: Response) => {
  const seasonId = normalizedSeasonId(req.query.seasonId);
  try {
    const [career, entitlement] = await Promise.all([
      getPremiumCareerSnapshot(req.params.userId, seasonId),
      getPremiumEntitlement(req.params.userId, seasonId),
    ]);
    res.json({ career, entitlement, seasonId, priceStars: PREMIUM_PRICE_STARS });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_CAREER_UNAVAILABLE' });
  }
});
