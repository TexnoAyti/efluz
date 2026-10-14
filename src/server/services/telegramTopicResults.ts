import { randomBytes, createHash } from 'node:crypto';
import { getAiRedisClient, withinAiDeadline } from './telegramAiDeadline';
import { createAiTournamentReader } from './telegramAiDataService';
import { createAiSnapshotReader } from './telegramAiSnapshotReader';
import { ReadModelKeys, type OwnerNeutralClub } from '../readModel/readModelStore';
import { resolveAiClubs, normalizeAiEntity } from './telegramAiEntities';
import { findConversationCompetitions, requestedMatchday } from './telegramAiConversationCommands';
import { isAiHypotheticalQuestion } from './telegramAiMessageUnderstanding';
import { detectAiCupStage } from './telegramAiCupStage';
import { assertSingleNaturalAdminRequest, detectNaturalAdminAction, isShorthandAiResultRequest } from './telegramAiAdminLanguage';
import { executeAiAdminRoute } from './telegramAiAdminGateway';
import { inspectAiAdminOutcome } from './telegramAiAdminOutcome';
import { isAiAdminActor } from './telegramAiAdminAccess';
import { sendTelegramMessage, answerTelegramCallback } from './telegramBotService';
import { checkAndIncrementAiRateLimits } from './telegramAiRateLimitService';
import { getAuthoritativeUserForAuthorization } from '../firebase/firestoreStore';
import type { Competition } from '../../types';
import type { AdminPlan } from './telegramAiAdminCatalog';

const season = 'season-2026-27', ttl = 86400, prefix = 'efluz:v1:telegram:topic-result:';
const proposalKey = (token: string) => prefix + 'proposal:' + token;
const sourceKey = (chat: number, thread: number, message: number) => `${prefix}source:${chat}:${thread}:${message}`;
export type TopicResultProposal = { token: string; chat: number; thread: number; sourceMessage: number; submitter: number; updateId: number; expiresAt: number; state: string; plan: AdminPlan; deliveredMessage?: number; expectedFixture: any; summary?: string };
const editable = new Set(['SCHEDULED', 'POSTPONED', 'AWAITING_RESULT', 'PENDING_CONFIRMATION']);
const roundLabel = (f: any) => f.roundName || (Number.isInteger(f.matchday) ? `${f.matchday}-tur` : 'Tur ma’lumoti yo‘q');
const fixtureLabel = (f: any) => `${f.home} — ${f.away} · ${f.competition} · ${roundLabel(f)}`;

/** The same verified group/topic links used by the app's result notifications. */
export function competitionResultTopic(c: Competition): number | null {
  const name = `${c.id} ${c.name}`.toLowerCase();
  if (name.includes('super')) return 2335;
  if (/champions|ucl/.test(name)) return 7;
  if (/cup|pokal|copa|coppa|coupe/.test(name)) return 8;
  return c.type === 'LEAGUE' ? ({ 'league-premier-league': 2, 'league-la-liga': 3, 'league-serie-a': 4, 'league-bundesliga': 5, 'league-ligue-1': 6 } as Record<string, number>)[c.leagueId!] || null : null;
}

export const TOPIC_RESULT_PUBLISH = `-- EFL_TOPIC_RESULT_PUBLISH_V1
local old = redis.call('GET', KEYS[2])
if old then
 local previous = cjson.decode(old)
 if previous.updateId > tonumber(ARGV[2]) or ARGV[3] ~= '1' or (previous.updateId == tonumber(ARGV[2]) and (ARGV[1] == '' or previous.token ~= cjson.null)) then return 0 end
end
if ARGV[1] ~= '' then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[4]) end
redis.call('SET', KEYS[2], ARGV[5], 'EX', ARGV[4])
return 1`;
export const TOPIC_RESULT_CLAIM = `-- EFL_TOPIC_RESULT_CLAIM_V1
local raw = redis.call('GET', KEYS[1])
local source = redis.call('GET', KEYS[3])
if not raw or not source then return 0 end
local p = cjson.decode(raw)
if p.state ~= 'pending' or p.expiresAt <= tonumber(ARGV[1]) or p.chat ~= tonumber(ARGV[2]) or p.thread ~= tonumber(ARGV[3]) or p.deliveredMessage ~= tonumber(ARGV[4]) or cjson.decode(source).token ~= p.token then return 0 end
if ARGV[5] == 'executing' then
 if redis.call('GET', KEYS[2]) then return 0 end
 redis.call('SET', KEYS[2], p.token, 'EX', ARGV[6])
end
p.state = ARGV[5]
redis.call('SET', KEYS[1], cjson.encode(p), 'EX', ARGV[6])
return 1`;

