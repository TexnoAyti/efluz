import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { adminReleaseClubFirestore } from '../firebase/firestoreStore';
import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { planNaturalAdminRequest } from '../services/telegramAiNaturalAdminPlanner';
import { getConversationIntent } from '../services/telegramAiConversationCommands';
import { handleAiAdminCommand, setTestAiAdminHooks, rememberDeliveredAdminPlan } from '../services/telegramAiAdminService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import type { AdminPlan } from '../services/telegramAiAdminCatalog';
import { executeAiAdminRoute } from '../services/telegramAiAdminGateway';

await initDatabase();
const bridge = await startMockUpstashBridge();
const season = 'season-2026-27';
const clubs = [
  { id: 'club-heidenheim', name: '1. FC Heidenheim', leagueId: 'league-bundesliga', ownerUsername: 'actual_owner', ownerUserId: 'user-12345' },
  { id: 'club-arsenal', name: 'Arsenal', leagueId: 'league-premier-league', ownerUsername: 'other_owner', ownerUserId: 'user-67890' },
];
const users = [{ id: 'user-12345', username: 'actual_owner', telegramId: '12345' }, { id: 'user-67890', username: 'other_owner', telegramId: '67890' }];
const deps = { read: async () => ({ data: clubs, total: clubs.length }), users: async () => users };
const signal = new AbortController().signal;
const payload = (text: string, id = 5209126900) => ({ updateId: 99100, messageId: 1, chatId: -1001, threadId: 3503, fromUser: { id }, text });
const executed: AdminPlan[] = [];
const db = getFirestoreDb(), originalCollection = db.collection.bind(db);
let firestoreReads = 0;
db.collection = (() => { firestoreReads++; throw new Error('NATIVE_PLANNING_MUST_USE_REDIS'); }) as any;
try {
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: clubs });
  await redisSetRaw('efluz:v1:admin:user-directory', { data: users });
  setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503 });
  setTestAiAdminHooks(async plan => { executed.push(plan); return { status: 200, data: { success: true } }; });
  for (const text of [
    '@actual_owner Heidenheimga biriktirgin', 'Heidenheimni @actual_owner ga biriktirib qo‘ygin',
    '@actual_owner ga Heidenheimni berib qo‘ygin', 'Heidenheimni @actual_owner ga ber',
    '@actual_owner ni Heidenheimga ulab qo‘y', '@actual_owner ni Heidenheimga o‘tkazgin',
    'Heidenheimga @actual_owner ni yozib qo‘y', 'user-12345 Heidenheimga biriktirgin',
  ]) {
    assert.equal(getConversationIntent(text), 'admin', text);
    const plan = await planNaturalAdminRequest(text, deps);
    assert.equal(plan?.action, 'club_assign', text);
    assert.equal(plan?.targetId, 'club-heidenheim', text);
    assert.equal(plan?.body.targetUserId, text.includes('user-12345') ? 'user-12345' : '@actual_owner', text);
    assert.match(await handleAiAdminCommand(payload(text), signal), /\/ai_confirm/, text);
  }
  for (const text of ['Heidenheimni bo‘shatgin', 'Heidenheim egasini olib tashla', 'Heidenheim biriktirishni bekor qil']) {
    const plan = await planNaturalAdminRequest(text, deps);
    assert.equal(plan?.action, 'club_release', text);
    assert.equal(plan?.targetId, 'club-heidenheim', text);
  }
  for (const text of ['@actual_owner ni jamoadan chiqar', '@actual_owner ni Heidenheimdan chiqargin', '@actual_owner jamoasidan o‘chir']) {
    const plan = await planNaturalAdminRequest(text, deps);
    assert.equal(plan?.action, 'club_release', text);
    assert.equal(plan?.targetId, 'club-heidenheim', text);
    assert.equal(plan?.body.expectedOwnerUserId, 'user-12345', text);
    assert.match(await handleAiAdminCommand(payload(text), signal), /Klub, o‘yinlar va natijalar saqlanadi/, text);
  }
  await assert.rejects(planNaturalAdminRequest('@actual_owner ni Arsenal klubidan chiqar', deps), /mos kelmadi/);
  for (const text of [
    '@actual_owner Heidenheimga biriktirma', '@actual_owner Heidenheimga biriktirma hozir biriktir',
    'Heidenheimni @actual_owner ga berma', 'Heidenheimni bo‘shatma',
    '@actual_owner Heidenheimga biriktir va Arsenalni bo‘shat',
    '@actual_owner Heidenheimga biriktirgin keyin premium ber',
    '@actual_owner Heidenheimga biriktir; egasidan bo‘shat',
  ]) assert.ok(!/\/ai_confirm/.test(await handleAiAdminCommand(payload(text), signal)), text);
  for (const text of ['Heidenheimni o‘chir', 'Heidenheim klubini o‘chirib tashla']) {
    const reply = await handleAiAdminCommand(payload(text), signal);
    assert.match(reply, /egasini klubdan chiqarishni/);
    assert.ok(!/\/ai_confirm/.test(reply));
  }
  assert.equal(getConversationIntent('@actual_owner ni blokdan chiqar'), 'admin');
  assert.equal((await planNaturalAdminRequest('@actual_owner ni blokdan chiqar', deps))?.action, 'user_suspend');
  assert.ok(!/\/ai_confirm/.test(await handleAiAdminCommand(payload('@actual_owner Heidenheimga biriktirgin', 123), signal)));
  const preview = await handleAiAdminCommand(payload('@actual_owner Heidenheimga berib qo‘ygin'), signal);
  assert.equal(executed.length, 0, 'No mutation before delivered confirmation');
  await rememberDeliveredAdminPlan(payload('x'), preview, 987, signal);
  assert.match(await handleAiAdminCommand(payload('tasdiqlayman'), signal), /Bajarildi/);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].action, 'club_assign');
  await handleAiAdminCommand(payload('tasdiqlayman'), signal);
  assert.equal(executed.length, 1, 'No duplicate execution');
  assert.equal(firestoreReads, 0);
  console.log('PASS native club language: suffixes, synonyms, ID/username, owner lookup, mismatch, negation, multiple actions, delete clarification, delivered confirmation; zero model/Firestore planning');
} finally {
  db.collection = originalCollection;
  await bridge.close();
  setTestAiAdminHooks(); setTestConfigOverride(null);
}

