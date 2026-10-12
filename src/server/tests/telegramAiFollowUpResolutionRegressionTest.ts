import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { redisSetRaw, ReadModelKeys } from '../readModel/readModelStore';
import { resolveAiClubs, replaceAiClubChoice } from '../services/telegramAiEntities';
import { continueAiAdminClarification } from '../services/telegramAiAdminClarification';
import { saveAiAdminDraft, rememberDeliveredAiAdminDraft, getDeliveredAiAdminDraft, clearAiAdminDraft } from '../services/telegramAiAdminDraft';
import { handleTelegramAiMessage, clearTestAiState } from '../services/telegramAiService';
import { setTestAiAdminHooks, setTestAiAdminModelGenerator } from '../services/telegramAiAdminService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import { setTestGroundingOverride } from '../services/telegramAiGroundingService';

const clubs = [
  { id: 'arsenal', name: 'Arsenal', leagueId: 'league-premier-league' },
  { id: 'ipswich', name: 'Ipswich Town', leagueId: 'league-premier-league' },
  { id: 'city', name: 'Manchester City', leagueId: 'league-premier-league' },
  { id: 'united', name: 'Manchester United', leagueId: 'league-premier-league' },
  { id: 'heidenheim', name: '1. FC Heidenheim 1846', leagueId: 'league-bundesliga' },
];
for (const text of ['Arsenl', 'Arsenla', 'Arsenlni', 'Arsenlga']) {
  const resolution = resolveAiClubs(text, clubs as any);
  assert.equal(resolution.clubs.length, 0, 'Typos require target clarification');
  assert.equal(resolution.clubChoices?.[0].id, 'arsenal', text);
  const request = text + ' egasini bo‘shat';
  assert.match(continueAiAdminClarification({ request, question: resolution.clarification!, clubChoices: resolution.clubChoices }, 'ha')!, /Arsenal/);
}
assert.equal(resolveAiClubs('haydenhaym', clubs as any).clubs[0].id, 'heidenheim', 'Alias families survive alternate IDs and formatted names');
assert.equal(resolveAiClubs('Man United', clubs as any).clubs[0].id, 'united');
const typo = resolveAiClubs('Arsenlni', clubs as any);
assert.equal(replaceAiClubChoice('@Arsenl “Arsenlni” Arsenlni biriktir', typo.clubChoices![0]), '@Arsenl “Arsenlni” Arsenalni biriktir');
for (const answer of ['yo‘q', 'Arsenalni o‘chir', '@other_owner', 'ha; blokla', 'ha\nArsenal', '2-1'])
  assert.equal(continueAiAdminClarification({ request: 'Arsenlni bo‘shat', question: typo.clarification!, clubChoices: typo.clubChoices }, answer), null, answer);
const ambiguous = resolveAiClubs('Manchesterga biriktir', clubs as any);
assert.equal(ambiguous.clubChoices?.length, 2);
assert.equal(continueAiAdminClarification({ request: '@actual_owner Manchesterga biriktir', question: ambiguous.clarification!, clubChoices: ambiguous.clubChoices }, 'ha'), null);
assert.equal(continueAiAdminClarification({ request: '@actual_owner Manchesterga biriktir', question: ambiguous.clarification!, clubChoices: ambiguous.clubChoices }, '2'), '@actual_owner Manchester Unitedga biriktir');
assert.equal(continueAiAdminClarification({ request: '@actual_owner Manchesterga biriktir', question: ambiguous.clarification!, clubChoices: ambiguous.clubChoices }, 'ikkinchisi'), '@actual_owner Manchester Unitedga biriktir');
assert.match(continueAiAdminClarification({ request: 'Arsenlni bo‘shat', question: typo.clarification!, clubChoices: typo.clubChoices }, 'xa o‘sha')!, /Arsenalni/);
assert.equal(continueAiAdminClarification({ request: 'Arsenal 1-1 Ipswich', question: 'Bir nechta o‘yin topildi. Tur yoki turnirni yozing.' }, 'APL'), 'Arsenal 1-1 Ipswich APL');