type Dependencies = { reader?: ReturnType<typeof createAiTournamentReader>; ownership?: () => Promise<{ data: OwnerNeutralClub[]; stale: boolean; available: boolean }>; authorize?: (id: number) => Promise<boolean>; execute?: typeof executeAiAdminRoute };
let testDependencies: Dependencies = {};
export function setTestTopicResultDependencies(deps: Dependencies = {}) { if (process.env.NODE_ENV !== 'test') throw Error('TEST_ONLY'); testDependencies = deps; }

async function authorize(id: number) {
  if (!isAiAdminActor(id)) return false;
  if (testDependencies.authorize) return testDependencies.authorize(id);
  const user = await getAuthoritativeUserForAuthorization(`user-${id}`);
  return Boolean(user?.isAdmin && !user.isSuspended && String(user.telegramId) === String(id));
}

/** Planning reads verified public data; member identity comes only from Telegram. */
export async function planTopicResult(text: string, sender: number, thread: number, signal: AbortSignal) {
  const scores = [...text.matchAll(/\b(\d{1,2})\s*[:–—−-]\s*(\d{1,2})\b/g)];
  if (scores.length !== 1 || isAiHypotheticalQuestion(text)) return null;
  const bare = /^\s*(?:(?:hisob|natija)\s*:?\s*)?\d{1,2}\s*[:–—−-]\s*\d{1,2}(?:\s+\d{1,3}\s*-?\s*tur)?[.! ]*$/i.test(text);
  if (!bare && !isShorthandAiResultRequest(text) && detectNaturalAdminAction(text) !== 'result_edit') return null;
  assertSingleNaturalAdminRequest(text);
  const reader = testDependencies.reader || createAiTournamentReader(signal);
  const catalog: any = await reader.read({ dataset: 'competitions', limit: 30 });
  if (!catalog.complete || catalog.stale) throw Error('CLARIFY:Turnir ma’lumoti hozir tasdiqlanmadi. Keyinroq qayta yuboring.');
  const allowed = (catalog.data as Competition[]).filter(c => competitionResultTopic(c) === thread);
  if (!allowed.length) return null;
  const named = findConversationCompetitions(text, catalog.data);
  if (named.some(c => !allowed.some(a => a.id === c.id))) throw Error('CLARIFY:Bu natija boshqa turnirga tegishli. Uni o‘sha turnir mavzusiga yuboring.');
  const competitions = named.length ? allowed.filter(c => named.some(n => n.id === c.id)) : allowed;
  const ownership = testDependencies.ownership ? await testDependencies.ownership() : await createAiSnapshotReader(signal).read<OwnerNeutralClub>(ReadModelKeys.clubsWithOwners(season));
  if (!ownership.available || ownership.stale) throw Error('CLARIFY:Klub egaligi hozir tasdiqlanmadi. Natija rejasini taxmin qilib ochmayman.');
  const own = ownership.data.filter(c => c.ownerUserId === `user-${sender}`);
  const selected = resolveAiClubs(text, ownership.data as any);
  if (selected.clarification) throw Error('CLARIFY:' + selected.clarification);
  if (selected.clubs.length && selected.clubs.length !== 2) throw Error('CLARIFY:Ikkala jamoa va hisobni yozing. Yoki faqat hisobni yozing — birinchi son sizning klubingiz uchun bo‘ladi.');
  if (!own.length && !isAiAdminActor(sender)) throw Error('CLARIFY:Bu akkauntga klub biriktirilganligi topilmadi. Natijani o‘yin ishtirokchisi yuborsin.');
  const games: any[] = [], rounds = new Map<string, number | undefined>();
  for (const c of competitions) {
    // Named opponents identify the fixture across rounds, including reports played
    // ahead of the league clock. Only an explicit round may narrow that search.
    // A bare score still needs the current round to avoid guessing an opponent.
    const round = requestedMatchday(text) ?? (c.type === 'LEAGUE' && !selected.clubs.length ? c.currentMatchday : undefined);
    rounds.set(c.id, round);
    const stage = detectAiCupStage(text);
    // Keep verified other rounds for diagnosis; never silently change an explicit round.
    const filter = { dataset: 'fixtures', competition: c.id, ...(round && !selected.clubs.length ? { matchday: round } : {}), ...(stage ? {stage} : {}), ...(selected.clubs.length ? { club: selected.clubs[0].id, opponent: selected.clubs[1].id } : {}), limit: 30 };
    let offset = 0;
    do {
      const page: any = await reader.read({ ...filter, offset });
      if (!page.complete || page.stale || page.error) throw Error('CLARIFY:O‘yinlar ma’lumoti hozir to‘liq tasdiqlanmadi. Keyinroq qayta yuboring.');
      games.push(...(page.data || []).filter((f: any) => selected.clubs.length || own.some(o => [f.homeClubId,f.awayClubId].includes(o.id))));
      if (page.nextOffset == null) break;
      if (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset || page.nextOffset > 1000) throw Error('CLARIFY:O‘yinlarni to‘liq tekshirib bo‘lmadi. Jamoalar va turni hisob bilan yozing.');
      offset = page.nextOffset;
    } while (true);
  }
  const scoped = games.filter(f => !rounds.get(f.competitionId) || f.matchday === rounds.get(f.competitionId));
  const candidates = scoped.filter(f => editable.has(f.status));
  if (candidates.length > 1) throw Error('CLARIFY:Bir nechta o‘yin mos keldi:\n' + candidates.slice(0,5).map(fixtureLabel).join('\n') + (candidates.length > 5 ? `\nJami ${candidates.length} ta mos o‘yin.` : '') + '\nHisob bilan kerakli tur yoki kubok bosqichini ko‘rsating. Natija saqlanmadi.');
  if (!candidates.length) {
    const checked = `${selected.clubs.length ? selected.clubs.map(c => c.name).join(' — ') : own.map(c => c.name).join(', ')} · ${competitions.map(c => c.name + (rounds.get(c.id) ? ` · ${rounds.get(c.id)}-tur` : '')).join('; ')}`;
    let reason = `${checked}: jadvalda mos o‘yin topilmadi. Natija saqlanmadi.`;
    if (!scoped.length && games.length) reason = `${checked}: shu turda o‘yin topilmadi. Jadvaldagi juftlik:\n${games.slice(0,5).map(fixtureLabel).join('\n')}\nSiz yozgan tur avtomatik almashtirilmadi. Natija saqlanmadi.`;
    else if (scoped.length) reason = scoped.slice(0,5).map(f => {
      if (f.status === 'CONFIRMED') return `${fixtureLabel(f)}: natija allaqachon tasdiqlangan.${Number.isInteger(f.homeScore) && Number.isInteger(f.awayScore) ? ` Saqlangan hisob: ${f.home} ${f.homeScore}:${f.awayScore} ${f.away}.` : ' Saqlangan hisob bu manbada ko‘rsatilmagan.'}`;
      if (f.status === 'DISPUTED') return `${fixtureLabel(f)}: natija nizoli. Admin ko‘rib chiqishi kerak.`;
      return `${fixtureLabel(f)}: o‘yin holati ${f.status}; bu holatda yangi tasdiqlash taklifi ochilmaydi.`;
    }).join('\n') + '\nNatija o‘zgartirilmadi.';
    throw Error('CLARIFY:' + reason);
  }
  const f = candidates[0];
  if (!own.some(c => [f.homeClubId,f.awayClubId].includes(c.id)) && !isAiAdminActor(sender)) throw Error('CLARIFY:Natijani faqat shu o‘yindagi klub egasi yuborishi mumkin.');
  const firstClub = selected.clubs[0] || (own.filter(c => [f.homeClubId,f.awayClubId].includes(c.id)).length === 1 ? own.find(c => [f.homeClubId,f.awayClubId].includes(c.id)) : null);
  if (!firstClub) throw Error('CLARIFY:Hisob tartibi noaniq. Ikkala jamoa nomini hisob bilan yozing.');
  const [a,b] = [Number(scores[0][1]),Number(scores[0][2])];
  const c = competitions.find(c => c.id === f.competitionId)!;
  if (c.type !== 'LEAGUE' && a === b) throw Error('CLARIFY:Kubokdagi durangda g‘olib yoki penalti natijasini ham aniqlashtirish kerak. Bu hisobni avtomatik yakuniy deb tasdiqlamayman.');
  const homeScore = firstClub.id === f.homeClubId ? a : b, awayScore = firstClub.id === f.homeClubId ? b : a;
  const expectedFixture = { competitionId: f.competitionId, homeClubId: f.homeClubId, awayClubId: f.awayClubId, status: f.status, updatedAt: f.updatedAt ?? null };
  return { fixture: f, expectedFixture, plan: { action: 'result_edit', targetId: f.id, body: { homeScore, awayScore, status: 'CONFIRMED', expectedFixture } } as AdminPlan };
}

