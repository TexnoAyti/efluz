# Browser design preview

This uses the actual App, Header, league views, standings, fixtures, cups and club profiles. Existing CSS, logos and slogans are unchanged. Public club metadata comes from the existing constants; identities, ownership and match results are synthetic.

## Build and inspect

```
npm install
npm run build:design-preview
node scripts/test-design-preview.mjs
npx serve -s design-preview-static
```

Open `http://localhost:3000/?designPreview=1`. The collapsed designer panel switches pages, leagues (opens standings), seasons and the existing dark/light themes. Mobile and desktop options load the same application in 390px and 1440px iframes. The normal application navigation remains available. `/clubs/club-arsenal?designPreview=1` opens the real club profile.

## Separate Vercel deployment

Upload ONLY `design-preview-static`, to a NEW Vercel project with no inherited production environment variables or Git deployment integration. Its generated vercel.json contains SPA rewrites and CSP headers. Do not upload the repository root: it contains production API functions.

```
cd design-preview-static
vercel --name efluz-design-preview
```

Use the returned Preview deployment URL with `/?designPreview=1`; do not pass `--prod`. Never associate the preview project with the production domain. The build rejects VERCEL_ENV=production. Normal builds do not enable the query flag. The root production Vercel configuration and backend authorization are unchanged.

## Security and scope

Only the explicit design-preview build plus EFL_DESIGN_PREVIEW=1 enables the mode. Every fetch in that build is handled locally, even when the query flag is absent. Known GET routes return synthetic fixtures; unknown routes return 404; writes, admin, authentication, payment and cross-origin requests return 403. CSP connect-src 'none' independently blocks native network connections. Stored session and Telegram credentials are ignored, Telegram scripts and Analytics are removed from preview. The deployment package contains no backend functions.

Populated fixtures cover the existing five-league club catalog, domestic cups and a demo European league phase. Custom user-created tournaments, finances, trophy histories and admin screens are not populated. They are not a route to production data. Preview deliberately cannot submit results or perform account operations.

## Validation status

Passed: TypeScript; preview Vite build; normal production Vite build; build/query transport security tests; existing admin authorization regression. See the implementation report for client startup result.

Browser rendering and navigation require a browser check: automated Chromium could not be downloaded in the execution environment. A live Vercel deployment has not been created or verified because Vercel is not connected. Do not treat this as a verified working hosted preview.

After deployment verify dashboard, each league's clubs/standings/matches, cups, European competition, club profile, light/dark, back/forward, mobile/desktop and season switching. In DevTools confirm no /api network calls, no Telegram credentials, and 403 for attempted writes. Check an ordinary production build with ?designPreview=1 still shows Telegram authentication.
