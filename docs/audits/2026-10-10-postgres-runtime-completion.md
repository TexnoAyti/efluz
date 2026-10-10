# PostgreSQL runtime completion — unreleased

Production remains on `efbeaa31b4ac18df608bc09d38b74d4ea8112e6b`. These changes extend PR #91 and have not been merged or promoted. The production namespace and existing RPC definitions were not changed.

## Implemented

- Provider-selected PostgreSQL state for image exports, qualification previews, smart notification settings, premium preferences/badge cache, hourly deadline leases, rate limits and quota-read caches.
- Admin shared cache, read-refresh leases and instrumented read-cost counters use PostgreSQL through the bounded state transport.
- Matchday notification producers use the same PostgreSQL queue as the worker. A durable event ID deduplicates enqueue and survives process replacement.
- Legacy primary/backup Redis clients are disabled when `DATABASE_PROVIDER=supabase`, including when old credentials are present. PostgreSQL outages cannot fall back to writing the old outbox.
- Consumed qualification tokens cannot revive from process memory. A settings outage cannot replace a persisted notification off switch with enabled defaults.
- Runtime state enforces logical TTL immediately. Active Vercel traffic opportunistically removes up to 100 expired rows per minute; deletion re-checks the rows transactionally. Idle deployments retain physically expired rows until later traffic.
- Admin read-model health uses the selected storage provider, so disabled Redis does not mark a connected PostgreSQL deployment down.

The runtime uses the existing private document adapter and namespace. No normalized schema rewrite or ownership reassignment is included.

## Hosted concurrency finding and migration prerequisite

A temporary, authenticated preview ran real PostgreSQL writes in the `preview` namespace. Concurrent generation mismatches repeatedly raised SQLSTATE `40001` in `efl_runtime_commit`; multiple HTTP calls timed out after 15 seconds. The hosted probe failed and reported successful cleanup. Its shareable access was revoked.

The new `efl_runtime_commit_safe` RPC catches the serialization failure and returns `{ "conflict": true }`. The TypeScript adapter then re-reads the current generation and retries its transaction callback. The legacy RPC is preserved for the existing production client. The new function uses invoker permissions and permits only `service_role` execution.

The additive RPC migration is `supabase/migrations/20261010091409_application_runtime_commit_conflicts.sql`. Applying even the proposed preview-only RPC to the shared Supabase project was rejected by automatic approval review because production changes require explicit user approval. The migration is therefore **not installed**. Do not merge/deploy the new client before installing and verifying the new RPC.

## Verification evidence

- Existing 77 regression suites passed locally (two direct `tsx` invocations hit the environment's IPC restriction, then passed using the isolated Node runner).
- Migrated runtime suite passed with primary Redis, backup Redis and Telegram transport forbidden. Includes actual image create/download HTTP, HTTP rate limiting, preview consumption, settings, premium badges/invalidation, hourly deadline lock, producer/worker queue consistency, stale-reader publication rejection and admin cache invalidation.
- Native PostgreSQL WASM integration uses the repository's SQL migrations in PGlite. The HTTP envelope is simulated. It passed private invoker grant checks, 12 parallel NX attempts, four concurrent counters, expiry cleanup, generation conflict retries, unchanged state after a stale write, ticket double-spend exclusion, atomic batch rollback and queue claim/deduplication.
- TypeScript, production build, generated API invocation and public design/role verification passed. GitHub CI is the final gate for the legacy real-Redis and capacity suites; `redis-server` is absent in the local environment.

These results do not prove the new RPC works through hosted PostgREST, production throughput, real Telegram login, message delivery or mobile startup time. The new hosted verification is blocked until the migration is approved and installed.

## Rollout order after approval

1. Apply the additive safe-commit migration and check invoker permissions/service-role grants.
2. Re-run the authenticated hosted PostgreSQL preview probe; require PASS, confirmed cleanup and no Redis/Telegram calls.
3. Require GitHub CI to pass, merge PR #91, and verify the new production deployment/health.
4. Verify real Telegram login and user/admin flows without generating unsolicited messages. Stop at a failed boundary.

Rollback the application to the previous deployment if needed. The unused additive RPC can remain without changing the legacy application's behavior.

## Data and configuration kept pending

The three pre-existing membership/occupancy inconsistencies (Monaco, Toulouse, Arsenal), missing Arsenal membership user and two orphan test-result submissions were preserved. No ownership or test record was deleted or guessed. AI remains disabled/unbound when no owner-approved topic configuration exists in the PostgreSQL AI store. Old Redis settings/history were not silently imported or represented as empty.
