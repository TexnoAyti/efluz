# UZEFLIFE championship

A dedicated Uzbek competition workspace in the existing competition hub. Existing custom tournament records, links and APIs remain intact; its navigation entry defaults to hidden for everyone, including the platform owner, and is last in the navigation configuration. The platform owner can restore it from UZEFLIFE administration.

## Runtime and permissions

`/api/uzeflife` uses existing Telegram/session authentication and the authoritative account lookup. Tournament roles are stored only in `uzeflife/championship`; they never modify platform admin flags. The existing database adapter supports both Firestore and the PostgreSQL document runtime. Every state change and its `uzeflife_audit` record commit in one transaction, with conflict retries through the existing adapter. Unavailable storage fails closed.

Only primary owner Telegram ID 5209126900 can assign/revoke the tournament Super Admin or restore custom navigation. The Super Admin can grant/revoke eight assistant permissions. Verified existing account or Telegram IDs are resolved server side. Role checks repeat within the write transaction; suspended accounts are denied on each request. Maximum 32 assistants, 8 channels and 100 announcements bound the championship document.

Channel membership is verified with `getChatMember`, concurrently with an eight-second timeout, for registration and participant result submission. Creator, administrator, member and restricted members with `is_member=true` pass. API errors, missing credentials and uncertain membership fail closed. Verification never applies to other tournament APIs. The bot must be administrator in each configured channel; configure TELEGRAM_BOT_TOKEN only on the server.

## Championship interface

UZEFLIFE is one fixed championship, not a creation wizard or tournament catalog. It sits between Cups and European competitions. The public overview shows registration status, eight qualifier brackets and the final stage. A connected bracket tree is available before the draw using presentation-only empty slots; these never enroll players or create database fixtures. Match reports and schedules open from a selected real match. Administrative forms are behind a separate management destination. Only the owner can explicitly restore custom tournament navigation from the collapsed platform-menu setting.

## Competition

Registration requests require administrator approval. Exactly 256 approved players generate a random draw into eight 32-player knockout brackets. Rounds 1–5 yield eight winners; rounds 6–8 are quarterfinals, semifinals and final. All 255 slots are created atomically with empty future entrants. Only confirmed winners populate the next slot. No assumed winners or BYEs.

Participants propose results; the opponent must submit matching scores, or an authorized result administrator approves/corrects. Draws require decisive penalties. Administrators advance rounds manually after every current match is decided; pause/resume and final completion are Super Admin actions. Removed participants cannot submit results. After play starts, removing a participant retains all historic fixtures; the result administrator must award the technical result, then advance normally. Previous rounds are locked after progression.

## Preview and release

Use a Vercel **Preview** build and `/?designPreview=1`, then Turnirlar → UZEFLIFE. This uses bundled synthetic participants and blocks all UZEFLIFE writes and API reads. Production builds do not enable the design flag. Actual signed-in preview API testing must use `SUPABASE_DATA_NAMESPACE=preview` with an isolated database environment and test bot/channels. Never point preview at production data.

Changes belong to a feature branch/PR. Do not merge or deploy production until hosted preview and real Telegram channel checks are verified. Local mocked Telegram tests prove fail-closed behavior, not real bot/channel permissions.

## Verification

- `node scripts/run-isolated-test.mjs src/server/tests/uzeflifePresentationTest.ts`
- `npm run lint`
- `node scripts/run-isolated-test.mjs src/server/tests/uzeflifeRegressionTest.ts`
- `node scripts/run-isolated-test.mjs src/server/tests/postgresSqlIntegrationTest.ts` (includes UZEFLIFE HTTP with native PostgreSQL SQL, rollback, concurrent writes, role revocation and mocked Telegram)
- `npm run build` (includes deployment self-check)
