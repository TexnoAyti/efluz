import assert from 'node:assert/strict';
import { generateGroundedTelegramAnswer } from '../services/telegramAiReadTools';
import { inspectAiAdminOutcome } from '../services/telegramAiAdminOutcome';
import { parseAiPlanRevision } from '../services/telegramAiPlanRevision';
import { createAiAdminRecordResolver } from '../services/telegramAiAdminRecordResolver';
import { validateModelAdminPlan } from '../services/telegramAiAdminPlanReadiness';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { redisSetRaw, ReadModelKeys } from '../readModel/readModelStore';
import { handleAiAdminCommand, setTestAiAdminHooks, rememberDeliveredAdminPlan } from '../services/telegramAiAdminService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';

const signal = new AbortController().signal;
const modelCall = (name: string, args: any) => ({ functionCalls: [{ name, args }], candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args }, thoughtSignature: 'signature' }] } }] });
const events: string[] = [], originalInfo = console.info;
console.info = (...args: any[]) => { events.push(args.join(' ')); };
let generations = 0, reads = 0;
try {
 const answer = await generateGroundedTelegramAnswer({ ai: {} as any, model: 'test', signal, contents: [], systemPrompt: 'test', maxToolRounds: 3,
  read: async () => { reads++; return { data: [{ id: 'PRIVATE_USER_DATA' }], complete: true, offset: 0, nextOffset: null }; },
  generate: async request => {
   generations++;
   if (generations < 3) return modelCall('read_tournament_data', { dataset: 'clubs', club: 'PRIVATE_QUERY' });
   assert.equal(request.contents.at(-1).parts[0].functionResponse.response.result.data[0].id, 'PRIVATE_USER_DATA');
   return { text: 'Verified' };
  },
 });
 assert.equal(answer, 'Verified'); assert.equal(reads, 1); assert.ok(events.some(line => line.includes('"cacheHits":1')));
 assert.ok(!events.join('').includes('PRIVATE_'));
 generations = 0;
 const recovered = await generateGroundedTelegramAnswer({ ai: {} as any, model: 'test', signal, contents: [], systemPrompt: 'test',
  read: async args => { if ((args as any).dataset === 'fixtures') throw new Error('secret credential=DO_NOT_LOG'); return { data: [{ name: 'Arsenal' }], complete: true }; },
  generate: async request => {
   generations++;
   if (generations === 1) return modelCall('read_tournament_data', { dataset: 'fixtures' });
   if (generations === 2) { assert.equal(request.contents.at(-1).parts[0].functionResponse.response.result.error, 'READ_UNAVAILABLE'); return modelCall('read_tournament_data', { dataset: 'clubs' }); }
   assert.equal(request.contents.at(-1).parts[0].functionResponse.response.result.data[0].name, 'Arsenal');
   return { text: 'Arsenal topildi; o‘yinlar manbasi o‘qilmadi.' };
  },
 });
 assert.match(recovered, /Arsenal/); assert.ok(!events.join('').includes('DO_NOT_LOG'));
 const aborted = new AbortController(); aborted.abort();
 await assert.rejects(generateGroundedTelegramAnswer({ ai: {} as any, model: 'test', signal: aborted.signal, contents: [], systemPrompt: 'test', generate: async () => ({ text: 'must not run' }) }), /TIMEOUT_ABORTED/);
} finally { console.info = originalInfo; }
assert.deepEqual(parseAiPlanRevision('yo‘q, hisob 3–1 bo‘lsin'), { kind: 'score', first: 3, second: 1 });
const plan = { action: 'result_edit', targetId: 'game', body: { homeScore: 1, awayScore: 5, status: 'CONFIRMED' } };
assert.equal(inspectAiAdminOutcome(plan, { pendingSync: true, success: true }).state, 'queued');
assert.equal(inspectAiAdminOutcome(plan, { fixture: { pendingSync: true } }).state, 'queued');
assert.equal(inspectAiAdminOutcome(plan, { authoritative: false }).state, 'unverified');
assert.equal(inspectAiAdminOutcome(plan, { fixture: { id: 'game', homeScore: 5, awayScore: 1, status: 'CONFIRMED' } }).state, 'unverified');
assert.equal(inspectAiAdminOutcome(plan, { fixture: { id: 'game', homeScore: 1, awayScore: 5, status: 'CONFIRMED' } }).state, 'verified');
assert.equal(inspectAiAdminOutcome(plan, { success: true }).state, 'accepted');

