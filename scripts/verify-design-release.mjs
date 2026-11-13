import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Render the real App, Header, Navigation and WelcomeScreen with isolated auth/data.
// No external API calls or production writes; data-heavy views are route markers.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const React = require('react');
const { renderToReadableStream } = require('react-dom/server');
const views = ['MatchdayHomeView', 'CompetitionHubView', 'ClubHubView', 'PublicClubView', 'NotificationsView', 'AdminView', 'AdminMatchOperationsV4Panel', 'NotificationModal', 'TelegramDiagnosticsModal', 'OfflineSyncBanner', 'GlobalSearchModal', 'MatchOperationsV4Panel', 'SeasonLifecyclePanel'];
const result = await build({
  absWorkingDir: root, entryPoints: ['src/App.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env.DEV': 'false', '__EFL_DESIGN_PREVIEW_BUILD__': 'false' },
  plugins: [{ name: 'isolated-release-render', setup(build) {
    build.onResolve({ filter: /AuthContext$/ }, () => ({ path: 'auth', namespace: 'release-test' }));
    build.onResolve({ filter: /UserProfileContext$/ }, () => ({ path: 'profiles', namespace: 'release-test' }));
    build.onResolve({ filter: /\/lib\/api$/ }, () => ({ path: 'api', namespace: 'release-test' }));
    build.onResolve({ filter: /\/i18n$/ }, () => ({ path: 'i18n', namespace: 'release-test' }));
    build.onResolve({ filter: /\/components\// }, (args) => {
      const name = path.basename(args.path);
      if (views.includes(name)) return { path: name, namespace: 'release-test' };
    });
    build.onLoad({ filter: /.*/, namespace: 'release-test' }, (args) => {
      if (args.path === 'auth') return { contents: 'export const AuthProvider=({children})=>children; export const useAuth=()=>globalThis.releaseAuth; export const useOptionalAuth=()=>globalThis.releaseAuth; export const usePremiumClubIds=()=>[]; export const APP_BUILD_ID="release-test";' };
      if (args.path === 'profiles') return { contents: 'export const UserProfileProvider=({children})=>children;' };
      if (args.path === 'api') return { contents: 'export const api={}; export const getSessionToken=()=>null; export const getTelegramInitData=()=>""; export const getDevUserId=()=>null;' };
      if (args.path === 'i18n') return { contents: 'export const I18nProvider=({children})=>children; export const useI18n=()=>({language:globalThis.releaseLanguage||"uz",setLanguage:()=>{},t:{navHome:"Bosh sahifa",navLeagues:"Turnirlar",navAdmin:"Admin"}});' };
      return { resolveDir: root, contents: `import React from 'react'; export const ${args.path}=()=>React.createElement('div',{'data-test-view':'${args.path}'});` };
    });
  }}],
});
const storage = new Map();
const context = { require, module: { exports: {} }, exports: {}, console, URLSearchParams,
  window: { location: { pathname: '/', hash: '', search: '' }, localStorage: { getItem: key => storage.get(key) ?? null } },
};
context.exports = context.module.exports;
vm.createContext(context);
vm.runInContext(result.outputFiles[0].text, context);
const App = context.module.exports.default;
async function render({ id = 'player-1', admin = false, route = '/', completed = true, theme = 'dark', anonymous = false, seasonId = 'test-season', language = 'uz' } = {}) {
  context.releaseLanguage = language;
  context.releaseAuth = { user: anonymous ? null : { id, username: 'testplayer', isAdmin: admin }, isLoading: false,
    authStatus: anonymous ? 'AUTH_ANONYMOUS' : 'AUTHENTICATED', unreadNotificationCount: 2,
    seasons: [], activeSeasonId: seasonId, devProfiles: [], currentClub: { id: 'club-test', name: 'Test club' }, isDevMode: false };
  context.window.location.pathname = route;
  storage.set('efluz-theme-mode', theme);
  if (completed !== 'stored') storage.delete(`efluz-welcome-v3:${id}`);
  if (completed === true) storage.set(`efluz-welcome-v3:${id}`, 'done');
  // Lazy sections suspend during the first render; verify their completed output.
  const stream = await renderToReadableStream(React.createElement(App));
  await stream.allReady;
  return new Response(stream).text();
}
for (const admin of [false, true]) {
  storage.set('efluz-welcome-v1:player-1', 'done');
  storage.set('efluz-welcome-v2:player-1', 'done');
  const welcome = await render({ admin, completed: false });
  assert.match(welcome, />Boshlash</, 'every role must see version 3 welcome despite previously completed versions');
  assert.doesNotMatch(welcome, /data-test-view="MatchdayHomeView"/);
  const home = await render({ admin });
  assert.match(home, /data-test-view="MatchdayHomeView"/);
  assert.match(home, /efl-preview theme-dark dark/);
  assert.match(home, /id="btn-global-search"/);
  assert.match(home, /id="btn-first-visit-guide"/);
  assert.match(home, /id="btn-theme-toggle"/);
  assert.match(home, /efl-bottom-glass/);
  assert.equal(home.includes('id="nav-tab-admin"'), admin);
}
assert.match(await render({ theme: 'light' }), /efl-preview theme-light/);
for (const admin of [false, true]) {
  const clubPage = await render({ route: '/clubs/club-barcelona', admin });
  assert.match(clubPage, /data-test-view="PublicClubView"/, 'club URLs render the public club page for either role');
  assert.doesNotMatch(clubPage, /data-test-view="ClubHubView"|data-test-view="CompetitionHubView"|data-test-view="MatchdayHomeView"/, 'public club pages do not fall through to another screen');
}
assert.doesNotMatch(await render({ route: '/clubs/club-barcelona', anonymous: true }), /data-test-view="PublicClubView"/, 'club links preserve Telegram authentication');
assert.doesNotMatch(await render({ route: '/clubs/%zz' }), /data-test-view="PublicClubView"/, 'malformed club links are rejected safely');
for (const route of ['/leagues', '/cups', '/champions-league', '/standings', '/season-hub'])
  assert.match(await render({ route }), /data-test-view="CompetitionHubView"/);