/** Called only after the webhook secret and shared update lease are verified. */
export async function handleTopicResultUpdate(update: any): Promise<{ handled: boolean; result?: string }> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000), signal = controller.signal;
  try {
    const callback = update.callback_query;
    if (typeof callback?.data === 'string' && /^rs:(approve|reject):[a-f0-9]{24}$/.test(callback.data)) {
      const message = callback.message, actor = callback.from?.id;
      if (!Number.isSafeInteger(actor) || callback.from?.is_bot || !await authorize(actor)) {
        await answerTelegramCallback(callback.id, 'Faqat vakolatli admin tasdiqlaydi.', true); return { handled: true, result: 'unauthorized' };
      }
      const client = getAiRedisClient(signal);
      if (!client) throw Error('RESULT_STATE_UNAVAILABLE');
      const [,action,token] = callback.data.split(':');
      const p = await client.get<TopicResultProposal>(proposalKey(token));
      const botId = Number(process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]);
      if (!p || message?.from?.id !== botId || message?.chat?.id !== p.chat || message.message_thread_id !== p.thread || message.message_id !== p.deliveredMessage || p.expiresAt <= Date.now()) {
        await answerTelegramCallback(callback.id, 'Taklif topilmadi yoki muddati o‘tgan.', true); return { handled: true, result: 'invalid' };
      }
      const state = action === 'approve' ? 'executing' : 'cancelled';
      const claimed = await client.eval(TOPIC_RESULT_CLAIM, [proposalKey(token), prefix+'fixture:'+p.plan.targetId, sourceKey(p.chat,p.thread,p.sourceMessage)], [Date.now(),p.chat,p.thread,p.deliveredMessage,state,ttl]);
      if (Number(claimed) !== 1) { await answerTelegramCallback(callback.id, 'Taklif eskirgan yoki allaqachon ko‘rib chiqilgan.', true); return { handled: true, result: 'already_processed' }; }
      let reply = 'Taklif rad etildi. Natija o‘zgarmadi.';
      if (action === 'approve') {
        try {
          const result = await withinAiDeadline(signal, () => (testDependencies.execute || executeAiAdminRoute)(p.plan,actor,'topic-result-'+token,signal));
          if (result.status >= 200 && result.status < 300 && result.data?.success !== false && !result.data?.error) {
            const outcome = inspectAiAdminOutcome(p.plan,result.data);
            reply = outcome.state === 'verified' ? `Natija saqlandi:\n${p.summary || 'O‘yin: '+p.plan.targetId}\nHisob: ${p.plan.body.homeScore}:${p.plan.body.awayScore}.${result.data?.derivedPending ? '\nTurnir jadvali yangilanish navbatiga qo‘yildi.' : ''}` : outcome.message;
          } else reply = 'Natija saqlanmadi: ' + String(result.data?.message || result.data?.error || 'server rad etdi').slice(0,250);
          await client.set(proposalKey(token), { ...p, state: 'done', receipt: {status:result.status} }, {ex:ttl});
        } catch {
          await client.set(proposalKey(token), { ...p, state: 'unknown' }, {ex:ttl});
          reply = 'Natijani saqlash yakuni tasdiqlanmadi. Admin panelda tekshiring; amal avtomatik qayta bajarilmaydi.';
        }
      }
      await sendTelegramMessage(p.chat, reply, {parse_mode:null,message_thread_id:p.thread,reply_to_message_id:p.sourceMessage,signal});
      await answerTelegramCallback(callback.id, action === 'reject' ? 'Rad etildi' : 'Natija tekshirildi. Bot javobini ko‘ring.');
      return {handled:true,result:state};
    }
    const m = update.edited_message || update.message;
    if (!m || m.chat?.username?.toLowerCase() !== 'efleagueuz' || ![2,3,4,5,6,7,8,2335].includes(m.message_thread_id) || !Number.isSafeInteger(m.from?.id) || m.from.id <= 0 || m.from.is_bot || m.sender_chat || m.forward_origin || m.forward_from || m.forward_from_chat) return {handled:false};
    const text = String(m.text || m.caption || '').trim();
    if (!update.edited_message && (!text || !/\d{1,2}\s*[:–—−-]\s*\d{1,2}/.test(text))) return {handled:false};
    const client = getAiRedisClient(signal);
    if (!client) throw Error('RESULT_STATE_UNAVAILABLE');
    const latestKey = sourceKey(m.chat.id,m.message_thread_id,m.message_id);
    if (update.edited_message) await client.eval(TOPIC_RESULT_PUBLISH,[proposalKey('invalidated'),latestKey],['',update.update_id,'1',ttl,JSON.stringify({token:null,updateId:update.update_id})]);
    if (!text || !/\d{1,2}\s*[:–—−-]\s*\d{1,2}/.test(text)) return {handled:false};
    const previous: any = await client.get(latestKey);
    if (previous?.token || previous?.updateId > update.update_id) return {handled:true,result:'duplicate_source'};
    const rate = await checkAndIncrementAiRateLimits({ chatId:m.chat.id,threadId:m.message_thread_id,userId:m.from.id,userLimitPerMin:5,topicLimitPerMin:60,maxDailyRequests:500,countDaily:false,signal });
    if (!rate.allowed) return {handled:true,result:'rate_limited'};
    let planned;
    try { planned = await planTopicResult(text,m.from.id,m.message_thread_id,signal); }
    catch (error: any) {
      if (!String(error.message).startsWith('CLARIFY:')) throw error;
      await sendTelegramMessage(m.chat.id,error.message.slice(8),{parse_mode:null,message_thread_id:m.message_thread_id,reply_to_message_id:m.message_id,signal});
      return {handled:true,result:'clarification'};
    }
    if (!planned) return {handled:false};
    const token = randomBytes(12).toString('hex'), f = planned.fixture;
    const p: TopicResultProposal = {token,chat:m.chat.id,thread:m.message_thread_id,sourceMessage:m.message_id,submitter:m.from.id,updateId:update.update_id,expiresAt:Date.now()+ttl*1000,state:'pending',plan:planned.plan,expectedFixture:planned.expectedFixture,summary:fixtureLabel(f)};
    const published = await client.eval(TOPIC_RESULT_PUBLISH,[proposalKey(token),latestKey],[JSON.stringify(p),update.update_id,update.edited_message?'1':'0',ttl,JSON.stringify({token,updateId:update.update_id,hash:createHash('sha256').update(text).digest('hex')})]);
    if (Number(published) !== 1) return {handled:true,result:'duplicate_source'};
    const reply = `Tasdiqlash uchun natija:\n${f.home} ${planned.plan.body.homeScore}:${planned.plan.body.awayScore} ${f.away}\n${f.competition} · ${f.roundName || f.matchday+'-tur'}\n\nHali bazaga yozilmadi. Faqat vakolatli admin tasdiqlaydi.\n24 soat amal qiladi.`;
    const sent = await sendTelegramMessage(m.chat.id,reply,{parse_mode:null,message_thread_id:m.message_thread_id,reply_to_message_id:m.message_id,reply_markup:{inline_keyboard:[[{text:'Tasdiqlash',callback_data:'rs:approve:'+token},{text:'Rad etish',callback_data:'rs:reject:'+token}]]},signal});
    if (sent.ok && Number.isSafeInteger(sent.result?.message_id)) await client.set(proposalKey(token),{...p,deliveredMessage:sent.result.message_id},{ex:ttl});
    else await client.set(proposalKey(token),{...p,state:'delivery_unknown'},{ex:ttl});
    return {handled:true,result:sent.ok?'proposal_sent':'delivery_unknown'};
  } finally { clearTimeout(timer); }
}
