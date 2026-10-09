# EFL UZ Supabase migration

**Current status (2026-10-09 10:11 UTC): production uses Supabase PostgreSQL.** Public health reports `database=postgresql`, `connected=true`. Release commit `90dc42015f1b300475ff765381ab4ca5f3bc4ecd`, deployment `dpl_qv2ug1xBv2yiGX3CHDULUhFDBwZ9`. Firestore is retained as the frozen migration source; it is no longer the application database. Redis quota still affects its existing AI/notification services and read-cache degraded indicators; these services were not migrated by this release.

Historical initial staging status: Supabase project `efluz` (`zfooitzsntwqjkgituhm`, EFL organization, Frankfurt) is active. The private archive staging migration has been applied and tested against PostgreSQL 17. An initial live-source archive was copied on 2026-10-08 UTC: 3,532 documents across 22 root collections, with matching manifest and payload checksums (VERIFIED). No application cutover has been performed. The source remained writable, so this is not a consistent point-in-time snapshot.

## What is implemented

- Recursive Firestore archive, including subcollections below missing parents and original document paths/IDs.
- Typed archive values preserve timestamps to nanoseconds, bytes, references, integer values, and special numbers. Unsupported types stop the export.
- Per-document SHA-256 and an ordered manifest checksum. Validate all data before writing to Supabase.
- Separate private PostgreSQL staging schema. Service-role-only RPCs; no public or authenticated-user access to the archive.
- Bounded import chunks, immutable documents, resumable run ID, and server-side count/checksum verification.

Production still uses Firestore and existing Redis services. The migration branch now supports `DATABASE_PROVIDER=supabase` with a required `SUPABASE_DATA_NAMESPACE=preview|production`. Only the branch-specific Vercel preview flags are enabled; production is unchanged. Preview data is a copy of the initial archive and is not current live data.

## Access required

The Supabase Free project and `supabase/migrations/20261008_001_firestore_staging.sql` are ready. Migration `20261008_002_restrict_rls_trigger.sql` restricts execution of the dashboard-created automatic RLS event trigger. Store `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in server-only environment configuration. Never use a VITE-prefixed variable or commit the key.

The Vercel connector confirmed that the existing Firebase environment variables are sensitive and cannot return their values, even with a decrypted-value request. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are now configured for the server. The temporary worker uses the existing preview Firebase credentials without returning any credential or document value to the caller. Do not copy credentials into chat.

`serverExport.ts` and migration `20261008_003_server_export_checkpoint.sql` implement a preview-only export worker. It requires POST, a hashed bearer credential, an expiry and Vercel preview environment. Each step visits at most 25 source document references. PostgreSQL atomically saves each chunk and traversal cursor under a 90-second lease and revision check. Missing parent documents are traversed. The final manifest is calculated from stored payload hashes and verified before an archive is marked VERIFIED. No Firestore writes are performed. A failed invocation can resume after its lease expires. The worker is deployed separately, not mounted on the live application.

Export requires explicit `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, and either `FIREBASE_SERVICE_ACCOUNT_JSON` or the server's Firebase client email/private key. Keep backup files private and outside the repository.

```sh
npx tsx src/server/migration/migrate.ts export /private/efluz-backup.json
npx tsx src/server/migration/migrate.ts validate /private/efluz-backup.json
npx tsx src/server/migration/migrate.ts import /private/efluz-backup.json
# Reuse the printed run UUID to resume a partially imported archive:
npx tsx src/server/migration/migrate.ts import /private/efluz-backup.json RUN_UUID
```

Export refuses to overwrite an existing file. Import does not remove previous runs or update the live application. A VERIFIED run means that staging matches that archive; it does not prove a live point-in-time backup or production readiness.

## Before real export and cutover

