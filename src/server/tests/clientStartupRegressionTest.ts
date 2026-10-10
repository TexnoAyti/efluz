import assert from 'node:assert/strict';
import { loadLoginBootstrap } from '../../lib/loginBootstrap';
import { api, invalidateClientCache, setDevUserId, setSessionToken, setTelegramInitData } from '../../lib/api';
import type { Season } from '../../types';

type Client = Parameters<typeof loadLoginBootstrap>[0];
const season = { id: 'season-2026-27', name: '2026/27', status: 'active' as const, startDate: '2026-08-01', createdAt: '' };
const stats = { matchesPlayed: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0, points: 0, trophies: 0, leaguePosition: 0 };
const identity = {
  success: true, token: 'verified-test-token', currentClub: null, ownedClubs: [], stats,
  user: { id: 'user-123', telegramId: '123', username: 'verified', firstName: 'Verified', isAdmin: false, isSuspended: false, createdAt: '', updatedAt: '' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function makeClient(overrides: Partial<Client> = {}) {
  const calls: string[] = [];
  const client: Client = {
    getSeasons: async () => { calls.push('seasons'); return { seasons: [season] }; },
    getDevProfiles: async () => { calls.push('dev-profiles'); return { profiles: [] }; },
    authenticateTelegram: async () => { calls.push('telegram'); return identity; },
    authenticateDev: async () => { calls.push('dev'); return identity; },
    getMe: async () => { calls.push('session'); return identity; },
    ...overrides,
  };
  return { client, calls };
}

// An indefinitely slow optional catalog cannot hold a verified login spinner open.
const catalog = deferred<{ seasons: Season[] }>();
let metadata: Season[] | undefined;
const fast = makeClient({ getSeasons: () => catalog.promise });
let timeout: ReturnType<typeof setTimeout>;
const loggedIn = await Promise.race([
  loadLoginBootstrap(fast.client, 'signed-init-data', 'user-dev-a', seasons => { metadata = seasons; }),
  new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Catalog blocked login')), 1000); }),
]).finally(() => clearTimeout(timeout));
assert.equal(loggedIn.identity, identity);
assert.equal(loggedIn.mode, 'telegram');
assert.deepEqual(fast.calls, ['telegram'], 'Healthy Telegram login does not discover development accounts');
assert.equal(metadata, undefined);
catalog.resolve({ seasons: [season] });
await catalog.promise;
assert.deepEqual(metadata, [season], 'Season metadata still arrives after login');

const failedCatalog = makeClient({ getSeasons: async () => { throw new Error('catalog unavailable'); } });
assert.equal((await loadLoginBootstrap(failedCatalog.client, 'signed-init-data', 'dev', () => {})).identity, identity);

const denied = new Error('Invalid Telegram signature');
const invalid = makeClient({ authenticateTelegram: async () => { throw denied; } });
await assert.rejects(loadLoginBootstrap(invalid.client, 'invalid-init-data', 'dev', () => {}), error => error === denied);
assert.equal(invalid.calls.includes('dev'), false, 'A denied login cannot silently use a development identity');

const profiles = [{ id: 'user-dev-a', username: 'dev', firstName: 'Dev', isAdmin: false }];
const sandbox = makeClient({ getDevProfiles: async () => ({ profiles }) });
assert.equal((await loadLoginBootstrap(sandbox.client, '', 'user-dev-a', () => {})).mode, 'dev');
assert.equal(sandbox.calls.includes('dev'), true, 'Server-enabled development mode remains available');

const fallback = makeClient({ authenticateTelegram: async () => { throw denied; }, getDevProfiles: async () => ({ profiles }) });
assert.equal((await loadLoginBootstrap(fallback.client, 'invalid-init-data', 'user-dev-a', () => {})).mode, 'dev');

const session = makeClient();
assert.equal((await loadLoginBootstrap(session.client, '', 'dev', () => {})).mode, 'session');
const anonymous = makeClient({ getMe: async () => { throw new Error('401'); } });
assert.equal((await loadLoginBootstrap(anonymous.client, '', 'dev', () => {})).identity, null);

// Exercise the real request wrapper: public bootstrap routes do not trigger the
// server's duplicate header-based identity lookup, while private requests do.
const originalFetch = globalThis.fetch;
const requests: Array<{ path: string; options: RequestInit }> = [];
globalThis.fetch = (async (input, options = {}) => {
  const path = String(input);
  requests.push({ path, options });
  const body = path === '/api/seasons' ? { seasons: [season] }
    : path === '/api/auth/dev-profiles' ? { profiles: [] } : identity;
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
try {
  setSessionToken('existing-session');
  setTelegramInitData('signed-init-data');
  setDevUserId('existing-dev');
  invalidateClientCache();
  await api.getSeasons();
  await api.getDevProfiles();
  await api.authenticateTelegram('signed-init-data');
  await api.authenticateDev('user-dev-a');
  await api.getMe(season.id, true);
  for (const { path, options } of requests.slice(0, 4)) {
    const headers = new Headers(options.headers);
    for (const header of ['authorization', 'x-session-token', 'x-telegram-init-data', 'x-dev-user-id']) {
      assert.equal(headers.has(header), false, path + ' unexpectedly carried ' + header);
    }
  }
  assert.equal(JSON.parse(String(requests[2].options.body)).initData, 'signed-init-data');
  assert.equal(JSON.parse(String(requests[3].options.body)).devUserId, 'user-dev-a');
  assert.equal(new Headers(requests[4].options.headers).get('authorization'), 'Bearer existing-session');
} finally {
  globalThis.fetch = originalFetch;
  setSessionToken(null); setTelegramInitData(null); setDevUserId(null); invalidateClientCache();
}
console.log('PASS startup: slow/failed catalog does not block Telegram login, healthy login skips dev discovery, rejected identity stays rejected, explicit development fallback and session/anonymous modes work, auth bodies and private headers preserved');
