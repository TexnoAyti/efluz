import { isPrimaryOwner } from './telegramAiConfigService';
import type { TelegramAiMessagePayload } from './telegramAiService';

/** Native assistant uses the existing provider and state store; no separate host. */
export function isNativePrivateAssistant(p: TelegramAiMessagePayload): boolean {
  return process.env.EFL_PRIVATE_ASSISTANT_ENABLED !== 'false'
    && isPrimaryOwner(p.fromUser.id) && p.chatId === p.fromUser.id && p.threadId === 0
    && !p.fromUser.is_bot && !p.senderChat && !p.forwarded;
}

export const PRIVATE_AI_MEMORY = { maxTurns: 48, maxTextChars: 32000, ttlSeconds: 30 * 86400 };

export function privateAssistantContextKey(chat: number, thread: number, user: number): string | null {
  if (!isNativePrivateAssistant({ chatId: chat, threadId: thread, fromUser: { id: user } } as TelegramAiMessagePayload)) return null;
  const bot = process.env.TELEGRAM_BOT_TOKEN?.split(':')[0];
  if (!bot || !/^\d+$/.test(bot)) return null;
  const namespace = process.env.SUPABASE_DATA_NAMESPACE || process.env.NODE_ENV || 'production';
  return `efluz:v1:telegram:private-context:${namespace}:${bot}:${chat}:${user}`;
}

export function isPrivateMemoryReset(text: string): boolean {
  return /^(?:\/forget(?:@[a-zA-Z0-9_]+)?|(?:suhbat\s+)?(?:xotira|kontekst)ni\s+tozala|yangi\s+suhbat)[.!?]*$/i.test(text.trim());
}