// Original release implementation, isolated in-memory Firestore only. Verify
// stale confirmations cannot release a different owner, and game data survives.
const clubId = 'club-heidenheim', occupancyId = `${season}_${clubId}`;
await db.collection('clubs').doc(clubId).set({ ...clubs[0], isTaken: true, claimedByUserId: 'user-12345' });
await db.collection('club_occupancies').doc(occupancyId).set({ clubId, seasonId: season, userId: 'user-12345', status: 'active' });
await db.collection('user_memberships').doc(`${season}_user-12345`).set({ clubId, seasonId: season, userId: 'user-12345', status: 'active' });
await db.collection('fixtures').doc('retained-game').set({ homeClubId: clubId, awayClubId: 'club-arsenal', homeScore: 2, awayScore: 1, status: 'CONFIRMED' });
const game = (await db.collection('fixtures').doc('retained-game').get()).data();
await db.collection('users').doc('user-5209126900').set({ id: 'user-5209126900', telegramId: '5209126900', username: 'owner_admin', firstName: 'Owner', isAdmin: true, isSuspended: false });
const staleRoute = await executeAiAdminRoute({ action: 'club_release', targetId: clubId, body: { expectedOwnerUserId: 'user-67890' } }, 5209126900, 'isolated-stale-release', signal);
assert.equal(staleRoute.status, 409, 'Actual owner-authorized route reports changed ownership as a conflict');
assert.match(staleRoute.data.message, /egasi.*o‘zgargan/);
await assert.rejects(adminReleaseClubFirestore('user-5209126900', clubId, season, { authoritativeOnly: true, expectedOwnerUserId: 'user-67890' }), /egasi.*o‘zgargan/);
assert.equal((await db.collection('club_occupancies').doc(occupancyId).get()).data()?.userId, 'user-12345');
assert.equal((await db.collection('user_memberships').doc(`${season}_user-12345`).get()).data()?.status, 'active');
await adminReleaseClubFirestore('user-5209126900', clubId, season, { authoritativeOnly: true, expectedOwnerUserId: 'user-12345' });
assert.equal((await db.collection('club_occupancies').doc(occupancyId).get()).data()?.userId, null);
assert.equal((await db.collection('user_memberships').doc(`${season}_user-12345`).get()).data()?.status, 'released');
assert.deepEqual((await db.collection('fixtures').doc('retained-game').get()).data(), game);
assert.equal((await db.collection('clubs').doc(clubId).get()).exists, true);
console.log('PASS original atomic release: stale owner precondition aborts, exact owner released, club and 2–1 game retained; no production writes');
