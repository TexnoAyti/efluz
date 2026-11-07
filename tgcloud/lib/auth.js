import { db, EndpointError } from 'sdk';

export function verifiedTelegramId(ctx) {
  const value = ctx?.initData?.user?.id;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EndpointError('Telegram orqali qayta oching.', { code: 'AUTH_REQUIRED' });
  }
  return String(value);
}

export async function currentUser(ctx) {
  const telegramId = verifiedTelegramId(ctx);
  const user = await db.get('SELECT * FROM efl_users WHERE telegram_id = :telegramId', { ':telegramId': telegramId });
  return { telegramId, user };
}
