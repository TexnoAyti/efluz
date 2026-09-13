/**
 * Telegram Bot Service for EFL UZ
 * Handles:
 * 1. /start welcome flow (welcome sticker + personalized HTML message + WebApp launch button)
 * 2. Official group (@efleagueuz) membership verification for club claiming
 */

export interface TelegramMembershipResult {
  isMember: boolean;
  status?: string;
  error?: string;
  cached?: boolean;
}

// Cache configuration:
// - Positive member cache: ~5 minutes to prevent spamming Telegram API
// - Negative non-member cache: 20 seconds (15-30s) so newly joined users can quickly re-check
const POSITIVE_MEMBERSHIP_CACHE_TTL_MS = 5 * 60 * 1000;
const NEGATIVE_MEMBERSHIP_CACHE_TTL_MS = 20 * 1000;

const membershipCache = new Map<string, { isMember: boolean; status: string; timestamp: number }>();

export function clearTelegramMembershipCache(telegramUserId?: string | number): void {
  if (telegramUserId !== undefined) {
    membershipCache.delete(String(telegramUserId));
  } else {
    membershipCache.clear();
  }
}

/**
 * Verifies if a Telegram user is an active member of @efleagueuz.
 * Supports:
 * - 'creator' -> member
 * - 'administrator' -> member
 * - 'member' -> member
 * - 'restricted' (with is_member: true) -> member
 * - 'left', 'kicked', 'restricted' (is_member: false), or 'user not found' -> NOT a member
 * - Temporary network/server failure -> fail-open (DO NOT falsely label user as non-member)
 *
 * @param telegramUserId User's Telegram ID
 * @param forceRefresh When true, bypasses the cache and queries Telegram getChatMember immediately
 */
export async function verifyTelegramGroupMembership(
  telegramUserId: string | number,
  forceRefresh?: boolean
): Promise<TelegramMembershipResult> {
  const userIdStr = String(telegramUserId).trim();
  if (!userIdStr) {
    return { isMember: false, status: 'empty_user_id' };
  }

  // Check cache only if forceRefresh is not requested
  if (!forceRefresh) {
    const cached = membershipCache.get(userIdStr);
    if (cached) {
      const ttl = cached.isMember ? POSITIVE_MEMBERSHIP_CACHE_TTL_MS : NEGATIVE_MEMBERSHIP_CACHE_TTL_MS;
      if (Date.now() - cached.timestamp < ttl) {
        return { isMember: cached.isMember, status: cached.status, cached: true };
      }
    }
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const groupUsername = (process.env.TELEGRAM_GROUP_USERNAME || '@efleagueuz').trim();

  // If no bot token configured (e.g. local dev sandbox without Telegram credentials)
  if (!botToken) {
    const isDev = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';
    if (isDev) {
      console.log(`[TELEGRAM MEMBERSHIP] No TELEGRAM_BOT_TOKEN set in dev environment. Allowing user ${userIdStr} in sandbox.`);
      return { isMember: true, status: 'dev_mock_allowed' };
    }
    console.warn(`[TELEGRAM MEMBERSHIP] TELEGRAM_BOT_TOKEN is missing in production.`);
    return { isMember: true, status: 'fail_open_no_token' };
  }

  const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(groupUsername)}&user_id=${encodeURIComponent(userIdStr)}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data: any = await response.json();

    if (data && data.ok && data.result) {
      const status = data.result.status;
      const isRestrictedMember = status === 'restricted' && Boolean(data.result.is_member);
      const isMember = ['creator', 'administrator', 'member'].includes(status) || isRestrictedMember;

      membershipCache.set(userIdStr, {
        isMember,
        status: status || 'unknown',
        timestamp: Date.now(),
      });

      return { isMember, status };
    }

    // Definitive non-member response from Telegram API
    // e.g. "Bad Request: user not found" or "PARTICIPANT_ID_INVALID"
    const description = (data?.description || '').toLowerCase();
    if (
      description.includes('user not found') ||
      description.includes('participant_id_invalid') ||
      description.includes('not a member') ||
      description.includes('chat not found')
    ) {
      membershipCache.set(userIdStr, {
        isMember: false,
        status: 'left_or_not_found',
        timestamp: Date.now(),
      });
      return { isMember: false, status: 'left_or_not_found' };
    }

    // If Telegram returned 429 Too Many Requests or 5xx server error, fail-open
    console.warn(`[TELEGRAM MEMBERSHIP CHECK] Non-definitive Telegram response for user ${userIdStr}:`, data);
    return { isMember: true, status: 'fail_open_transient_error' };
  } catch (err: any) {
    // Temporary network failure or timeout: DO NOT incorrectly label user as non-member
    console.warn(`[TELEGRAM MEMBERSHIP CHECK] Network failure querying Telegram for user ${userIdStr}: ${err.message}`);
    return { isMember: true, status: 'fail_open_network_timeout' };
  }
}