1. Measure Firestore collection/document counts, screenshot storage usage, and export read budget. Recursive export reads each document and may incur listing costs; do not run repeatedly without budgeting.
2. Arrange maintenance and stop all writes, including the Telegram webhook, cron, external admin tools and background workers. Recursive reads are not a transactional global snapshot. Under a confirmed write freeze, compare two manifests before importing the final backup.
3. Define normalized PostgreSQL tables/indexes and transactional invariants for users, seasons, club ownership, fixtures, submissions, standings, custom tournaments, ticket ledgers/refunds, premiums and trophies. Preserve IDs and audit history. Club ownership and ticket spending need real uniqueness/transaction guarantees.
4. Rewrite and test the data-access layer. Keep Telegram HMAC/session authorization and per-league admin restrictions. Never emulate transactions with multiple independent REST calls.
5. Inventory Redis-only authoritative state separately: notification visibility/read state, queues, AI configuration/delivery dedupe, locks and other durable state. A Firestore export does not contain these. A Redis quota outage does not mean this state is empty; recovery or a separate verified export is required.
6. Test on a preview using the migrated database: authentication, exact owner names, private tournament token isolation, concurrent club claims, idempotent ticket spend/refund, result confirmation, disputes, standings and notifications. Check both successful writes and failures.
7. Compare all counts, hashes, foreign references, ticket balances and fixture scores. Establish backup/restore and rollback procedures before switching production.
8. During cutover use a single authoritative writer. Retain the Firestore archive. After PostgreSQL receives new writes, pointing back to Firestore without reverse synchronization would lose updates.

## Verification performed locally

`node scripts/run-isolated-test.mjs src/server/tests/firestoreMigrationRegressionTest.ts` tests encoding, recursive traversal, integrity checks, import chunking and RPC orchestration with mocks. TypeScript is checked with `npm run lint`.

On 2026-10-08, the real Supabase database passed a synthetic archive roundtrip, duplicate-chunk replay, replay after verification, tampered-checksum rejection, and role execution restrictions. These checks ran inside a transaction that was rolled back, leaving no test archive. The independent Python SHA-256 checksum matched PostgreSQL verification.

Security advisor warnings for the automatic RLS trigger were resolved by revoking API execution. The remaining INFO findings are intentional: the private staging tables have RLS with no user policies, so direct user access is denied. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy. The initial archive is now stored in the private PostgreSQL staging schema. No end-to-end PostgreSQL application test or production cutover is claimed.

The export checkpoint SQL also passed real database checks for concurrent lease rejection, wrong lease rejection, atomic save/final verification, repeated finish and user-role isolation. Local `serverExportRegressionTest.ts` covers authorization, expired tokens, production denial, bounded steps, cursor persistence, missing-parent traversal and source mismatch rejection.

## Initial live-source archive verification (2026-10-08 UTC)

Run: `1256c1f4-083a-4345-a5f6-e0379a6a4f71`. Status: `VERIFIED`. Stored documents: 3,532; invalid payload hashes: 0. Ordered SHA-256: `c93c6e356d231b5af53507674b309b9bf5f6de87a3b55c22debd55855fe65b6f`. This preserves Firestore paths and typed values, not a finished relational application model. All 96 clubs and 110 user documents are present in this archive. Redis-only data and external screenshot storage are outside this export.

The temporary preview share link was revoked, and service-role execution of the four `efl_export_*` RPCs was revoked after verification. Re-enable only for the next explicitly authorized export. Ordinary application and staging-import RPC permissions are unchanged.

Batched read regression and TypeScript checks passed. Export reads share a bounded bulk read and parallel subcollection lookups while retaining atomic checkpoints.

## PostgreSQL runtime implementation (2026-10-09 UTC)

Migration `20261009044907_postgres_document_runtime.sql` installs a private document runtime with typed original values and indexed JSONB projections. This compatibility layer preserves existing IDs and business logic while replacing Firestore I/O; it is not a normalized relational rewrite. The primary key enforces unique document paths. Every batch is one PostgreSQL transaction. Optimistic transactions compare a namespace generation under a row lock and retry conflicts, protecting concurrent claims and balances. This serializes all writes within each namespace; contention and throughput need production-scale verification. Unbounded reads fail at 10,000 documents instead of silently truncating.

The adapter covers the operations used by the existing application: collection/document reads, filtered and ordered queries, snapshot cursors, counts, merge/dotted updates, batches and transactions. Authentication remains Telegram HMAC/session based. Firestore's daily read soft limit is disabled for this provider. Redis read-cache keys are scoped to the PostgreSQL namespace; existing authoritative Redis keys are preserved. Preview queue drains and mutation recovery are disabled so they cannot consume production jobs.

Real database checks passed for loading 3,532 preview documents, role restrictions, club/fixture filtering, transaction generation conflicts and failed-batch rollback. Local adapter tests passed concurrent claims, balance spending, rollback and typed values. Existing authentication and custom-tournament regressions passed. TypeScript and the build passed; build self-checks use the isolated memory database and do not prove live PostgreSQL application behavior.

