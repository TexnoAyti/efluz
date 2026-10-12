import { getAiRedisClient } from './telegramAiDeadline';
import { isAiAdminActor } from './telegramAiAdminAccess';
import type { TelegramAiMessagePayload } from './telegramAiService';
import type { AiClubChoice } from './telegramAiEntities';
import { limitAiReply } from './telegramAiResponsePolicy';

type Draft = { request: string; question: string; clubChoices?: AiClubChoice[]; expiresAt: number; deliveredMessageId?: number };
const local = new Map<string, Draft>();
const key = (p: TelegramAiMessagePayload, readOnly = false) => `efluz:v1:telegram:ai:${readOnly ? 'read-club' : 'draft'}:${p.chatId}:${p.threadId}:${p.fromUser.id}`;
async function read(p: TelegramAiMessagePayload, signal?: AbortSignal, readOnly = false): Promise<Draft | null> {
  if ((!readOnly && !isAiAdminActor(p.fromUser.id)) || p.fromUser.is_bot || p.senderChat || p.forwarded) return null;
  const client = getAiRedisClient(signal);
  const draft = client ? await client.get<Draft>(key(p, readOnly)) : process.env.NODE_ENV === 'test' ? local.get(key(p, readOnly)) : null;
  return draft && draft.expiresAt > Date.now() ? draft : null;
}
async function write(p: TelegramAiMessagePayload, draft: Draft, signal?: AbortSignal, readOnly = false) {
  const client = getAiRedisClient(signal);
  if (client) await client.set(key(p, readOnly), draft, { ex: Math.max(1, Math.ceil((draft.expiresAt - Date.now()) / 1000)) });
  else if (process.env.NODE_ENV === 'test') local.set(key(p, readOnly), draft);
}
async function deliveredDraft(p: TelegramAiMessagePayload, signal?: AbortSignal, readOnly = false): Promise<Draft | null> {
  const draft = await read(p, signal, readOnly);
  if (!draft?.deliveredMessageId) return null;
  if (p.replyToMessage) {
    const botId = Number(process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]);
    if (p.replyToMessage.from?.id !== botId || p.replyToMessage.message_id !== draft.deliveredMessageId) return null;
  }
  return draft;
}
export const getDeliveredAiAdminDraft = (p: TelegramAiMessagePayload, signal?: AbortSignal) => deliveredDraft(p, signal);
export const getDeliveredAiReadClubDraft = (p: TelegramAiMessagePayload, signal?: AbortSignal) => deliveredDraft(p, signal, true);
/** Public clarification is stored only after delivery, in a separate read-only scope. */
export async function saveDeliveredAiReadClubDraft(p: TelegramAiMessagePayload, question: string, clubChoices: AiClubChoice[], botMessageId: number, signal?: AbortSignal) {
  if (p.text.length > 1800 || !clubChoices.length || p.fromUser.is_bot || p.senderChat || p.forwarded) return;
  if (isAiAdminActor(p.fromUser.id)) await clearAiAdminDraft(p, signal);
  await write(p, { request: p.text, question: limitAiReply(question, 1000), clubChoices: clubChoices.slice(0,4), deliveredMessageId: botMessageId, expiresAt: Date.now() + 300000 }, signal, true);
}
export async function clearAiReadClubDraft(p: TelegramAiMessagePayload, signal?: AbortSignal) {
  const client = getAiRedisClient(signal);
  if (client) await client.del(key(p, true));
  local.delete(key(p, true));
}
export async function saveAiAdminDraft(p: TelegramAiMessagePayload, request: string, question: string, signal?: AbortSignal, clubChoices?: AiClubChoice[]) {
  if (!isAiAdminActor(p.fromUser.id)) return;
  if (request.length > 1800) { await clearAiAdminDraft(p, signal); return; }
  await write(p, { request, question: limitAiReply(question, 1000), ...(clubChoices?.length ? { clubChoices: clubChoices.slice(0, 4) } : {}), expiresAt: Date.now() + 300000 }, signal);
}
export async function rememberDeliveredAiAdminDraft(p: TelegramAiMessagePayload, reply: string, botMessageId: number, signal?: AbortSignal) {
  const draft = await read(p, signal);
  if (draft?.question === limitAiReply(reply, 1000) && !draft.deliveredMessageId) await write(p, { ...draft, deliveredMessageId: botMessageId }, signal);
}
export async function clearAiAdminDraft(p: TelegramAiMessagePayload, signal?: AbortSignal) {
  const client = getAiRedisClient(signal);
  if (client) await client.del(key(p));
  local.delete(key(p));
}
