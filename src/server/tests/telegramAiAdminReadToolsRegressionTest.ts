import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { createAiAdminReadTools, projectAiAdminData } from '../services/telegramAiAdminReadTools';
import { generateGroundedTelegramAnswer } from '../services/telegramAiReadTools';
import { buildTelegramAiSystemPrompt } from '../services/telegramAiPrompt';
import type { TelegramAiMessagePayload } from '../services/telegramAiService';

const payload = { updateId: 1, messageId: 1, chatId: 5209126900, threadId: 0, text: 'Nechta foydalanuvchi bor?', fromUser: { id: 5209126900, is_bot: false } } as TelegramAiMessagePayload;
const signal = new AbortController().signal;
let calls = 0, lastPlan: any;
const execute = async (plan: any) => {
  calls++; lastPlan = plan;
  return { status: 200, data: { users: [{ id: 'user-1', username: 'actual', apiKey: 'DO_NOT_SEND', nested: { access_token: 'DO_NOT_SEND', password: 'DO_NOT_SEND' } }], total: 101, page: plan.body.page, stale: true, degraded: true } };
};
const tools = createAiAdminReadTools(payload, signal, execute), run = tools[0].run;
assert.equal(tools.length, 1);
for (const other of [
  { ...payload, chatId: -100123, threadId: 3503 },
  { ...payload, forwarded: true }, { ...payload, senderChat: { id: 10 } },
  { ...payload, fromUser: { id: 123, is_bot: false }, chatId: 123 },
  { ...payload, fromUser: { id: 5209126900, is_bot: true } },
]) assert.equal(createAiAdminReadTools(other as TelegramAiMessagePayload, signal, execute).length, 0);
assert.equal((await run({ action: 'fixture_delete', targetId: 'fixture-1' })).error, 'READ_ONLY_ACTION_REQUIRED');
assert.equal((await run({ action: 'users', query: { arbitraryCollection: 'secrets' } })).error, 'INVALID_QUERY_FIELD');
assert.equal((await run({ action: 'users', query: { limit: -1 } })).error, 'INVALID_PAGE_SIZE');
assert.equal((await run({ action: 'user_detail' })).error, 'EXACT_TARGET_ID_REQUIRED');
assert.equal(calls, 0);
const users: any = await run({ action: 'users', query: { search: '@actual', limit: 1000, page: 2 } });
assert.equal(lastPlan.body.limit, 30); assert.equal(lastPlan.body.page, 2);
assert.equal(users.data.total, 101); assert.equal(users.data.stale, true);
assert.ok(!JSON.stringify(users).includes('DO_NOT_SEND'));
const capabilities: any = await run({ action: 'capabilities' });
assert.ok(capabilities.actions.some((a: any) => a.action === 'match_operations'));
assert.ok(capabilities.actions.some((a: any) => a.action === 'club_assign'));
assert.equal(capabilities.writesRequireConfirmation, true);
const delegated = createAiAdminReadTools({ ...payload, fromUser: { id: 7573478198 }, chatId: 7573478198 } as TelegramAiMessagePayload, signal, execute)[0];
assert.equal((await delegated.run({ action: 'users' })).error, 'ADMIN_PERMISSION_DENIED');
const delegatedCapabilities: any = await delegated.run({ action: 'capabilities' });
assert.ok(!delegatedCapabilities.actions.some((a: any) => a.action === 'fixture_delete'));
assert.ok(delegatedCapabilities.actions.some((a: any) => a.action === 'club_assign'));
const denied = createAiAdminReadTools(payload, signal, async () => { throw new Error('OWNER_AUTHORIZATION_UNAVAILABLE'); });
assert.equal((await denied[0].run({ action: 'users' })).error, 'ADMIN_PERMISSION_DENIED');
const scoped = createAiAdminReadTools(payload, signal, async () => ({ status: 403, data: { secret: 'DO_NOT_SEND' } }));
assert.equal((await scoped[0].run({ action: 'fixtures' })).error, 'ADMIN_PERMISSION_DENIED');
const paged = createAiAdminReadTools(payload, signal, async () => ({ status: 200, data: { notifications: Array.from({ length: 75 }, (_, id) => ({ id: `message-${id}`, text: 'hello' })), nextCursor: 'server-page-100', stale: false } }))[0];
const tail: any = await paged.run({ action: 'notification_messages', section: 'notifications', offset: 30 });
assert.equal(tail.total, 75); assert.equal(tail.data[0].id, 'message-30'); assert.equal(tail.data.at(-1).id, 'message-59'); assert.equal(tail.nextOffset, 60);
assert.equal(tail.routeMetadata.nextCursor, 'server-page-100');
const last: any = await paged.run({ action: 'notification_messages', section: 'notifications', offset: 60 });
assert.equal(last.data.length, 15); assert.equal(last.nextOffset, null);
assert.equal((await paged.run({ action: 'notification_messages', section: 'constructor' })).error, 'INVALID_READ_SECTION');
assert.equal((await paged.run({ action: 'notification_messages', section: 'missing' })).error, 'INVALID_READ_SECTION');
assert.equal((await paged.run({ action: 'notification_messages', offset: 30 })).error, 'READ_SECTION_REQUIRED');
const cut = projectAiAdminData({ rows: Array.from({ length: 31 }, () => ({ description: 'x'.repeat(2000) })), total: 31 });
assert.equal(cut.truncated, true);
assert.equal((cut.data as any).total, 31);
const controller = new AbortController(); const cancelled = createAiAdminReadTools(payload, controller.signal, execute); controller.abort();
assert.equal((await cancelled[0].run({ action: 'users' })).error, 'READ_DEADLINE_EXCEEDED');
let generations = 0;
const answer = await generateGroundedTelegramAnswer({ ai: {} as any, model: 'test', signal,
  systemPrompt: buildTelegramAiSystemPrompt('', undefined, { privateAdmin: true }), contents: [], extraReadTools: tools, maxToolRounds: 3,
  read: async () => ({ data: [], complete: true }),
  generate: async request => {
    generations++;
    if (generations === 1) return { functionCalls: [{ name: 'read_admin_data', args: { action: 'users', query: { page: 1 } } }], candidates: [{ content: { role: 'model', parts: [] } }] };
    const response = request.contents.at(-1).parts[0].functionResponse.response.result;
    assert.equal(response.data.total, 101); assert.ok(!JSON.stringify(response).includes('DO_NOT_SEND'));
    return { text: 'Bazadagi ro‘yxatda 101 foydalanuvchi bor; saqlangan ma’lumot eski.' };
  },
});
assert.match(answer, /101/);
assert.ok(!buildTelegramAiSystemPrompt('').includes('SHAXSIY ADMIN SUHBATI'));
// Actual protected route execution and live role revocation, in the isolated database.
await initDatabase();
const db = getFirestoreDb();
await db.collection('users').doc('user-5209126900').set({ id: 'user-5209126900', telegramId: '5209126900', isAdmin: true, isSuspended: false, adminPermissions: { scope: 'ALL', leagueIds: [] } });
const actual = createAiAdminReadTools(payload, signal)[0];
const settings: any = await actual.run({ action: 'ai_settings' });
assert.equal(settings.permissionsChecked, true, JSON.stringify(settings));
const history: any = await actual.run({ action: 'season_history' });
assert.equal(history.permissionsChecked, true, JSON.stringify(history));
assert.ok(Array.isArray(history.data.seasons));
await db.collection('users').doc('user-5209126900').update({ isSuspended: true });
assert.equal((await actual.run({ action: 'ai_settings' })).error, 'ADMIN_PERMISSION_DENIED');
// Recheck the trusted payload before every invocation, not only at tool registration.
payload.chatId = -100123;
assert.equal((await run({ action: 'users' })).error, 'PRIVATE_ADMIN_CHAT_REQUIRED');
console.log('PASS private admin tool boundary, fixed read catalog, scope checks, secret projection, pagination limits, capabilities, cancellation and model grounding');
