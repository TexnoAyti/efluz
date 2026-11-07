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
- **Default denied**: the Telegram Serverless environment must explicitly set `EFL_MIGRATION_IMPORT_ENABLED=true` and `EFL_MIGRATION_OWNER_TELEGRAM_ID` to the owner ID. Never use a browser-controlled parameter for this permission.
- This importer is **not** a production exporter and does not initiate transfer by itself. Capture a consistent read-only source snapshot separately and verify per-table counts and full-data checksums before enabling new reads.
- Import cannot atomically snapshot an actively changing Vercel database. Perform a final delta import under a controlled write freeze before any eventual cutover. Do not enable that freeze during this shadow phase.
- For current validation: `node --test scripts/serverlessMigration.test.mjs`. Endpoint persistence/integration tests against an isolated Telegram Serverless database and production snapshot parity are **still required**.

## Frontend transport adapter

- `src/lib/serverlessTransport.ts` exposes `callEflTransport` and `telegramServerlessAvailable`.
- Default transport is Vercel. `VITE_EFL_API_TRANSPORT=telegram-serverless` is a **build-time** experimental opt-in for explicitly routed calls; existing `src/lib/api.ts` remains on Vercel until response contracts have been tested.
- Explicit operations: `health`, `bootstrap`, `leagues`, `clubProfile`, `matchChat`.
- The adapter never forwards raw Telegram initData, never retries a mutation on the other provider and never silently changes existing `/api` calls.
- During parity testing, call `callEflTransport({operation:'health',vercel: async()=>({source:'vercel'})})` in a controlled test harness. Integrate one real UI operation at a time after response mapping is verified.
