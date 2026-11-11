# EFLUZ serverless dependency audit — 2026-11-11

## Scope
Read-only GitHub Actions inspection of 511 TypeScript source files under src/server at commit descended from production. **No application tables, user records, teams, live fixtures, scores, or Redis queue contents were modified.**

Production environment (verified by Vercel connector): DATABASE_PROVIDER=supabase, SUPABASE_DATA_NAMESPACE=production, DISABLE_BACKGROUND_WORKERS=true, MIGRATION_WRITE_FREEZE=false. PostgreSQL cutover and historical data export are **already completed**; there is no rationale to reimport an old Firestore/SQLite snapshot onto active user data.

## Static source inventory (not runtime proof)
The audit command `node scripts/audit-serverless-legacy.mjs` found 108 source files with matching patterns (categories overlap):
- 74 SQLite import/function textual matches
- 369 Firestore adapter/SDK textual matches
- 58 Redis client/helper textual matches
- 3 temporary file/SQLite path references

**Interpretation:** These are syntactic references, *not* counts of active production database reads or distinct migration blockers. The Firestore compatibility adapter intentionally uses a PostgreSQL document store when DATABASE_PROVIDER=supabase. Old code, tests, fallback logic and build-time assets may account for part of this inventory.

## Prioritized source review
1. `src/server/firebase/firestoreStore.ts` (33 direct SQLite textual matches): confirm each remaining fallback executes only when provider is not Supabase; proactively fail closed instead of persisting user data to ephemeral SQLite.
2. `src/server/sync/mutationQueue.ts` (5 SQLite matches and one /tmp path): verify recovery cannot use local disk or legacy outbox in Supabase.
3. `src/server/tournament/domesticCupService.ts` (4 matches): check current cup draw/result mutations and rollback behavior in PostgreSQL.
4. `src/server/routes/consistencyGuard.routes.ts` (4 matches): first verify route is mounted; prohibit production SQLite-backed fixture restoration/removal.
5. `src/server/app.ts` (3 matches): many routes still initialize bundled SQLite /tmp via ensureDbReady; classify requests for which it is no longer needed before removing. Blindly disabling it can break catalog and results.

## First verified fix
The admin `POST /api/health/sync` previously called the legacy `processPendingMutations()` directly, bypassing DISABLE_BACKGROUND_WORKERS=true. It now checks `workerLaneEnabled('reconciliation')`, returns HTTP 423 while paused, and dispatches to `reconcileDurableMutations()` under DATABASE_PROVIDER=supabase; the legacy function remains exclusively for non-Supabase deployments. This preserves data, maintenance switches, and admin authorization.

## Verification and next gates
- GitHub Actions run 43069649799: full audit, recovery lane and HTTP maintenance regressions, startup production build — PASS.
- Do **not** re-run the terminal import or merge Firestore archives into the active production namespace.
- Next: review active PostgreSQL fallback paths in priority order, prove read/write isolation, and test on signed non-production synthetic data.
- Keep recovery mode paused until real Telegram login and real database latency are verified. Restore notifications only in bounded batches and only after validating stale-message policy.
- Production cutover is **not complete** just because build or /api/health returns 200; verify a cold signed user, club selection, fixture, admin controls, notification replay and worker cron.