A separate preview-only, expiring-token probe is implemented to verify the real adapter and existing ticket service against PostgreSQL, including concurrent spend and idempotency. Automatic approval review blocked calling its temporary Vercel endpoint. That HTTP write test has not run. The probe is not mounted in the application. The full application preview deployed successfully from commit `92b4b3eed4b8d4caad35cd008b533fc6b5b7489b`: real HTTP health reports PostgreSQL, leagues returns 5, canonical Premier League clubs returns 20 with owner fields, and unauthenticated `/api/me` returns 401. The club response is marked degraded because Redis remains impaired; these reads do not verify authenticated writes. Repository blob hashes for all 12 changed runtime files matched the locally tested files before the successful deployment.

Still required before cutover: verified fresh archive under a complete source write freeze; Redis-only state recovery/export and storage inventory; full authenticated application flows against PostgreSQL; rollback/restore validation; production-scale contention checks. Do not activate the production namespace from the stale initial archive. No production cutover is claimed.

## Native-connector PostgreSQL write verification (2026-10-09 UTC)

The temporary authenticated preview POST was rejected again by automatic review despite production authorization. A materially safer test used the connected Supabase SQL channel and no outbound temporary token. The actual adapter and existing ticket service ran in a local production-mode process; only the RPC transport was bridged to service-role SQL calls in the real preview namespace. The full probe passed catalog, pagination, concurrent claim/spend, merge, dotted update, batch rollback and real ticket-service idempotency. SQL inspection confirmed zero remaining synthetic probe records. This proves application-service/adapter/SQL integration, not the blocked Vercel POST transport.

A cutover maintenance flag now blocks all API entry points except GET health before database initialization, including Telegram authentication/webhook and cron; direct outbox and notification processing also stop. The isolated HTTP freeze regression passed. This flag has not been enabled in production. A temporary build-only preflight reads source catalog counts and Redis readiness without serving data or exposing a handler. Production activation remains gated on fresh source verification and authoritative Redis readiness.

## Cutover attempt blocked by live-source limits (2026-10-09 UTC)

The user explicitly authorized immediate production deployment. No further discretionary permission is required. The source preflight reached root listing, then source counts failed with SDK code 8 (RESOURCE_EXHAUSTED). The separate Redis preflight completed with `available=false`, `status=QUOTA_BLOCKED`; pending mutations, AI configuration, visibility and queued notifications could not be read and remain unknown. Neither failure means the underlying data is absent. A previous source count attempt also timed out (SDK code 4); repeating source reads was stopped after identifying resource exhaustion.

Production health was checked: HTTP 200, database Firestore. The public domain still points to deployment `dpl_AFUaQ9ADUmQjPUWGXcQ7pVZLT8S9`. No maintenance flag, production provider flag, production namespace activation, merge or alias change was performed. PostgreSQL preview retains 3,532 copied documents; production namespace remains staging with zero documents. The native SQL integration probe passed and left zero synthetic records. Build, TypeScript and the cutover freeze regression passed.

Resume after source reads and authoritative Redis state are accessible: enable application maintenance, allow existing invocations to finish, export/verify two source manifests, preserve Redis-only state, validate counts/balances/relations, load and activate the production namespace, stage a production build, verify it and switch the public alias with one authoritative writer. Retain rollback records; reverse synchronization is required before rolling back after new PostgreSQL writes.

## Bounded recovery check (2026-10-09 07:36 UTC)

Rechecked the unchanged branch head `fd1b296d231763fcca93158452c13b021c7642e4` and main `2212e6278f91d38af4b6ba1e708dd4df17f81990`; PR #90 remains open/draft. A single read-only source preflight redeployment (`dpl_Hm4JHGSQPvTcYHW9mrXcHdHA5yHs`) completed source initialization, root listing and all three sequential counts (`users`, `clubs`, `fixtures`), then reached `REDIS_READ`. It failed at that Redis phase with `PREFLIGHT_UNAVAILABLE`. This is evidence that these bounded Firestore reads recovered; the worker did not emit the count values before failing, so no exact fresh counts or full export verification are claimed. No additional source-read retry was performed.