await initDatabase();
const bridge = await startMockUpstashBridge();
const season = 'season-2026-27', league = 'comp-premier-league-2026';
const signal = new AbortController().signal;
const db = getFirestoreDb(), originalCollection = db.collection.bind(db), originalFetch = global.fetch;
let update = 9950000, writes = 0, models = 0, reads = 0;
const sent: any[] = [];
const p = (text: string, extra: Record<string, unknown> = {}) => ({ updateId: ++update, messageId: update, chatId: -1001, threadId: 3503, fromUser: { id: 5209126900 }, text, ...extra });
db.collection = (() => { reads++; throw new Error('NO_FIRESTORE'); }) as any;
try {
  process.env.TELEGRAM_BOT_TOKEN = '777:followup-resolution-test';
  await redisSetRaw(ReadModelKeys.competitions(season), { data: [{ id: league, name: 'Premier League', type: 'LEAGUE', seasonId: season, leagueId: 'league-premier-league', currentMatchday: 11 }] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: clubs });
  await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: [{ id: 'game-11', competitionId: league, seasonId: season, matchday: 11, status: 'SCHEDULED', homeClubId: 'arsenal', awayClubId: 'ipswich' }] });
  setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503, rateLimitUserPerMin: 20, rateLimitTopicPerMin: 60 });
  setTestAiAdminHooks(async plan => { writes++; assert.equal(plan.targetId, 'arsenal'); return { status: 200, data: { success: true } }; });
  setTestAiAdminModelGenerator(async () => { models++; throw new Error('MUST_NOT_NEED_MODEL'); });
  global.fetch = async (input: any, init?: any) => {
    if (String(input).includes('api.telegram.org')) return { ok: true, json: async () => {
      sent.push(JSON.parse(init.body)); return { ok: true, result: { message_id: 10000 + sent.length } };
    } } as any;
    const body = init?.body ? JSON.parse(init.body) : null;
    const command = Array.isArray(body?.[0]) ? body[0] : body;
    if (command?.[0]?.toLowerCase() === 'eval' && String(command[1]).includes('local userKey'))
      return new Response(JSON.stringify(Array.isArray(body?.[0]) ? [{ result: [1, 'OK', 1] }] : { result: [1, 'OK', 1] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return originalFetch(input, init);
  };
  clearTestAiState();
  async function send(text: string, extra: Record<string, unknown> = {}) {
    const result = await handleTelegramAiMessage(p(text, extra));
    assert.equal(result.replySent, true, text + JSON.stringify(result));
    return sent.at(-1);
  }
  assert.match((await send('@actual_owner Arsenlni biriktir')).text, /Arsenal.*Ha/s);
  assert.equal(writes, 0);
  assert.match((await send('ha', { replyToMessage: { message_id: 10000 + sent.length, from: { id: 777 } } })).text, /Reja:.*Arsenal.*actual_owner/s);
  assert.equal(writes, 0, 'Choosing a spelling does not confirm the resulting plan');
  assert.match((await send('tasdiqlayman')).text, /Bajarildi/);
  assert.equal(writes, 1);
  await send('tasdiqlayman'); assert.equal(writes, 1);

  assert.match((await send('Ipsvich 1-2 Arsenl APL')).text, /Arsenal/);
  assert.match((await send('Arsenal')).text, /Arsenal 2:1 Ipswich Town/);
  assert.match((await send('Arsenl 1-1 Ipswih APL')).text, /Arsenal/);
  assert.match((await send('ha')).text, /Ipswich/);
  assert.match((await send('ha')).text, /Reja:.*Arsenal 1:1 Ipswich Town/s);
  assert.match((await send('@actual_owner Manchesterga biriktir')).text, /Manchester City.*Manchester United/s);
  assert.ok(!(await send('ha', { replyToMessage: { message_id: 10000 + sent.length, from: { id: 777 } } })).reply_markup, 'Ambiguous yes cannot execute an older plan');
  assert.match((await send('2')).text, /Reja:.*Manchester United/s);
  assert.equal(writes, 1);

  const request = p('Arsenal 1-1 Ipswich APL');
  const longQuestion = 'Bir nechta o‘yin topildi. Qaysi biri? ' + 'Arsenal — Ipswich Town, Premier League; '.repeat(12) + ' Tur yoki turnirni yozing.';
  assert.ok(longQuestion.length > 350);
  await saveAiAdminDraft(request, request.text, longQuestion, signal);
  assert.equal(await getDeliveredAiAdminDraft(request, signal), null);
  await rememberDeliveredAiAdminDraft(request, longQuestion, 9999, signal);
  assert.ok(await getDeliveredAiAdminDraft(request, signal), 'The whole delivered long question must remain continuable');
  assert.equal(await getDeliveredAiAdminDraft({ ...request, fromUser: { id: 7573478198 } }, signal), null);
  assert.equal(await getDeliveredAiAdminDraft({ ...request, threadId: 3504 }, signal), null);
  assert.equal(await getDeliveredAiAdminDraft({ ...request, replyToMessage: { message_id: 9998, from: { id: 777 } } }, signal), null);
  assert.match((await send('11')).text, /Reja:.*11-tur.*Arsenal 1:1 Ipswich Town/s);
  setTestGroundingOverride({ clubs: clubs.map(c => ({ ...c, ownerUserId: 'owner-' + c.id, ownerUsername: c.id + '_owner' })) as any, competitions: [], standings: {}, fixtures: {} });
  const publicActor = { fromUser: { id: 778899 } };
  assert.match((await send('Arsenl egasi kim?', publicActor)).text, /Arsenal/);
  assert.match((await send('ha', { ...publicActor, replyToMessage: { message_id: 10000 + sent.length, from: { id: 777 } } })).text, /Arsenal egasi: @arsenal_owner/);
  assert.match((await send('Manchester egasi kim?', publicActor)).text, /Manchester City.*Manchester United/s);
  assert.match((await send('MYU', publicActor)).text, /Manchester United egasi: @united_owner/);
  assert.equal(await getDeliveredAiAdminDraft(p('ha', publicActor), signal), null, 'Public spelling choices never create admin authority');
  assert.equal(writes, 1); assert.equal(models, 0); assert.equal(reads, 0);
  console.log('PASS delivered long clarifications, typo/suffix/alias choices, sequential repairs, score order, ambiguous choice, actor/topic/reply isolation and separate one-time execution confirmation; no real model, Telegram or database writes');
} finally {
  await clearAiAdminDraft(p(''), signal);
  global.fetch = originalFetch; db.collection = originalCollection;
  setTestAiAdminHooks(); setTestAiAdminModelGenerator(); setTestConfigOverride(null);
  setTestGroundingOverride(null);
  await bridge.close();
}
