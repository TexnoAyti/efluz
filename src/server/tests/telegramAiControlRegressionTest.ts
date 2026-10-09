import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { planNaturalAdminRequest } from '../services/telegramAiNaturalAdminPlanner';
import { getConversationIntent } from '../services/telegramAiConversationCommands';
import { assertAdminPlanReady } from '../services/telegramAiAdminPlanReadiness';
import { handleAiAdminCommand, rememberDeliveredAdminPlan, setTestAiAdminHooks } from '../services/telegramAiAdminService';
import { setTestConfigOverride, DEFAULT_AI_CONFIG } from '../services/telegramAiConfigService';
import type { AdminPlan } from '../services/telegramAiAdminCatalog';

await initDatabase();
const bridge = await startMockUpstashBridge();
const league = 'comp-premier-league-2026', cup = 'comp-fa-cup-2026';
const comps = [{ id: league, name: 'Premier League', type: 'LEAGUE', seasonId: 'season-2026-27', currentMatchday: 11 }, { id: cup, name: 'FA Cup', type: 'KNOCKOUT', seasonId: 'season-2026-27' }];
const deps = { read: async () => ({ data: comps, total: comps.length, nextOffset: null }), users: async () => [{ id: 'user-12345', username: 'actual_owner', telegramId: '12345' }] };
const signal = new AbortController().signal;
const payload = (text: string, id = 5209126900, dm = false) => ({ updateId: 9911101, messageId: 1, chatId: dm ? id : -1001, threadId: dm ? 0 : 3503, fromUser: { id }, text });
const cases: Array<[string, string, Record<string, unknown>, string?]> = [
  ['AI foydalanuvchi limitini 5 qil', 'ai_config', { rateLimitUserPerMin: 5 }],
  ['AI mavzu limitini 30 qil', 'ai_config', { rateLimitTopicPerMin: 30 }],
  ['AI kunlik limitini 1000 qil', 'ai_config', { maxDailyRequests: 1000 }],
  ['AI limit holatini korsat', 'ai_settings', {}],
  ['APL ligasini pauzaga qoy', 'matchday_override', { overrideStatus: 'PAUSED' }, league],
  ['APL ligasini toxtat', 'matchday_override', { overrideStatus: 'PAUSED' }, league],
  ['APL avtomatik rejimga qaytar', 'matchday_override', { overrideStatus: 'AUTO' }, league],
  ['APL tur muddatini 30 soat qil', 'matchday_timer', { durationHours: 30 }, league],
  ['APL 11 tur muddatini 36 soat belgila', 'matchday_timer', { durationHours: 36, currentMatchday: 11 }, league],
  ['APL 11 turga eslatma yubor', 'matchday_remind', { matchday: 11 }, league],
  ['APL joriy turga eslatma jonat', 'matchday_remind', { matchday: 11 }, league],
  ['APL tur holatini korsat', 'matchday_status', {}, league],
  ['Angliya Kubogi holatini tekshir', 'cup_health', {}, cup],
  ['audit tarixini korsat', 'audit', {}],
  ['platforma holatini tekshir', 'overview', {}],
  ['oqish statistikasi holatini korsat', 'metrics', {}],
  ['oqish statistikasini nolga tushir', 'metrics_reset', {}],
  ['tasdiq kutayotgan natijalarni korsat', 'pending_results', {}],
  ['bahsli natijalarni korsat', 'disputes', {}],
  ['xabarnoma turlari royxatini korsat', 'notification_types', {}],
  ['qabul navbati holatini korsat', 'admission', {}],
  ['yevropa saralashini korib chiq', 'european_preview', {}],
  ['qabul qiluvchilarni yangila', 'recipients_refresh', {}],
  ['elon id: broadcast-123 qayta yubor', 'broadcast_retry', {}, 'broadcast-123'],
  ['hammaga "11-tur ochildi" deb xabar yubor', 'broadcast', { title: 'EFL UZ', body: '11-tur ochildi', targetAudience: 'ALL_USERS' }],
  ['@actual_owner ga “Yangi tur” deb xabar yubor', 'broadcast', { title: 'EFL UZ', body: 'Yangi tur', targetAudience: 'SELECTED_RECIPIENTS', selectedUserIds: ['user-12345'], expectedUsername: 'actual_owner' }],
];
const db = getFirestoreDb(), original = db.collection.bind(db);
let firestore = 0; const executed: AdminPlan[] = [];
db.collection = (() => { firestore++; throw new Error('NO_FIRESTORE_FOR_PLANNING'); }) as any;
try {
  for (const [text, action, body, targetId] of cases) {
    assert.equal(getConversationIntent(text), 'admin', text);
    const plan = await planNaturalAdminRequest(text, deps);
    assert.equal(plan?.action, action, text); assert.deepEqual(plan?.body, body, text); assert.equal(plan?.targetId, targetId, text); assertAdminPlanReady(plan!);
  }
  for (const text of ['AI limitini 5 qil','AI foydalanuvchi limitini 100 qil','AI foydalanuvchi limitini -1 qil','AI foydalanuvchi limitini 2.5 qil','AI foydalanuvchi va mavzu limitini 5 qil','AI kunlik limitini 0 qil','APL tur muddatini -30 soat qil','APL tur muddatini 2.5 soat qil','APL eslatma yubor','Angliya Kubogi tur muddatini 30 soat qil','elon qayta yubor','AI foydalanuvchi limitini 5 qilma','APL ligasini toxtatma','qabul qiluvchilarni yangilama','AI foydalanuvchi limitini 5 qil keyin APL ligasini toxtat','"@actual_owner salom" deb xabar yubor'])
    await assert.rejects(planNaturalAdminRequest(text, deps), /CLARIFY/, text);
  assert.throws(() => assertAdminPlanReady({ action: 'ai_config', body: { rateLimitUserPerMin: 100 } }), /CLARIFY/);
  assert.throws(() => assertAdminPlanReady({ action: 'ai_config', body: {} }), /CLARIFY/);
  await redisSetRaw(ReadModelKeys.competitions('season-2026-27'), { data: comps });
  await redisSetRaw(ReadModelKeys.clubsWithOwners('season-2026-27'), { data: [] });
  // The generic HTTP bridge does not execute confirmation Lua. Use the existing
  // test-only pending store here; concurrency is tested by the real-Redis suite.
  for (const key of Object.keys(process.env).filter(k => /REDIS|KV_REST/.test(k))) delete process.env[key];
  setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503 });
  setTestAiAdminHooks(async plan => { executed.push(plan); return { status: 200, data: { success: true, title: 'Audit record', apiKey: 'SECRET_NEVER_PRINT' } }; });
  const request = payload('AI foydalanuvchi limitini 5 qil');
  const preview = await handleAiAdminCommand(request, signal);
  assert.match(preview, /Foydalanuvchi uchun so‘rov\/daqiqa: 5/); assert.ok(!/Yordamchi: o‘chirish/.test(preview)); assert.equal(executed.length, 0);
  await rememberDeliveredAdminPlan(request, preview, 900, signal);
  const token = /\/ai_confirm ([a-f0-9]{24})/.exec(preview)![1];
  assert.match(await handleAiAdminCommand(payload('/ai_confirm ' + token, 7573478198), signal), /Reja topilmadi|asosiy admin/); assert.equal(executed.length, 0);
  assert.match(await handleAiAdminCommand(payload('/ai_confirm ' + token), signal), /Bajarildi/); assert.equal(executed.length, 1); assert.deepEqual(executed[0].body, { rateLimitUserPerMin: 5 });
  assert.match(await handleAiAdminCommand(payload('/ai_confirm ' + token), signal), /Bajarildi|allaqachon/); assert.equal(executed.length, 1);
  assert.match(await handleAiAdminCommand(payload('audit tarixini korsat'), signal), /shaxsiy chat/); assert.equal(executed.length, 1);
  const audit = await handleAiAdminCommand(payload('audit tarixini korsat', 5209126900, true), signal);
  assert.match(audit, /Admin amallari tarixi/); assert.ok(!audit.includes('SECRET_NEVER_PRINT')); assert.equal(executed.at(-1)?.action, 'audit');
  assert.ok(!/\/ai_confirm/.test(await handleAiAdminCommand(payload('AI mavzu limitini 30 qil', 7573478198), signal)));
  assert.ok(!/\/ai_confirm/.test(await handleAiAdminCommand(payload('APL ligasini pauzaga qoy', 123), signal)));
  assert.equal(firestore, 0);
  console.log(`PASS ${cases.length} additional control requests, 16 invalid/ambiguous/negated requests, precise limit preview, delivered owner confirmation, once-only mocked execution, private read and secret filtering; zero model/Firestore, no real messages/mutations`);
} finally { db.collection = original; setTestAiAdminHooks(); setTestConfigOverride(null); await bridge.close(); }
