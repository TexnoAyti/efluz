# EFLUZ Browser Design Preview

This mode renders the existing App, AuthProvider, Header, Navigation, home,
league/standings/fixtures, cup/European/UZEFLIFE and club components. Production
styles, release flags, branding, slogans and layouts are retained. There are no
substitute pages. The only added UI is a collapsible development panel.

## Build and inspect

```sh
npm install
npm run build:design-preview
npx vite preview --outDir dist-design-preview --host 127.0.0.1
```

Open `http://127.0.0.1:4173/?designPreview=1`. The panel switches pages, all five
existing domestic leagues, 2026/27 and 2025/26, and the application's actual light
and dark themes. Mobile/desktop choices open the same application in a 390px or
1440px iframe, so real responsive breakpoints apply. Browser device emulation is
also supported. `?designPreview=1&welcome=1` shows the existing welcome flow.

Panel links retain `designPreview`, `previewSeason`, `previewLeague` and
`previewPage` in the URL. For example:

```
/leagues?designPreview=1&previewPage=standings&previewLeague=league-premier-league&previewSeason=season-2026-27
/clubs/club-arsenal?designPreview=1
```

Ordinary dev/build/Vercel preview builds do **not** enable design preview. Only
`--mode design-preview` enables it. Building that mode with
`VERCEL_ENV=production` fails. The production hostname additionally refuses the
mock identity. Missing `designPreview=1` shows the existing authentication wall.

## Isolation

- The preview entry installs a local transport **before** importing App. There
  is no native-fetch fallback. Only explicitly listed synthetic GET responses
  are available; unknown routes, auth, admin, payments, premium, cross-origin
  requests and all non-GET methods return 403.
- XHR, WebSocket, EventSource and beacon transport are blocked. CSP independently
  sets `connect-src 'none'`, disables workers, forms and external frames. Network
  image requests are allowed for existing public official catalogue logos.
- The mock identity has no Telegram ID, session token or admin rights. Results,
  owners and season records are synthetic; no production data is copied. The
  existing bundled UZEFLIFE demo is reused. League tables are computed from demo
  results, and cup rounds reference their source fixtures.
- Telegram startup scripts and analytics are omitted. Backend authorization and
  production environment variables are untouched.
- `build/design-preview-site` contains only static output and preview headers.
  It excludes repository API handlers, server code, credentials, environment
  files and Telegram startup helper pages. Do not deploy the repository root as
  the isolated preview: it contains tracked production API handlers.

## Separate Vercel deployment

Deployment has **not** been performed from this implementation environment:
there is no connected Vercel account/credential. No working preview URL is claimed.

After connecting Vercel, deploy the already prepared static package to a dedicated
project named `efluz-design-preview`. Never link this directory to production EFLUZ.
No environment variables are required.

```sh
npm run build:design-preview
cd build/design-preview-site
npx vercel link --project efluz-design-preview
npx vercel deploy
```

The copied `vercel.json` is `vercel.design-preview.json`: no build/install command,
no framework detection, no functions/crons, static SPA rewrites and security
headers. The CLI deployment above targets Preview by default. Do not add `--prod`
and do not promote it. After deployment, use the returned hostname followed by
`/?designPreview=1` and verify it before sharing a working preview URL.

## Verification

```sh
npm run lint
npm run test:design-preview
npm run test:client-startup
npm run build:design-preview
npx vite build
npx playwright install chromium
npm run test:design-preview:browser
PRODUCTION_TEST=1 npm run test:design-preview:browser
```

`EFL_PREVIEW_CHROMIUM=/path/to/chromium` optionally selects an existing browser.
The browser test serves the actual packaged assets using Playwright request
routing, without a backend. It checks six real page families at 390px and 1440px,
league/season/theme/page navigation, iframe width/close behavior, blocked private
operations, zero private API network requests, and the no-flag authentication
wall. The production test checks that the query flag cannot bypass Telegram.
External image/Telegram/analytics traffic is isolated in these tests; they are
not a live Vercel or CDN availability test. Existing official logo URLs are kept.
The stock frontend build emits its existing large-chunk warning.

Before declaring a deployed URL verified, repeat the page walkthrough on that
hostname, inspect its CSP header and Network panel, verify logos load, confirm no
API functions are deployed and test the production URL's Telegram login wall.
