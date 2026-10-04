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
const { renderToStaticMarkup } = require('react-dom/server');
const views = ['MatchdayHomeView', 'CompetitionHubView', 'ClubHubView', 'NotificationsView', 'AdminView', 'AdminMatchOperationsV4Panel', 'NotificationModal', 'TelegramDiagnosticsModal', 'OfflineSyncBanner', 'GlobalSearchModal'];
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
      if (args.path === 'i18n') return { contents: 'export const I18nProvider=({children})=>children; export const useI18n=()=>({language:"uz",setLanguage:()=>{},t:{navHome:"Bosh sahifa",navLeagues:"Turnirlar",navAdmin:"Admin"}});' };
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
function render({ id = 'player-1', admin = false, route = '/', completed = true, theme = 'dark', anonymous = false } = {}) {
  context.releaseAuth = { user: anonymous ? null : { id, username: 'testplayer', isAdmin: admin }, isLoading: false,
    authStatus: anonymous ? 'AUTH_ANONYMOUS' : 'AUTHENTICATED', unreadNotificationCount: 2,
    seasons: [], activeSeasonId: 'test-season', devProfiles: [], currentClub: null, isDevMode: false };
  context.window.location.pathname = route;
  storage.set('efluz-theme-mode', theme);
  storage.delete(`efluz-welcome-v2:${id}`);
  if (completed) storage.set(`efluz-welcome-v2:${id}`, 'done');
  return renderToStaticMarkup(React.createElement(App));
}
for (const admin of [false, true]) {
  storage.set('efluz-welcome-v1:player-1', 'done');
  const welcome = render({ admin, completed: false });
  assert.match(welcome, />Boshlash</, 'every role must see the version 2 welcome despite a version 1 completion');
  assert.doesNotMatch(welcome, /data-test-view="MatchdayHomeView"/);
  const home = render({ admin });
  assert.match(home, /data-test-view="MatchdayHomeView"/);
  assert.match(home, /efl-preview theme-dark dark/);
  assert.match(home, /id="btn-global-search"/);
  assert.match(home, /id="btn-theme-toggle"/);
  assert.match(home, /efl-bottom-glass/);
  assert.equal(home.includes('id="nav-tab-admin"'), admin);
}
assert.match(render({ theme: 'light' }), /efl-preview theme-light/);
for (const route of ['/leagues', '/cups', '/champions-league', '/standings', '/season-hub'])
  assert.match(render({ route }), /data-test-view="CompetitionHubView"/);
for (const route of ['/my-club', '/profile', '/my-matches'])
  assert.match(render({ route }), /data-test-view="ClubHubView"/);
assert.match(render({ route: '/notifications' }), /data-test-view="NotificationsView"/);
assert.doesNotMatch(render({ route: '/admin' }), /data-test-view="AdminView"|data-test-view="AdminMatchOperationsV4Panel"|data-test-view="TelegramDiagnosticsModal"|data-test-view="OfflineSyncBanner"/);
assert.match(render({ route: '/admin', admin: true }), /data-test-view="AdminView"/);
assert.doesNotMatch(render({ id: 'player-2', completed: false }), /data-test-view="MatchdayHomeView"/);
assert.doesNotMatch(render({ anonymous: true }), /efl-welcome|data-test-view="MatchdayHomeView"/);
console.log('PASS EFL 2.0: every role gets versioned welcome, public design/themes/navigation/routes; administrator routes remain restricted; anonymous auth remains intact.');
