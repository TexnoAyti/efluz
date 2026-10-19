import 'dotenv/config';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import { NewMessage } from 'teleproto/events';
import { GoogleGenAI } from '@google/genai';
import { loadTelegramUserbotState, resetDailyCounter, saveTelegramUserbotState } from '../src/server/services/telegramUserbotState';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const apiId = Number(required('TELEGRAM_API_ID'));
const apiHash = required('TELEGRAM_API_HASH');
const session = required('TELEGRAM_USER_SESSION');
const ownerId = required('TELEGRAM_OWNER_ID');
const statePath = process.env.TELEGRAM_USERBOT_STATE_PATH?.trim() || './data/telegram-userbot-state.json';
const allowedChats = new Set((process.env.TELEGRAM_USERBOT_ALLOWED_CHATS || '').split(',').map(v => v.trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
const dailyLimit = Math.max(1, Number(process.env.TELEGRAM_USERBOT_DAILY_SEND_LIMIT || 40));
const delayMs = Math.max(30_000, Number(process.env.TELEGRAM_USERBOT_SEND_DELAY_MS || 45_000));
const geminiKey = process.env.GEMINI_API_KEY?.trim();

if (!Number.isInteger(apiId)) throw new Error('TELEGRAM_API_ID must be an integer');
if (!allowedChats.size) throw new Error('TELEGRAM_USERBOT_ALLOWED_CHATS must contain at least one chat');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const normalizeChat = (value: string) => value.trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').split('/')[0].toLowerCase();
const displayName = (sender: any) => [sender?.firstName, sender?.lastName].filter(Boolean).join(' ').trim() || sender?.username || String(sender?.id || 'unknown');

const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
await client.connect();
const me: any = await client.getMe();
if (String(me.id) !== ownerId) throw new Error(`TELEGRAM_OWNER_ID does not match the authenticated session`);

async function reply(message: any, text: string) {
  await client.sendMessage('me', { message: text, replyTo: message.id });
}

async function collectAuthors(message: any, chatInput: string, requestedLimit: number) {
  const chat = normalizeChat(chatInput);
  if (!allowedChats.has(chat)) return reply(message, `Ruxsat berilmagan guruh: @${chat}`);
  const limit = Math.min(Math.max(requestedLimit || 500, 1), 5000);
  const state = await loadTelegramUserbotState(statePath);
  let scanned = 0;
  let added = 0;
  for await (const item of client.iterMessages(chat, { limit })) {
    scanned++;
    const sender: any = await item.getSender().catch(() => null);
    if (!sender?.id || sender.bot || String(sender.id) === ownerId) continue;
    const id = String(sender.id);
    if (!state.recipients[id]) added++;
    state.recipients[id] = {
      id,
      username: sender.username || undefined,
      displayName: displayName(sender),
      sourceChat: chat,
      collectedAt: new Date().toISOString(),
    };
  }
  await saveTelegramUserbotState(statePath, state);
  await reply(message, `${scanned} ta xabar tekshirildi. ${added} ta yangi muallif qo‘shildi. Jami: ${Object.keys(state.recipients).length}.`);
}

async function sendCampaign(message: any, postLink: string) {
  const match = postLink.match(/^https?:\/\/t\.me\/([A-Za-z0-9_]+)\/(\d+)$/i);
  if (!match) return reply(message, 'Post havolasi formati: https://t.me/channel/123');
  const [, source, messageIdText] = match;
  const state = await loadTelegramUserbotState(statePath);
  resetDailyCounter(state);
  const pending = Object.values(state.recipients).filter(recipient => !state.sent[recipient.id]);
  await reply(message, `Kampaniya boshlandi. Navbatda ${pending.length} ta odam, bugungi limit ${dailyLimit}.`);
  for (const recipient of pending) {
    resetDailyCounter(state);
    if (state.daily.count >= dailyLimit) break;
    try {
      await client.sendMessage(recipient.id, { message: 'Assalomu alaykum!' });
      await client.forwardMessages(recipient.id, { messages: [Number(messageIdText)], fromPeer: source });
      state.sent[recipient.id] = new Date().toISOString();
      state.daily.count++;
      await saveTelegramUserbotState(statePath, state);
      await sleep(delayMs);
    } catch (error: any) {
      console.warn('[USERBOT SEND]', recipient.id, error?.errorMessage || error?.message || String(error));
    }
  }
  await saveTelegramUserbotState(statePath, state);
  await reply(message, `Kampaniya to‘xtadi. Bugun yuborildi: ${state.daily.count}/${dailyLimit}. Jami yuborilgan: ${Object.keys(state.sent).length}.`);
}

type AssistantPlan =
  | { action: 'collect'; chat: string; limit: number }
  | { action: 'campaign'; postLink: string }
  | { action: 'status' }
  | { action: 'unknown'; explanation: string };

async function understandNaturalCommand(text: string): Promise<AssistantPlan> {
  if (!geminiKey) return { action: 'unknown', explanation: 'GEMINI_API_KEY sozlanmagan.' };
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite',
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      responseMimeType: 'application/json',
      systemInstruction: `Siz EFLUZ shaxsiy Telegram yordamchisining buyruq rejalashtiruvchisisiz.
Faqat quyidagi amallardan bittasini JSON qaytaring:
1) {"action":"collect","chat":"@username","limit":500} — guruhning yaqindagi xabar mualliflarini yig‘ish.
2) {"action":"campaign","postLink":"https://t.me/channel/123"} — oldin yig‘ilgan, rozilik bergan qabul qiluvchilarga salom va post yuborish.
3) {"action":"status"} — holatni ko‘rsatish.
4) {"action":"unknown","explanation":"..."} — mavjud vositalar bajara olmaydigan topshiriq.
Hech qanday qo‘shimcha matn yoki yangi amal o‘ylab topmang.`,
    },
  });
  try {
    const plan = JSON.parse(response.text || '{}');
    if (plan.action === 'collect' && typeof plan.chat === 'string') {
      return { action: 'collect', chat: plan.chat, limit: Math.min(Math.max(Number(plan.limit) || 500, 1), 5000) };
    }
    if (plan.action === 'campaign' && typeof plan.postLink === 'string') return { action: 'campaign', postLink: plan.postLink };
    if (plan.action === 'status') return { action: 'status' };
    return { action: 'unknown', explanation: String(plan.explanation || 'Topshiriq uchun hali vosita mavjud emas.') };
  } catch {
    return { action: 'unknown', explanation: 'AI topshiriqni aniq rejaga aylantira olmadi.' };
  }
}

