# EFL UZ Supabase migration

Status: staging tools prepared. No production export, Supabase import, or application cutover has been performed.

## What is implemented

- Recursive Firestore archive, including subcollections below missing parents and original document paths/IDs.
- Typed archive values preserve timestamps to nanoseconds, bytes, references, integer values, and special numbers. Unsupported types stop the export.
- Per-document SHA-256 and an ordered manifest checksum. Validate all data before writing to Supabase.
- Separate private PostgreSQL staging schema. Service-role-only RPCs; no public or authenticated-user access to the archive.
- Bounded import chunks, immutable documents, resumable run ID, and server-side count/checksum verification.

Staging is an archive, not the application's final relational model. The runtime still uses Firestore and existing Redis services. Do not set a PostgreSQL provider flag or remove Firestore configuration yet.

## Access required

Create/connect a Supabase Free project. Apply `supabase/migrations/20261008_001_firestore_staging.sql` using its SQL Editor or an authenticated PostgreSQL connection. Store `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in server-only environment configuration. Never use a VITE-prefixed variable or commit the key.

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

PostgreSQL functions have not been executed against Supabase yet. No actual production-data migration or end-to-end PostgreSQL runtime test is claimed.
