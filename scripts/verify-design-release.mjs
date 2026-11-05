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
      if (args.path === 'auth') return { contents: 'export const AuthProvider=({children})=>children; export const useAuth=()=>globalThis.releaseAuth; export const usePremiumClubIds=()=>[]; export const APP_BUILD_ID="release-test";' };
      if (args.path === 'profiles') return { contents: 'export const UserProfileProvider=({children})=>children;' };
      if (args.path === 'api') return { contents: 'export const api={};' };
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
  if (completed !== 'stored') storage.delete(`efluz-welcome-v2:${id}`);
  if (completed === true) storage.set(`efluz-welcome-v2:${id}`, 'done');
  // Lazy sections suspend during the first render; verify their completed output.
  const stream = await renderToReadableStream(React.createElement(App));
  await stream.allReady;
  return new Response(stream).text();
}
for (const admin of [false, true]) {
  storage.set('efluz-welcome-v1:player-1', 'done');
  const welcome = await render({ admin, completed: false });
  assert.match(welcome, />Boshlash</, 'every role must see the version 2 welcome despite a version 1 completion');
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

for (const admin of [false, true]) {
  const current = await render({admin,completed:false,seasonId:'season-2026-27'});
  const icons = current.match(/<ul class="welcome-league-icons">([\s\S]*?)<\/ul>/)?.[1] || '';
  assert.equal((icons.match(/<li/g) || []).length,4,'Current season has four active league icons');
  assert.doesNotMatch(icons,/ligue-1/);
  assert.match(current,/EFL · 2-mavsum/);
  assert.match(current,/Tayyorgarlik/);
  assert.match(current,/1-mavsum davom etmoqda/);
  assert.match(current,/klub tanlash hali ochilmagan/);
  const preparation = current.match(/<section class="season-preparation"([\s\S]*?)<\/section>/)?.[1] || '';
  assert.equal((preparation.match(/season-preparation-name/g) || []).length,9,'The preparation catalog includes five European and four Asian leagues');
  for (const name of ['Ligue 1','O‘zbekiston Superligasi','Saudi Pro League','J1 League','Süper Lig']) assert.ok(preparation.includes(name),name);
  assert.match(preparation,/Osiyo Chempionlar ligasi/,'Asian Champions League is visible in the same preparation plan');
  assert.match(preparation,/32 klub/);
  assert.match(preparation,/Har bir ligadan 8 tadan klub/);
  assert.match(preparation,/Yevropa UCL kabi/);
  assert.match(preparation,/har klubga 8 ta o‘yin/);
  assert.match(preparation,/9–24: o‘tish pley-offi/);
  const aclSources = preparation.match(/<ul class="season-preparation-sources">([\s\S]*?)<\/ul>/)?.[1] || '';
  assert.equal((aclSources.match(/<li/g) || []).length,4);
  for (const name of ['O‘zbekiston Superligasi','Saudi Pro League','J1 League','Süper Lig']) assert.ok(aclSources.includes(name));
  assert.doesNotMatch(aclSources,/Premier League|La Liga|Serie A|Bundesliga|Ligue 1/);
  assert.match(preparation,/<details><summary>/,'Long league list is expandable on onboarding');
  assert.doesNotMatch(preparation,/<button|href="\/|data-munfiz-control="claim/,'The preparation list cannot claim a club or switch seasons');
  assert.equal((preparation.match(/class="season-preparation-roster"/g)||[]).length,9);
  assert.match(preparation,/168|16 klub/);
  assert.match(preparation,/30 tur · 240 o‘yin/);
  assert.match(preparation,/38 tur · 380 o‘yin/);
  assert.match(preparation,/2026-11-05/);
  assert.match(preparation,/Elche CF/);
  assert.doesNotMatch(preparation,/Girona FC|VfL Wolfsburg|Hellas Verona|Montpellier HSC/);
  assert.equal((preparation.match(/rel="noopener noreferrer"/g)||[]).length,21);

  const next = await render({admin,completed:false,seasonId:'season-2027-28'});
  const nextIcons = next.match(/<ul class="welcome-league-icons">([\s\S]*?)<\/ul>/)?.[1] || '';
  assert.equal((nextIcons.match(/<li/g) || []).length,5,'Next season restores all five league icons');
  assert.match(nextIcons,/ligue-1/);
  assert.doesNotMatch(next,/class="season-preparation"/);
}
console.log('PASS real welcome render: four active leagues, separate closed season-two preparation with nine leagues, both roles');

for (const [language, title] of [['uz','Osiyo Chempionlar ligasi'],['ru','Лига чемпионов Азии'],['en','Asian Champions League']]) {
  const html = await render({ completed:false, seasonId:'season-2026-27', language });
  assert.ok(html.includes(title), `ACL description is translated into ${language}`);
  assert.match(html,/32/);
  assert.match(html,/9–24/);
}
console.log('PASS ACL preparation: approved 32-team format and eight places per Asian league, localized into three languages');
