import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { ReadModelKeys, redisSetRaw, getFreshKey, getLkgKey } from '../readModel/readModelStore';
import { createAiTournamentReader } from '../services/telegramAiDataService';
import { generateGroundedTelegramAnswer } from '../services/telegramAiReadTools';
import { handleAiAdminCommand, setTestAiAdminHooks, rememberDeliveredAdminPlan, isOwnerAdminPrivateChat } from '../services/telegramAiAdminService';
import { adminPlanSchema } from '../services/telegramAiAdminCatalog';
import { executeAiAdminRoute } from '../services/telegramAiAdminGateway';
import { setTestConfigOverride, DEFAULT_AI_CONFIG } from '../services/telegramAiConfigService';
import { handleTelegramAiMessage, clearTestAiState, type TelegramAiMessagePayload } from '../services/telegramAiService';
import { clearTestRateLimitState } from '../services/telegramAiRateLimitService';

await initDatabase();
const season = 'season-2026-27', league = 'comp-premier-league-2026', cup = 'comp-fa-cup-2026', supercup = 'comp-community-shield-2026';
const bridge = await startMockUpstashBridge();
const newer = '2026-10-05T12:00:00Z';
const comp = (id: string, name: string, type: string) => ({ id, name, type, seasonId: season, leagueId: 'league-premier-league', formatConfig: {} });
const fixture = (id: string, competitionId: string, matchday: number, status = 'CONFIRMED') => ({ id, competitionId, seasonId: season, matchday, status, homeClubId: 'club-arsenal', awayClubId: 'club-chelsea', homeScore: 2, awayScore: 1, proofUrl: 'PRIVATE_PROOF', submittedByUserId: 'PRIVATE_USER', homeOwner: { telegramId: 'PRIVATE_TG' } });
await redisSetRaw(ReadModelKeys.competitions(season), { data: [comp(league, 'Premier League', 'LEAGUE'), comp(cup, 'FA Cup', 'KNOCKOUT'), comp(supercup, 'Community Shield', 'SUPER_CUP')], generatedAt: newer });
await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: [{ id: 'club-arsenal', name: 'Arsenal', leagueId: 'league-premier-league', ownerUserId: 'PRIVATE_USER', ownerUsername: 'actual_owner', telegramId: 'PRIVATE_TG' }, { id: 'club-chelsea', name: 'Chelsea', leagueId: 'league-premier-league', ownerUserId: null }], generatedAt: newer });
await redisSetRaw(ReadModelKeys.adminFixtures(season), { data: [fixture('old-draw', cup, 4), fixture('old-score', league, 1)], generatedAt: '2026-10-04T10:00:00Z' });
await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: Array.from({ length: 35 }, (_, i) => fixture('league-' + i, league, i + 1)), generatedAt: newer });
await redisSetRaw(ReadModelKeys.competitionFixtures(cup, season), { data: [{ ...fixture('semi', cup, 4, 'SCHEDULED'), roundName: 'Semi-Finals' }, fixture('deleted', cup, 3), { ...fixture('foreign', cup, 3), seasonId: 'season-2025-26' }], generatedAt: newer });
await redisSetRaw(ReadModelKeys.competitionFixtures(supercup, season), { data: [fixture('super-final', supercup, 1)], generatedAt: newer });
await redisSetRaw(ReadModelKeys.standings(league, season), { data: [{ clubId: 'club-arsenal', clubName: 'Arsenal', points: 12, position: 1, played: 4, won: 4, drawn: 0, lost: 0, goalsFor: 8, goalsAgainst: 4, goalDifference: 4, privateField: 'PRIVATE_STATS' }], generatedAt: newer });
await redisSetRaw(`efluz:v1:season:${season}:fixture-tombstones`, { data: [{ fixtureId: 'deleted' }], generatedAt: newer });
const db = getFirestoreDb(), collection = db.collection.bind(db);
let firestoreCalls = 0;
db.collection = (() => { firestoreCalls++; throw new Error('RESOURCE_EXHAUSTED'); }) as any;
try {
  const reader = createAiTournamentReader();
  const semis: any = await reader.read({ dataset: 'fixtures', competition: 'Angliya Kubogi', stage: 'yarim final' });
  assert.equal(semis.total, 1); assert.equal(semis.data[0].id, 'semi'); assert.equal(semis.data[0].homeScore, null);
  const sup: any = await reader.read({ dataset: 'fixtures', competition: 'Angliya superkubogi' }); assert.equal(sup.data[0].id, 'super-final');
  const byOwner: any = await reader.read({ dataset: 'clubs', ownerUsername: '@actual_owner' }); assert.equal(byOwner.total, 1); assert.equal(byOwner.data[0].name, 'Arsenal');
  const page: any = await reader.read({ dataset: 'fixtures', competition: league, matchday: 28 }); assert.equal(page.total, 1); assert.equal(page.data[0].matchday, 28);
  const table: any = await reader.read({ dataset: 'standings', competition: league, club: 'Arsenal' }); assert.equal(table.data[0].points, 12);
  const stats: any = await reader.read({ dataset: 'statistics', club: 'Arsenal' }); assert.equal(stats.data.find((x: any) => x.competition === 'Premier League').won, 35);
  const first: any = await reader.read({ dataset: 'fixtures', competition: league, limit: 30 }); assert.equal(first.total, 35); assert.equal(first.nextOffset, 30);
  const next: any = await reader.read({ dataset: 'fixtures', competition: league, limit: 30, offset: 30 }); assert.equal(next.data.length, 5); assert.equal(next.nextOffset, null);
  assert.equal((await reader.read({ dataset: 'users' }) as any).error, 'INVALID_QUERY');
  assert.equal((await reader.read({ dataset: 'fixtures', club: 'Missing FC' }) as any).error, 'ENTITY_NOT_FOUND');
  for (const result of [semis, sup, byOwner, page, table, stats, first, next]) assert.ok(!JSON.stringify(result).includes('PRIVATE_'));
  assert.equal(firestoreCalls, 0);
  bridge.store.delete(getFreshKey(ReadModelKeys.competitions(season)));
  assert.equal((await createAiTournamentReader().read({ dataset: 'competitions' }) as any).stale, true);
  bridge.store.delete(getLkgKey(ReadModelKeys.competitions(season)));
  assert.ok((await createAiTournamentReader().read({ dataset: 'competitions' }) as any).missingDatasets.length);
  console.log('PASS all-season Redis reads, supercup aliases, exact late matchday, stage, owner, statistics, pagination, stale/missing truth, public field projection; zero Firestore');
} finally { db.collection = collection; await bridge.close(); }

