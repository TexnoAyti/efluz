# EFLUZ Telegram Serverless cutover gates (draft)

Status on 2026-11-07: **NOT READY**. Production and its webhook MUST remain on Vercel.

## What exists on the migration branch
- Telegram runtime schema for 8 core entities; owner-locked import endpoint and
  retry-safe batch importer; offline packet builder; source/target parity checker.
- Read endpoints: health, bootstrap, leagues, clubProfile, fixtures, standings
  (standings is explicitly provisional and not an authoritative competition table).
- Match chat read/send endpoint (SDK integration and concurrency tests pending).
- Vercel-first frontend adapter, explicit Serverless health probe, diagnostics.
- Isolated Node tests and CI workflow; no proof of passing hosted SDK tests.

## Mandatory gates before any cutover

| Component | State | Required proof |
| --- | --- | --- |
| Snapshot & delta export from actual production Firestore/SQLite/Postgres | NOT IMPLEMENTED | All relevant datasets exported from consistent read-only snapshot |
| Legacy domain conversion | NOT IMPLEMENTED | Per-field lossless conversions, including timestamps/status/IDs |
| Core import to isolated Telegram database | NOT RUN | No conflicts, counts+SHA-256 parity |
| Extra domain data | NOT IMPLEMENTED | Competition participants, submissions, disputes, standings snapshots, notifications, audit logs, payments, TEAMS, UZEFLIFE, cups, awards |
| Club claim / release | NOT IMPLEMENTED | Single-club ownership, bans, admission windows, concurrent users |
| Fixtures / score submission / confirmation | READ ONLY | Replay- and race-safe writes, matchday rules, dispute outcomes |
| Admin tools | NOT IMPLEMENTED | Auth/role checks, side-effect audit, all required actions |
| Chat | PARTIAL | SDK-integrated persistence, read-only gating, retries under race |
| Telegram updates | PROBE ONLY | message, callback_query, channel posts, payment events |
| AI assistant | NOT IMPLEMENTED | Authorization, quotas, no unsafe mutations, parity |
| Notifications and scheduled work | NOT IMPLEMENTED | Delivery deduplication, timers/cron replacement, replay proof |
| Frontend | SHADOW ONLY | Every authenticated API call migrated with parity and UI E2E |
| Static Mini App hosting | NOT CONFIGURED | Build output configured for tgcloud, signed launch smoke test |
| Performance and errors | NOT MEASURED | Load, retries, timeout, rollback monitoring |
| Rollback | NOT PREPARED | Restore exact prior webhook and legacy frontend routing |

## Safe execution order

1. Freeze a test snapshot from production via an authorized read-only exporter.
   Keep all user data out of Git, source maps, frontend bundles and logs.
2. Create a separate test bot/project and apply reviewed Serverless schema there.
3. Map all legacy entities, import core tables, then the complete extended domain.
   Reject missing/unknown fields and missing references.
4. Export target normalized tables independently. Run
   `node scripts/verifyServerlessSnapshot.mjs source-normalized.json target-normalized.json`.
   Every table must match exactly.
5. Implement each missing write route and handler with permission checks,
   transactional invariants, idempotency keys and regression tests.
6. Run two-user contention tests, second-season and domestic/international-cup
   tests, official and user notifications, payments, AI and admin regression.
7. Build the frontend for Telegram hosting, verify all API routes, and stage it.
8. Prepare a verified rollback. Only then arrange a controlled write-freeze,
   final delta sync and authorized webhook switch. After cutover perform
   real-user smoke testing and remove Vercel dependencies.

**Do not mark this project complete merely because the repository builds.
Do not push the draft branch to the production bot.**