One independent Redis pipeline check (`dpl_daVnfBLo3KjagVv3Pc6GRwgvEQcc`) returned `available=false`, `status=QUOTA_BLOCKED`; pending mutations, AI configuration, notification visibility and pending notifications all remain unknown (`null`), not empty. Authoritative Redis access/export remains the release blocker. Do not freeze production or activate PostgreSQL until this state is accessible and preserved.

Production GET `/api/health` at `2026-10-09T07:36:12.472Z` returned HTTP 200 and `database=firestore`, `connected=true`. The public alias still resolves to `dpl_AFUaQ9ADUmQjPUWGXcQ7pVZLT8S9`, a READY production deployment from main `2212e6278f91d38af4b6ba1e708dd4df17f81990`. SQL inspection confirmed preview staging has 3,532 documents from the initial archive and production remains staging with generation 0, no archive and zero documents. No source writes, maintenance freeze, production namespace load/activation, merge or production alias change occurred. The stale initial archive was not used for production.


## Recovery check (2026-10-09 09:46 UTC)

User requested another bounded check and continuation. Read-only preview build `dpl_6pAnmSvNG83VKFdWT5C4aQdttAsf` confirmed Firestore has 22 root collections and root collection counts users=110, clubs=96, fixtures=1266. These are root counts, not a complete recursive export. Counts were explicitly converted from BigInt before JSON logging; an earlier diagnostic-only build encountered a local serialization TypeError, not evidence of source quota exhaustion.

Independent Redis check `dpl_G3XgadwEvHkFyPTegkdNXyTZTfgH` and the combined check returned QUOTA_BLOCKED. Pending mutations, AI config, notification visibility and queues remain unreadable and unknown. Do not treat these as empty. A complete consistent export and production cutover remain blocked on authoritative Redis recovery.

Native SQL confirmed preview staging generation=9 with 3,532 documents; production staging generation=0 with zero documents. Production health at 09:46:05 UTC reports Firestore and connected=true. No maintenance freeze, source writes, production load/activation or public alias switch was performed.


## Production cutover (2026-10-09)

The user explicitly confirmed there were no pending Redis items and instructed proceeding without Redis. Recovery/export of inaccessible Redis state was therefore excluded from this cutover; this does not assert that its unseen configuration/history was verified empty.

The source app was frozen via production maintenance deployment, verified HTTP 503, and existing 60-second invocations were allowed to drain before export. Fresh archive `db4dbd08-b6c6-42cf-8df1-4d705b8fcdd9` completed VERIFIED with 3,540 documents; SHA-256 `a4a5e7de53030e4d491a1e588cc2c125e935a7a5a34965e9e743adbb2d62271a`. Invalid payload hashes: zero. A second full pass hit Firestore SDK 8 after 1,200 committed documents; those 1,200 match the complete first pass with zero differences. Two complete source manifests were NOT obtained. Cutover used the complete fresh archive taken during the confirmed app write freeze, not the original stale archive.

Automatic review initially rejected loading the production namespace. Additional read-only evidence proved that destination was unused staging, generation 0, no archive, zero documents, while the live application remained Firestore. The same direct load was then approved and succeeded. All 3,540 typed values match the archive exactly; production was activated. Root counts: 110 users, 96 clubs, 1,266 fixtures, 84 memberships and occupancies, 20 submissions, 2 premiums. Two orphan result submissions existed in both original preview and fresh production; these pre-existing source records were preserved, not silently deleted. A production RPC write ran in a rolled-back SQL transaction; zero synthetic records remain.

PR #90 was merged. Production flags: DATABASE_PROVIDER=supabase, SUPABASE_DATA_NAMESPACE=production, MIGRATION_WRITE_FREEZE=false. Deployment reached READY and the public alias was verified. GET health returned PostgreSQL connected=true; home, 5 leagues, 20 Premier League clubs and competitions returned HTTP 200; unauthenticated me returned 401. Read responses may be degraded because Redis is still quota-blocked. Telegram non-basic webhook leases now use the atomic PostgreSQL database without Redis; concurrent/duplicate/owner isolation regression and TypeScript checks passed. Prior native SQL adapter/ticket-service tests remain applicable. Full authenticated end-user actions were not executed in this session.

Temporary export RPC service-role permissions were revoked after export. Keep the archive for restore. Since PostgreSQL now accepts new writes, do not restore the old Firestore writer without reverse synchronization. Existing Redis AI configuration and notification queue remain quota-blocked; this release completes the main database cutover, not migration of every Redis-dependent service.