let generations = 0, queries = 0;
const signal = new AbortController().signal;
const answer = await generateGroundedTelegramAnswer({ ai: {} as any, model: 'mock', contents: [], systemPrompt: 'test', signal,
  generate: async request => {
    generations++;
    if (generations === 1) return { functionCalls: [{ name: 'read_tournament_data', args: { dataset: 'fixtures', matchday: 28 } }], candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'read_tournament_data', args: { dataset: 'fixtures', matchday: 28 } }, thoughtSignature: 'keep-signature' }] } }] };
    assert.ok(!request.config.tools); assert.equal(request.contents[0].parts[0].thoughtSignature, 'keep-signature');
    assert.equal(request.contents[1].parts[0].functionResponse.response.result.total, 1);
    return { text: 'Arsenal — Chelsea, 28-tur.' };
  }, read: async () => { queries++; return { total: 1 }; },
});
assert.equal(answer, 'Arsenal — Chelsea, 28-tur.'); assert.equal(queries, 1); assert.equal(generations, 2);
await generateGroundedTelegramAnswer({ ai: {} as any, model: 'mock', contents: [], systemPrompt: '', signal, generate: async () => ({ functionCalls: [{ name: 'delete_user', args: {} }] }), read: async () => { throw new Error('Must not run'); } });
console.log('PASS read-tool model round-trip, signatures retained, arbitrary write tool rejected');

