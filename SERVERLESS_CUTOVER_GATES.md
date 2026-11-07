# EFLUZ Telegram Serverless cutover gates (draft)

Status on 2026-11-07: **NOT READY**. Production and its webhook MUST remain on Vercel.

## What exists on the migration branch
- Telegram runtime schema for 15 logical entities; owner-locked import endpoint and
  retry-safe batch importer; offline packet builder; source/target parity checker.
- Read endpoints: health, bootstrap, leagues, clubProfile, fixtures, standings
  (standings is explicitly provisional and not an authoritative competition table).
- Match chat read/send endpoint (SDK integration and concurrency tests pending).
- Vercel-first frontend adapter, explicit Serverless health probe, diagnostics.
- Isolated Node tests, real SQLite SQL integration tests and CI workflow. Telegram-hosted SDK tests are still required.

## Mandatory gates before any cutover

| Component | State | Required proof |
| --- | --- | --- |
| Snapshot & delta export from actual production Firestore/SQLite/Postgres | NOT IMPLEMENTED | All relevant datasets exported from consistent read-only snapshot |
| Legacy domain conversion | NOT IMPLEMENTED | Per-field lossless conversions, including timestamps/status/IDs |
| Core import to isolated Telegram database | NOT RUN | No conflicts, counts+SHA-256 parity |
| Extra domain data | NOT IMPLEMENTED | Schema now includes participants, submissions, disputes, notifications and audit; their source conversion and parity remain unverified. Standings snapshots, payments, TEAMS, UZEFLIFE, cups and awards still need coverage |
| Club claim / release | STAGING CLAIM ENGINE (DISABLED) | The new claim endpoint checks user, season, admission and uniqueness; full ban/admission policy parity, release flows and Telegram-hosted race tests are still missing |
| Fixtures / score submission / confirmation | STAGING PROPOSAL + OPPONENT CONFIRMATION (DISABLED) | Guarded, opponent-only confirmation checks active ownership, open round, duplicate/conflicting submissions and disputes in SQLite; admin override, audit, notification, real Telegram SDK and official policy parity remain missing |
| Admin tools | READ-ONLY STAGING OVERVIEW | Admin role enforced using signed Telegram user, summary counts only; mutation controls, audit trails, payments and complete UI not migrated |
| Chat | STAGING SQL ENGINE TESTED | SDK-independent persisted write confirmation, ACL/replay/read-only SQLite tests pass; actual Telegram-hosted SDK and owner-release parity still needed |
| Telegram updates | PRIVATE READ-ONLY COMMANDS AND CALLBACKS | Staging /start, /help, /myclub, /serverless-check, callback status/club; group posts, payments, full bot flows not migrated |
| AI assistant | NOT IMPLEMENTED | Authorization, quotas, no unsafe mutations, parity |
| Notifications and scheduled work | NOT IMPLEMENTED | Delivery deduplication, timers/cron replacement, replay proof |
| Frontend | SHADOW ONLY | Every authenticated API call migrated with parity and UI E2E; new writes intentionally not routed live |
| Static Mini App hosting | ISOLATED STAGING SMOKE BUILD, NOT DEPLOYED | Dedicated Vercel-free read-only smoke page in `tgcloud-staging/`; CI verifies no backend bundles/legacy routes; full React UI not yet migrated |
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

## Evidence from connected Supabase (read-only, 2026-11-07)

Confirmed EFLUZ source project has `efl_runtime` data in **two distinct spaces**:
- production: **26,111** documents, generation observed as 256837, mode active
- preview: **3,535** documents, generation observed as 77, mode staging

The old `efl_migration` schema has two VERIFIED runs with **3,532**
and **3,540** documents, from earlier export work. These are **not a
current production snapshot** and do not prove parity with 26,111
production documents.

Important production collections include:
`telegram_webhook_leases`, `telegram_ai_state`, `notifications`,
`fixtures`, `audit_logs`, `users`, `ticket_transactions`,
`user_tickets`, `competition_participants`, `uzeflife_audit`,
`club_memberships`, `club_occupancies` and many more.

The new `efl_raw_documents` archive schema and
`scripts/prepareSupabaseDocumentArchive.mjs` can preserve source
documents in lossless batches **once an authorized current snapshot is
exported**, but the archive alone cannot execute the existing business
logic. Reimplementing Telegram handlers, TEAMS, UZEFLIFE, tickets, AI,
club selection and admin workflows remains mandatory.

No production SQL modifications, migrations, webhook changes or
Telegram Serverless CLI pushes were performed in this audit.

## New shadow write checks

- `tgcloud/endpoints/claimClub.js` and `tgcloud/endpoints/proposeResult.js`
  have an explicit **disabled-by-default** `MUTATION_CONTROL` gate.
  They must not be enabled as a shortcut to production cutover.