async function showStatus(message: any) {
  const state = await loadTelegramUserbotState(statePath);
  resetDailyCounter(state);
  return reply(message, `Userbot ishlayapti. Mualliflar: ${Object.keys(state.recipients).length}. Yuborilgan: ${Object.keys(state.sent).length}. Bugun: ${state.daily.count}/${dailyLimit}.`);
}

client.addEventHandler(async (event: any) => {
  const message = event.message;
  if (!message?.out || !message?.isPrivate || String(message.senderId || '') !== ownerId) return;
  const text = String(message.message || '').trim();
  const collect = text.match(/^\/collect\s+(\S+)(?:\s+(\d+))?$/i);
  if (collect) return collectAuthors(message, collect[1], Number(collect[2] || 500));
  const campaign = text.match(/^\/campaign\s+(https?:\/\/t\.me\/\S+)$/i);
  if (campaign) return sendCampaign(message, campaign[1]);
  if (text === '/userbot_status') return showStatus(message);
  if (!text || text.startsWith('/')) return;
  const plan = await understandNaturalCommand(text);
  if (plan.action === 'collect') return collectAuthors(message, plan.chat, plan.limit);
  if (plan.action === 'campaign') return sendCampaign(message, plan.postLink);
  if (plan.action === 'status') return showStatus(message);
  return reply(message, plan.explanation);
}, new NewMessage({ outgoing: true }));

console.log(`[TELEGRAM USERBOT] Connected as ${me.username ? `@${me.username}` : ownerId}`);
console.log('[TELEGRAM USERBOT] Natural Uzbek instructions and commands: /collect @group 500 | /campaign https://t.me/channel/123 | /userbot_status');
await new Promise(() => undefined);