// Bridge credentials removed: isolated test-only store, never a production fallback.
for (const key of Object.keys(process.env).filter(k => /REDIS|KV_REST/.test(k))) delete process.env[key];
setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503 });
const payload = (text: string, id = 5209126900, extra = {}): TelegramAiMessagePayload => ({ updateId: 100, messageId: 1, chatId: -1001, threadId: 3503, fromUser: { id }, text, ...extra });
let writes = 0, plans = 0;
setTestAiAdminHooks(async () => { writes++; return { status: 200, data: { success: true } }; }, async () => { plans++; return { action: 'club_assign', targetId: 'club-arsenal', body: { targetUserId: '@actual_owner' } }; });
assert.match(await handleAiAdminCommand(payload('/ai_admin Arsenalni biriktir', 123), signal), /faqat asosiy admin/);
assert.match(await handleAiAdminCommand(payload('/ai_admin Arsenalni biriktir', 5209126900, { senderChat: true }), signal), /faqat asosiy admin/);
assert.match(await handleAiAdminCommand(payload('/ai_admin Arsenalni biriktir', 5209126900, { forwarded: true }), signal), /faqat asosiy admin/);
assert.equal(plans, 0); assert.equal(writes, 0);
const proposal = await handleAiAdminCommand(payload('/ai_admin Arsenalni biriktir'), signal);
const token = /\/ai_confirm ([a-f0-9]{24})/.exec(proposal)![1]; assert.equal(writes, 0);
assert.match(await handleAiAdminCommand(payload('/ai_confirm ' + token, 123), signal), /faqat asosiy admin/);
assert.match(await handleAiAdminCommand(payload('/ai_confirm ' + token, 5209126900, { threadId: 7 }), signal), /faol emas/);
await Promise.all(Array.from({ length: 5 }, () => handleAiAdminCommand(payload('/ai_confirm ' + token), signal))); assert.equal(writes, 1);
const cancel = await handleAiAdminCommand(payload('/ai_admin Arsenalni biriktir'), signal); const cancelledToken = /\/ai_confirm ([a-f0-9]{24})/.exec(cancel)![1];
await handleAiAdminCommand(payload('/ai_cancel ' + cancelledToken), signal); await handleAiAdminCommand(payload('/ai_confirm ' + cancelledToken), signal); assert.equal(writes, 1);
setTestAiAdminHooks(async () => { writes++; throw new Error('DB timeout'); });
const timeout = await handleAiAdminCommand(payload('/ai_admin {"action":"club_release","targetId":"club-arsenal"}'), signal); const timeoutToken = /\/ai_confirm ([a-f0-9]{24})/.exec(timeout)![1];
assert.match(await handleAiAdminCommand(payload('/ai_confirm ' + timeoutToken), signal), /yakuniy holatini/); await handleAiAdminCommand(payload('/ai_confirm ' + timeoutToken), signal); assert.equal(writes, 2);
assert.match(await handleAiAdminCommand(payload('/ai_read {"action":"users"}'), signal), /shaxsiy chat/);
for (const invalid of [{ action: 'shell' }, { action: 'fixture_delete', targetId: '../users/1', body: {} }, { action: 'club_assign', targetId: 'club-arsenal', path: '/webhook' }]) assert.equal(adminPlanSchema.safeParse(invalid).success, false);
setTestAiAdminHooks();
console.log('PASS owner-only planning, anonymous/forward rejection, scoped confirmations, concurrent at-most-once writes, cancellation, unknown outcome, private reads, arbitrary path rejection');

// Complete AI dispatcher for owner DM and rejected outsider DM; Telegram fetch is mocked.
clearTestAiState(); clearTestRateLimitState();
setTestAiAdminHooks(async () => ({ status: 200, data: { users: [{ id: 'private-user', isAdmin: false }] } }));
process.env.TELEGRAM_BOT_TOKEN = '123456:isolated-full-access-test';
const originalFetch = global.fetch;
const sent: any[] = [];
global.fetch = async (input: any, init?: any) => {
  if (String(input).includes('api.telegram.org')) { const body = JSON.parse(init?.body); sent.push(body); return { ok: true, json: async () => ({ ok: true, result: { message_id: 60000 + sent.length } }) } as any; }
  return originalFetch(input, init);
};
try {
  const dm = payload('/ai_read {"action":"users","body":{"search":"test"}}', 5209126900, { chatId: 5209126900, threadId: 0, updateId: 8000 });
  assert.equal((await handleTelegramAiMessage(dm)).replySent, true);
  assert.equal(sent[0].chat_id, 5209126900); assert.ok(!sent[0].message_thread_id);
  assert.equal((await handleTelegramAiMessage({ ...dm, fromUser: { id: 123 }, chatId: 123, updateId: 8001 })).ignored, 'topic_not_authorized');
  assert.equal(sent.length, 1);
} finally { global.fetch = originalFetch; setTestAiAdminHooks(); }
console.log('PASS complete AI dispatch: private read sent to verified owner DM only, outsider blocked, Telegram transport mocked');