for (const route of ['/my-club', '/profile', '/my-matches']) {
  const club = await render({ route });
  assert.match(club, /data-test-view="ClubHubView"/);
  assert.match(club, /data-test-view="MatchOperationsV4Panel"/);
  assert.match(club, /data-test-view="SeasonLifecyclePanel"/);
}
assert.doesNotMatch(await render(), /data-test-view="MatchOperationsV4Panel"/);
assert.match(await render({ route: '/notifications' }), /data-test-view="NotificationsView"/);
assert.doesNotMatch(await render({ route: '/admin' }), /data-test-view="AdminView"|data-test-view="AdminMatchOperationsV4Panel"|data-test-view="TelegramDiagnosticsModal"|data-test-view="OfflineSyncBanner"/);
assert.match(await render({ route: '/admin', admin: true }), /data-test-view="AdminView"/);
assert.doesNotMatch(await render({ id: 'player-2', completed: false }), /data-test-view="MatchdayHomeView"/);
assert.doesNotMatch(await render({ anonymous: true }), /efl-welcome|data-test-view="MatchdayHomeView"/);
assert.doesNotMatch(await render({ anonymous: true }), /id="btn-first-visit-guide"/);
console.log('PASS EFL 2.0: every role gets versioned welcome, public design/themes/navigation/routes; administrator routes remain restricted; anonymous auth remains intact.');

// The approved 10 Nov onboarding is a TWO-page flow. SSR renders page one;
// the second page remains behind its real React state transition.
for (const admin of [false, true]) {
  const current = await render({admin,completed:false,seasonId:'season-2026-27'});
  const leagueIcons = current.match(/<ul class="welcome-league-icons">([\s\S]*?)<\/ul>/)?.[1] || '';
  assert.equal((leagueIcons.match(/<li/g) || []).length,5,'Europe includes five leagues');
  for (const name of ['Premier League','La Liga','Serie A','Bundesliga','Ligue 1']) assert.match(current,new RegExp(name));
  for (const name of ['O‘zbekiston Superligasi','Saudi Pro League','J1 League','Turkiya Superligasi']) assert.match(current,new RegExp(name));
  assert.match(current,/>Davom etish</,'The first page advances instead of entering EFLUZ');
  assert.doesNotMatch(current,/>Boshlash</,'The completion button must only exist on page two');
  assert.match(current,/aria-label="1 \/ 2"/,'Display two-stage navigation');
}
const fs = await import('node:fs');
const source = fs.readFileSync('src/components/WelcomeScreen.tsx','utf8');
assert.match(source,/useState<1 \| 2>\(1\)/,'Two real React steps');
assert.match(source,/step === 1 \? \(\) => setStep\(2\) : onStart/,'Finish only on second step');
assert.match(source,/setStep\(1\)/,'Back goes to first step');
for (const image of ['golden-ball-photo.png','golden-boot-photo.png','weekly-motm-photo.png']) {
  assert.ok(fs.existsSync('public/welcome-awards/'+image),'Original preview artwork exists: '+image);
  assert.ok(source.includes('/welcome-awards/'+image),'Second page uses original artwork: '+image);
}
for (const [language, intro] of [['uz','Yangi mavsum. Yangi imkoniyatlar.'],['ru','Новый сезон. Новые возможности.'],['en','New season. New possibilities.']]) {
  assert.ok(source.includes(intro),language+' original two-step copy');
}
console.log('PASS season 2 two-step welcome: Europe/Asia first step, next/back/finish transitions, three original PNGs, UZ/RU/EN');
