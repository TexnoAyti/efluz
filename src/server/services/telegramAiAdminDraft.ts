import { getAiRedisClient } from './telegramAiDeadline';
import { isAiAdminActor } from './telegramAiAdminAccess';
import type { TelegramAiMessagePayload } from './telegramAiService';

type Draft = { request: string; question: string; expiresAt: number; deliveredMessageId?: number };
const local = new Map<string, Draft>();
const key = (p: TelegramAiMessagePayload) => `efluz:v1:telegram:ai:draft:${p.chatId}:${p.threadId}:${p.fromUser.id}`;
async function read(p: TelegramAiMessagePayload, signal?: AbortSignal): Promise<Draft | null> {
  if (!isAiAdminActor(p.fromUser.id) || p.fromUser.is_bot || p.senderChat || p.forwarded) return null;
  const client = getAiRedisClient(signal);
  const draft = client ? await client.get<Draft>(key(p)) : process.env.NODE_ENV === 'test' ? local.get(key(p)) : null;
  return draft && draft.expiresAt > Date.now() ? draft : null;
}
async function write(p: TelegramAiMessagePayload, draft: Draft, signal?: AbortSignal) {
  const client = getAiRedisClient(signal);
  if (client) await client.set(key(p), draft, { ex: Math.max(1, Math.ceil((draft.expiresAt - Date.now()) / 1000)) });
  else if (process.env.NODE_ENV === 'test') local.set(key(p), draft);
}
export async function getDeliveredAiAdminDraft(p: TelegramAiMessagePayload, signal?: AbortSignal): Promise<Draft | null> {
  const draft = await read(p, signal);
  if (!draft?.deliveredMessageId) return null;
  if (p.replyToMessage) {
    const botId = Number(process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]);
    if (p.replyToMessage.from?.id !== botId || p.replyToMessage.message_id !== draft.deliveredMessageId) return null;
  }
  return draft;
}
export async function saveAiAdminDraft(p: TelegramAiMessagePayload, request: string, question: string, signal?: AbortSignal) {
  if (!isAiAdminActor(p.fromUser.id)) return;
  if (request.length > 1800) { await clearAiAdminDraft(p, signal); return; }
  await write(p, { request, question: question.slice(0, 350), expiresAt: Date.now() + 300000 }, signal);
}
export async function rememberDeliveredAiAdminDraft(p: TelegramAiMessagePayload, reply: string, botMessageId: number, signal?: AbortSignal) {
  const draft = await read(p, signal);
  if (draft?.question === reply && !draft.deliveredMessageId) await write(p, { ...draft, deliveredMessageId: botMessageId }, signal);
}
export async function clearAiAdminDraft(p: TelegramAiMessagePayload, signal?: AbortSignal) {
  const client = getAiRedisClient(signal);
  if (client) await client.del(key(p));
  local.delete(key(p));
}