// Explicit AI delegation supports isolated plans and binds confirmation to the actor.
setTestAiAdminHooks(async()=>({status:200,data:{success:true}}),async()=>({action:'result_edit',targetId:'league-1',body:{homeScore:5,awayScore:1,status:'CONFIRMED'}}));
const delegatedPayload=payload('Arsenal 5-1 Chelsea 2-tur natijasini saqla',7573478198);
const delegatedPreview=await handleAiAdminCommand(delegatedPayload,signal);
assert.match(delegatedPreview,/ai_confirm/);
await rememberDeliveredAdminPlan(delegatedPayload,delegatedPreview,90001,signal);
const delegatedToken=/ai_confirm ([a-f0-9]{24})/.exec(delegatedPreview)![1];
assert.match(await handleAiAdminCommand(payload('/ai_confirm '+delegatedToken,5209126900),signal),/tegishli emas/);
assert.match(await handleAiAdminCommand({...delegatedPayload,text:'tasdiqlayman'},signal),/Bajarildi/);
assert.equal(isOwnerAdminPrivateChat(payload('/ai_actions',7573478198,{chatId:7573478198,threadId:0})),true);
assert.equal(isOwnerAdminPrivateChat(payload('/ai_actions',123,{chatId:123,threadId:0})),false);
setTestAiAdminHooks(undefined,async()=>({action:'fixture_delete',targetId:'league-1',body:{reason:'test'}}));
assert.match(await handleAiAdminCommand(delegatedPayload,signal),/faqat asosiy admin/);
setTestAiAdminHooks();

// Exercise the actual gateway and original middleware/route, not a mocked executor.
const owner = 'user-5209126900';
await db.collection('users').doc(owner).set({ id: owner, telegramId: '5209126900', isAdmin: true, isSuspended: false, adminPermissions: { scope: 'ALL', leagueIds: [] } });
await db.collection('users').doc('test-target').set({ id: 'test-target', telegramId: '123', username: 'actual_owner', isAdmin: false, isSuspended: false });
const changed = await executeAiAdminRoute({ action: 'user_suspend', targetId: 'test-target', body: { isSuspended: true, reason: 'isolated regression', expectedUsername: 'actual_owner' } }, 5209126900, 'test-operation', signal);
assert.equal(changed.status, 200, JSON.stringify(changed.data));
assert.equal((await db.collection('users').doc('test-target').get()).data()?.isSuspended, true);
const staleIdentity = await executeAiAdminRoute({action:'user_suspend',targetId:'test-target',body:{isSuspended:false,expectedUsername:'old_owner'}},5209126900,'stale-identity',signal);
assert.equal(staleIdentity.status,409);assert.equal(staleIdentity.data.error,'USER_REFERENCE_CHANGED');
assert.equal((await db.collection('users').doc('test-target').get()).data()?.isSuspended,true);
await assert.rejects(executeAiAdminRoute({ action: 'user_suspend', targetId: 'test-target', body: { isSuspended: false } }, 123, 'unauthorized', signal), /OWNER_ONLY/);
const delegatedId='user-7573478198';
await db.collection('users').doc(delegatedId).set({id:delegatedId,telegramId:'7573478198',isAdmin:true,isSuspended:false,adminPermissions:{scope:'LEAGUES',leagueIds:['league-premier-league']}});
await db.collection('fixtures').doc('delegate-own').set(fixture('delegate-own',league,2));
await db.collection('fixtures').doc('delegate-foreign').set(fixture('delegate-foreign','comp-la-liga-2026',2));
const ownReminder=await executeAiAdminRoute({action:'fixture_remind',targetId:'delegate-own',body:{}},7573478198,'delegate-own',signal);
assert.equal(ownReminder.status,409,JSON.stringify(ownReminder.data)); // Allowed route, already confirmed: no reminder sent.
const foreignReminder=await executeAiAdminRoute({action:'fixture_remind',targetId:'delegate-foreign',body:{}},7573478198,'delegate-foreign',signal);
assert.equal(foreignReminder.status,403,'Real delegated identity preserves league permissions');
for(const action of ['fixture_delete','user_role','ai_config','season_archive']){
 const plan:any={action,targetId:'delegate-own',body:{}};
 await assert.rejects(executeAiAdminRoute(plan,7573478198,'danger',signal),/faqat asosiy admin/);
}
await db.collection('users').doc(delegatedId).update({isAdmin:false});
await assert.rejects(executeAiAdminRoute({action:'fixture_remind',targetId:'delegate-own',body:{}},7573478198,'revoked-delegate',signal),/OWNER_AUTHORIZATION_UNAVAILABLE/);
await db.collection('users').doc(owner).update({ isSuspended: true });
await assert.rejects(executeAiAdminRoute({ action: 'user_suspend', targetId: 'test-target', body: { isSuspended: false } }, 5209126900, 'revoked-owner', signal), /OWNER_AUTHORIZATION_UNAVAILABLE/);
setTestConfigOverride(null);
console.log('PASS actual in-process admin route execution, authoritative owner, persistent change, suspended owner and outsider denied; no Telegram messages');