- `scripts/serverlessSqliteIntegration.test.mjs` exercises real SQLite
  partial unique indexes, duplicate/replay cases and score proposal eligibility.
- `scripts/checkTgcloudModules.mjs` verifies that the Telegram runtime imports
  only the SDK and local .js modules (no Node packages in deployed modules).
- The import engine validates every persisted row, reports `verified` and
  `previouslyPresent`, and does not claim unsupported `rowsAffected` counts.
- The provisional standings query only includes confirmed fixtures belonging
  to competitions typed `LEAGUE`, not cup fixtures.

**Next gate:** run the exact branch under `tgcloud run` using an isolated bot
and migrated staging schema, then compare EFLUZ production domain behavior.
Passing offline SQL tests does not prove the platform-specific SDK contract,
Telegram handler parity or current production data parity.

## Isolated Telegram Mini App static hosting

Use `npm run build:tgcloud` to create `dist-tgcloud` from the isolated
`tgcloud-staging/` read-only smoke page. The
`tgcloud.jsonc` file now points only to that folder, **not** the regular
`dist` folder containing the Node server bundle. The shadow workflow
checks `node scripts/verifyTgcloudStatic.mjs` after building and rejects
legacy API calls in the compiled bundle. Static files
must not be deployed to the production bot while existing client routes
still call the legacy Vercel API. `npx tgcloud push` is a separate,
operator-controlled step after backend feature parity and staging approval.

## Match chat hardening

The chat endpoint now delegates to `tgcloud/lib/matchChatEngine.js`. It
rechecks write permissions inside SQL and **verifies the persisted record**
for every client ID; no unsupported SDK `rowsAffected` check remains.
`scripts/serverlessMatchChatSqlite.test.mjs` uses a real SQLite engine for
signed-user access, retries, revoked write permissions and cross-match ID
conflicts. Passing these tests **does not** make the endpoint ready for real
users without Telegram Serverless staging and club-release lifecycle tests.

## Opponent result confirmation (shadow only)

The `tgcloud/endpoints/confirmResult.js` endpoint is guarded by
`MUTATION_CONTROL.enabled=false`. The pure engine in
`tgcloud/lib/confirmResult.js` accepts only a submission ID from the
verified Telegram user, rejects self-confirmation, and uses a conditional SQL
UPDATE so released, banned or unrelated users and closed rounds cannot confirm.
It refuses to confirm when the responding owner has submitted a conflicting
score or the fixture has a pending/open dispute. The SQLite regression suite
`scripts/serverlessConfirmResultSqlite.test.mjs` exercises these paths.

Still required before enabling: official matchday policy mapping, first/second
season rules, exactly-once audit and notification side effects, dispute
resolution, admin overrides, live Telegram SDK smoke tests and source/target
fixture parity. **Never enable all shadow mutations merely to pass a demo.**

## Staging bot and staff overview (this branch)

- `tgcloud/handlers/message.js` now supports read-only `/start`,
  `/help`, `/myclub` and `/serverless-check` in private chat only.
  The user's Telegram ID is obtained from the platform-signed message,
  not from command arguments. Private club ownership never appears in
  group responses.
- `tgcloud/handlers/callback_query.js` accepts only `efl:status`
  and `efl:myclub`; it ignores other callbacks and groups, leaving
  production tournament controls disabled.
- `tgcloud/endpoints/adminOverview.js` is a read-only authenticated,
  non-banned-admin endpoint returning aggregate counts. It never
  returns raw player records and does not mutate any data.
- SQLite tests cover unauthorized users, banned admins, mixed chat
  identities and safe callback handling.

**Reminder:** this is not a functional replacement for the current
Telegram bot, web app or admin panel. The existing production webhook
must not be switched until the missing handlers and operational workflows
have been implemented, tested on a separate Telegram bot, and validated
against a fresh production snapshot.

## Production source collection audit

Read-only inventory on 2026-11-07 identified **71 collection roots** and
**26,305 total documents** (dynamic counts; do not treat as current cutover
snapshot). The source inventory JSON in `migration/source-collections-inventory.json`
records the roots, a historical count and a provisional retention status.
`scripts/auditEflSourceInventory.mjs` fails for unknown collection roots;
`--strict` also fails while any nonempty `review` collection remains.
The raw document importer now deliberately **excludes** sensitive ephemeral
login sessions, webhook leases and derived snapshots from a live target,
while retaining them in the operator's private source export. It refuses
unreviewed collections instead of silently copying or discarding them.
`scripts/verifyEflRawBatches.mjs` reconciles preserved and excluded
source counts before considering an archive valid.

**This is not complete legacy-to-new-domain conversion.** The migration
cannot proceed as production-ready until every reviewed collection, official
competition rule, worker queue and payment/notification side effect is
independently reconciled.
