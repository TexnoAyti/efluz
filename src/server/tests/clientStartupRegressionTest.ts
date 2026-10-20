import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider, useI18n } from '../../i18n';
import { readBrowserStorage, writeBrowserStorage } from '../../lib/browserStorage';
import assert from 'node:assert/strict';
import { loadLoginBootstrap } from '../../lib/loginBootstrap';
import { api, invalidateClientCache, setDevUserId, setSessionToken, setTelegramInitData, getSessionToken, getDevUserId, getTelegramInitData } from '../../lib/api';
import type { Season } from '../../types';

type Client = Parameters<typeof loadLoginBootstrap>[0];
const season = { id: 'season-2026-27', name: '2026/27', status: 'active' as const, startDate: '2026-08-01', createdAt: '' };
const stats = { matchesPlayed: 0, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0, points: 0, trophies: 0, leaguePosition: 0 };
const identity = {
  success: true, token: 'verified-test-token', currentClubStatus: 'resolved' as const, currentClub: null, ownedClubs: [], stats,
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
    getSessionBootstrap: async () => { calls.push('session-bootstrap'); return identity; },
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

const sessionCatalog = deferred<{ seasons: Season[] }>();
const storedSession = makeClient({ getSeasons: () => sessionCatalog.promise, getDevProfiles: async () => { throw Error('Existing sessions must not wait for dev discovery'); } });
assert.equal((await loadLoginBootstrap(storedSession.client, '', 'dev', () => {}, true)).mode, 'session');
assert.deepEqual(storedSession.calls, ['session-bootstrap']);
const noSessionCatalog = makeClient({getSeasons: () => sessionCatalog.promise});
assert.equal((await loadLoginBootstrap(noSessionCatalog.client, '', 'dev', () => {})).mode, 'session', 'Optional season data never blocks session verification');
sessionCatalog.resolve({seasons:[season]});

let verifiedSeason='';
const anotherSeason=makeClient({getSeasons:async()=>({seasons:[{...season,id:'season-2027-28'}]}),getMe:async id=>{verifiedSeason=id;return identity;}});
await loadLoginBootstrap(anotherSeason.client,'','dev',()=>{});
assert.equal(verifiedSeason,'season-2027-28','Already-available season metadata is honored without waiting for it');

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
  // Headers alone do not mean the response finished: a stalled body must abort.
  invalidateClientCache();
  globalThis.fetch = (async (_input, options:any={}) => new Response(new ReadableStream({
    start(controller) { options.signal.addEventListener('abort',()=>controller.error(new DOMException('Timed out','AbortError')),{once:true}); }
  }),{status:200})) as typeof fetch;
  let responseTimeout:ReturnType<typeof setTimeout>;
  await assert.rejects(Promise.race([
    api.getDevProfiles(),
    new Promise<never>((_,reject)=>{responseTimeout=setTimeout(()=>reject(Error('Response body bypassed request timeout')),3500);})
  ]).finally(()=>clearTimeout(responseTimeout)),(error:any)=>error.message!=='Response body bypassed request timeout');
} finally {
  globalThis.fetch = originalFetch;
  setSessionToken(null); setTelegramInitData(null); setDevUserId(null); invalidateClientCache();
}
// Blocked reads, writes and storage getters must not trap Telegram startup.
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const blockedStore = {
  getItem() { throw new DOMException('Storage denied', 'SecurityError'); },
  setItem() { throw new DOMException('Storage full', 'QuotaExceededError'); },
  removeItem() { throw new DOMException('Storage denied', 'SecurityError'); },
};
try {
  const blockedWindow: any = {
    localStorage: blockedStore, sessionStorage: blockedStore,
    location: { hash: '#tgWebAppData=blocked-signed-launch', search: '', pathname: '/' },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: blockedWindow });
  setSessionToken(null); setTelegramInitData(null); setDevUserId(null);
  assert.equal(readBrowserStorage('localStorage', 'theme'), null);
  assert.doesNotThrow(() => writeBrowserStorage('localStorage', 'theme', 'dark'));
  assert.equal(getTelegramInitData(), 'blocked-signed-launch', 'Signed launch hash remains readable when session storage is denied');
  setSessionToken('verified-in-memory-token');
  assert.equal(getSessionToken(), 'verified-in-memory-token', 'A failed persistence write cannot discard a verified session');
  assert.equal(getDevUserId(), null);
  const LanguageProbe = () => React.createElement('span', null, useI18n().language);
  assert.equal(renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(LanguageProbe))), '<span>uz</span>', 'Language provider mounts with denied storage');
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(blockedWindow, kind, { configurable: true, get() { throw new DOMException('Storage getter denied', 'SecurityError'); } });
    assert.equal(readBrowserStorage(kind, 'key'), null);
    assert.doesNotThrow(() => writeBrowserStorage(kind, 'key', 'value'));
    assert.doesNotThrow(() => writeBrowserStorage(kind, 'key', null));
  }
  setSessionToken(null); setTelegramInitData(null); setDevUserId(null);
  assert.equal(getTelegramInitData(), 'blocked-signed-launch');
  assert.equal(renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(LanguageProbe))), '<span>uz</span>');
} finally {
  setSessionToken(null); setTelegramInitData(null); setDevUserId(null);
  if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  else delete (globalThis as any).window;
}
console.log('PASS blocked WebView storage: signed launch hash, in-memory sessions, language mounting and throwing storage getters');
console.log('PASS startup: slow/failed catalog does not block Telegram login, healthy login skips dev discovery, rejected identity stays rejected, explicit development fallback and session/anonymous modes work, auth bodies and private headers preserved');