/**
 * Sends a Telegram text message using the Bot API
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options: { parse_mode?: string; reply_markup?: any } = {}
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode || 'HTML',
        reply_markup: options.reply_markup,
      }),
    });
    const data: any = await res.json();
    return data;
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Sends a Telegram sticker using the Bot API
 */
export async function sendTelegramSticker(
  chatId: number | string,
  stickerFileId: string
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendSticker`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        sticker: stickerFileId,
      }),
    });
    const data: any = await res.json();
    return data;
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * Handles the /start command from Telegram
 * 1. Sends welcome sticker if TELEGRAM_WELCOME_STICKER_FILE_ID is configured
 * 2. Sends personalized welcome message with WebApp launch button and group link
 */
export async function handleTelegramStart(
  chatId: number | string,
  fromUser?: { id: number | string; first_name?: string; last_name?: string; username?: string }
): Promise<{ ok: boolean; stickerSent?: boolean; messageSent: boolean; error?: string }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    console.warn('[TELEGRAM BOT /start] Missing TELEGRAM_BOT_TOKEN');
    return { ok: false, messageSent: false, error: 'TELEGRAM_BOT_TOKEN is missing' };
  }

  const stickerFileId = process.env.TELEGRAM_WELCOME_STICKER_FILE_ID?.trim();
  let stickerSent = false;

  // 1. Send welcome sticker if configured
  if (stickerFileId) {
    try {
      const stickerRes = await sendTelegramSticker(chatId, stickerFileId);
      stickerSent = Boolean(stickerRes && stickerRes.ok);
    } catch (err: any) {
      console.warn('[TELEGRAM BOT] Failed to send welcome sticker:', err.message);
    }
  }

  // 2. Format personalized welcome message
  const rawFirstName = fromUser?.first_name || 'Foydalanuvchi';
  const cleanFirstName = rawFirstName.replace(/[<>]/g, '');
  const webAppUrl = process.env.TELEGRAM_WEBAPP_URL?.trim() || process.env.APP_URL?.trim() || 'https://efluz.vercel.app';
  const groupUsername = (process.env.TELEGRAM_GROUP_USERNAME || '@efleagueuz').trim();
  const groupUrl = groupUsername.startsWith('@')
    ? `https://t.me/${groupUsername.slice(1)}`
    : `https://t.me/${groupUsername}`;

  const welcomeText =
`Assalomu alaykum, <b>${cleanFirstName}</b>!

⚽ <b>EFL UZ</b> — eFootball O‘zbekiston Rasmiy Ligasi platformasiga xush kelibsiz!

🏆 <b>Top 5 Yevropa Ligalari:</b>
• 🇬🇧 Premier League
• 🇪🇸 La Liga
• 🇮🇹 Serie A
• 🇩🇪 Bundesliga
• 🇫🇷 Ligue 1

⚔️ <b>Asosiy Imkoniyatlar:</b>
• Sevimli klubingizni tanlang va boshqaring
• Real-vaqt matchmarkaz va eFootball bahslari
• Ikki tomonlama natija tasdiqlash va hakamlik
• UEFA Chempionlar Ligasi saralash tizimi

Quyidagi tugma orqali ilovani oching va o‘z klubingizni band qiling!`;

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: '⚽ Ilovani ochish (EFL UZ)',
          web_app: { url: webAppUrl },
        },
      ],
      [
        {
          text: `📢 Rasmiy guruh (${groupUsername})`,
          url: groupUrl,
        },
      ],
    ],
  };

  const msgRes = await sendTelegramMessage(chatId, welcomeText, {
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });

  return {
    ok: msgRes.ok,
    stickerSent,
    messageSent: msgRes.ok,
    error: msgRes.error,
  };
}
