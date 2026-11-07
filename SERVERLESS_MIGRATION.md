# EFLUZ Telegram Serverless migration

Production remains on Vercel until parity checks pass. Do not run `tgcloud push`,
`tgcloud migrate`, or `tgcloud webhook sync` from this branch against the live bot.

## Cutover gates

- Core tables imported with row counts and checksums verified.
- Mini App uses `Telegram.WebApp.Serverless.call` for all authenticated reads/writes.
- Club profile, leagues, fixtures, domestic cups, result confirmation and match chat pass.
- Message, callback query, channel post and pre-checkout handlers pass replay tests.
- Admin operations are owner-checked and idempotent.
- Second-season admission and one-club ownership constraints pass concurrency tests.
- A rollback webhook command is prepared and tested before final cutover.

The final webhook switch is the last step, never the first.

## Block 2 — shadow batch import (not cut over)

- `tgcloud/endpoints/importBatch.js` accepts at most 100 complete rows per call.
- Required input: `{ "table": "users", "batchId": "users:000001", "rows": [...] }`.
- Supported logical tables: users, seasons, leagues, clubs, clubOccupancies, fixtures, matchAccess, matchMessages.
- Import parent tables before children: users/seasons → leagues → clubs → clubOccupancies → fixtures → matchAccess → matchMessages.
- Use stable, unique batch IDs for each table and offset. A batch ID cannot be reused with different content.
- Every row is inserted with `ON CONFLICT DO NOTHING` and then compared against the source. Existing nonidentical rows fail closed (`ROW_CONFLICT`), never overwritten.
- `efl_migration_state` records completed batch ID, final primary key, source content and count only after verification. Resend interrupted batches; identical rows are skipped.
- **Default denied**: `tgcloud/lib/importControl.js` has `enabled: false` and an empty owner ID. Telegram's V8 isolate does not offer Node `process.env`. The owner must explicitly configure the exact Telegram ID and enable the gate only in a reviewed, isolated migration deployment. Never enable from a browser-controlled parameter.
- This importer is **not** a production exporter and does not initiate transfer by itself. Capture a consistent read-only source snapshot separately and verify per-table counts and full-data checksums before enabling new reads.
- Import cannot atomically snapshot an actively changing Vercel database. Perform a final delta import under a controlled write freeze before any eventual cutover. Do not enable that freeze during this shadow phase.
- For current validation: `node --test scripts/serverlessMigration.test.mjs`. Endpoint persistence/integration tests against an isolated Telegram Serverless database and production snapshot parity are **still required**.

## Frontend transport adapter

- `src/lib/serverlessTransport.ts` exposes `callEflTransport` and `telegramServerlessAvailable`.
- Default transport is Vercel. `VITE_EFL_API_TRANSPORT=telegram-serverless` is a **build-time** experimental opt-in for explicitly routed calls; existing `src/lib/api.ts` remains on Vercel until response contracts have been tested.
- Explicit operations: `health`, `bootstrap`, `leagues`, `clubProfile`, `matchChat`.
- The adapter never forwards raw Telegram initData, never retries a mutation on the other provider and never silently changes existing `/api` calls.
- During parity testing, call `callEflTransport({operation:'health',vercel: async()=>({source:'vercel'})})` in a controlled test harness. Integrate one real UI operation at a time after response mapping is verified.

## SDK compatibility note

`Telegram.WebApp.Serverless.call` uses an error-first callback. `src/lib/serverlessTransport.ts` wraps that callback in a Promise and times out without falling back to Vercel. The existing API client exposes `probeMigrationTransport('telegram-serverless')`, which is wired to an admin-only manual check in Telegram Diagnostics. This is **not** a production routing switch.

## Offline packet preparation

When an authorized offline extraction and exact schema mapping have produced a complete normalized JSON snapshot, run `node scripts/prepareServerlessImport.mjs normalized-snapshot.json private-output`. The generated manifest contains row counts and SHA-256 per table and packet. Keep the JSON files off GitHub and outside static hosting. A normalized export is **not** yet implemented for the current Firestore/SQLite production schema; do not claim it has been transferred.

Run `node --test scripts/serverlessMigration.test.mjs scripts/serverlessMigrationReplay.test.mjs` locally after fetching the branch. Do not run CLI push, migrate, or webhook sync against the current live bot.