const bridge = await startMockUpstashBridge();
const season = 'season-2026-27', comp = 'comp-premier-league-2026';
const payload = { updateId: 9001, messageId: 9001, chatId: 5209126900, threadId: 0, fromUser: { id: 5209126900 }, text: '' };
try {
 const snapshot = (data: any) => ({ data, generatedAt: new Date().toISOString() });
 await redisSetRaw(ReadModelKeys.competitions(season), snapshot([{ id: comp, name: 'Premier League', seasonId: season, type: 'LEAGUE' }]));
 await redisSetRaw(ReadModelKeys.clubsWithOwners(season), snapshot([{ id: 'club-arsenal', name: 'Arsenal' }, { id: 'club-chelsea', name: 'Chelsea' }]));
 await redisSetRaw(ReadModelKeys.competitionFixtures(comp, season), snapshot([{ id: 'game', seasonId: season, competitionId: comp, homeClubId: 'club-arsenal', awayClubId: 'club-chelsea', matchday: 11, status: 'DISPUTED' }]));
 const request = 'Arsenal Chelsea 11-tur nizosini hal qil';
 let calls = 0;
 const resolver = createAiAdminRecordResolver(payload, request, signal, async () => { calls++; return { status: 200, data: { disputes: [{ id: 'dispute-real', fixtureId: 'game', status: 'OPEN', privateToken: 'SECRET' }] } }; });
 const result: any = await resolver.tools[0].run({ dataset: 'disputes', fixtureId: 'game' });
 assert.equal(result.id, 'dispute-real'); assert.ok(!JSON.stringify(result).includes('SECRET'));
 await resolver.tools[0].run({ dataset: 'disputes', fixtureId: 'game' }); assert.equal(calls, 1);
 const disputePlan = { action: 'dispute_resolve', targetId: 'dispute-real', body: { action: 'CONFIRM_HOME_SUBMISSION' } };
 await validateModelAdminPlan(disputePlan, request, signal, resolver.verifiedTargets);
 await assert.rejects(validateModelAdminPlan(disputePlan, request, signal), /aniq ID/);
 await assert.rejects(validateModelAdminPlan({ ...disputePlan, action: 'submission_delete' }, request, signal, resolver.verifiedTargets), /aniq ID/);
 assert.equal(createAiAdminRecordResolver({ ...payload, chatId: -1001, threadId: 3503 }, request, signal).tools.length, 0);
 for (const data of [ { disputes: [{ id: 'a', fixtureId: 'game', status: 'OPEN' }, { id: 'b', fixtureId: 'game', status: 'OPEN' }] }, { disputes: [{ id: 'a', fixtureId: 'game', status: 'OPEN' }], stale: true } ]) {
   const ambiguous = createAiAdminRecordResolver(payload, request, signal, async () => ({ status: 200, data }));
   assert.ok((await ambiguous.tools[0].run({ dataset: 'disputes', fixtureId: 'game' })).error);
   assert.equal(ambiguous.verifiedTargets.size, 0);
 }
 const wrong = createAiAdminRecordResolver(payload, 'Arsenal Chelsea 12-tur nizosini hal qil', signal, async () => { throw new Error('must not query'); });
 await assert.rejects(wrong.tools[0].run({ dataset: 'disputes', fixtureId: 'game' }), /turga mos kelmadi/);
 setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503 });
 let writes = 0;
 setTestAiAdminHooks(async () => { writes++; return { status: 200, data: { success: true, pendingSync: true } }; }, async () => plan);
 const p = { ...payload, text: '/ai_admin test' };
 const preview = await handleAiAdminCommand(p, signal);
 await rememberDeliveredAdminPlan(p, preview, 1234, signal);
 const completed = await handleAiAdminCommand({ ...payload, text: 'tasdiqlayman' }, signal);
 assert.match(completed, /navbatiga saqlandi/); assert.ok(!completed.includes('Bajarildi'));
 await handleAiAdminCommand({ ...payload, text: 'tasdiqlayman' }, signal); assert.equal(writes, 1);
} finally { setTestAiAdminHooks(); setTestConfigOverride(null); await bridge.close(); }
console.log('PASS Unicode score order, tool recovery/memo/privacy, authoritative receipt verification, private record resolution and queued confirmation replay');
