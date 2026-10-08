# EFL UZ Supabase migration

Status: Supabase project `efluz` (`zfooitzsntwqjkgituhm`, EFL organization, Frankfurt) is active. The private archive staging migration has been applied and tested against PostgreSQL 17. An initial live-source archive was copied on 2026-10-08 UTC: 3,532 documents across 22 root collections, with matching manifest and payload checksums (VERIFIED). No application cutover has been performed. The source remained writable, so this is not a consistent point-in-time snapshot.

## What is implemented

- Recursive Firestore archive, including subcollections below missing parents and original document paths/IDs.
- Typed archive values preserve timestamps to nanoseconds, bytes, references, integer values, and special numbers. Unsupported types stop the export.
- Per-document SHA-256 and an ordered manifest checksum. Validate all data before writing to Supabase.
- Separate private PostgreSQL staging schema. Service-role-only RPCs; no public or authenticated-user access to the archive.
- Bounded import chunks, immutable documents, resumable run ID, and server-side count/checksum verification.

Staging is an archive, not the application's final relational model. The runtime still uses Firestore and existing Redis services. Do not set a PostgreSQL provider flag or remove Firestore configuration yet.

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
