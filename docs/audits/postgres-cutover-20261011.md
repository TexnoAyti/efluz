# PostgreSQL cutover audit — 2026-10-11

## Findings and repairs

| Flow | Remaining dependency / failure | Repair and verification |
| --- | --- | --- |
| Club selection | Required the disabled Redis claim outbox even with a healthy PostgreSQL database | Fixed in PR #101; signed HTTP + native SQL tests include contention, authorization and rollback |
| Personal matchday alerts | Read only prewarmed fixture snapshots and an admin-refreshed recipient directory; absent or historical data could produce zero alerts | PostgreSQL queries the requested competition/round, current occupancies and current users; cold cache and missing-directory tests cover 20 players |
| Round commit followed by queue failure | Round could commit while personal enqueue failed; the response silently reported zero | Notification intent commits with round/locks/audit; failures remain PENDING, worker/reconciliation retries, obsolete deadlines are skipped; admin sees delayed status |
| Bulk personal alerts | Concurrent PostgreSQL enqueues compete on the same receipt/queue documents | Serialize matchday and European-zone enqueue writes; deterministic broadcast IDs deduplicate recovered recipients |
| Dispatch authorization | Existing directory could miss new users or retain an outdated suspension | Worker rechecks current PostgreSQL user before personal delivery; photo recipient policy is preserved |
| Notification read acknowledgements | Legacy circuit / unavailable Redis mutation fallback remained reachable | PostgreSQL persists its private read-state markers directly; ownership remains checked for individual notices |
| Season operations / awards / career | Cold snapshots fell back to the bundled historical SQLite database | PostgreSQL cold reads and current occupancy/user ownership; native test verifies new score and owner changes |

## Persistence inventory reviewed

All non-test `getUpstashClient`, `getBoundedRedisClient`, direct Redis constructors and outbox callers were examined, including read-model freshness/LKG/invalidation/patches, claim receipts, fixture restoration, notification read/visibility/settings, directory refresh, primary/backup queues, worker leases, AI plans/rate limits/emoji/delivery, shared admin review cache, quota cache, read-cost counters, refresh locks, webhook dedupe and reconciliation. Migrated paths delegate to the PostgreSQL stores or explicit document transactions. Legacy Redis outbox/backup operations are disabled after cutover; database outages are not acknowledged through ephemeral SQLite writes.

Fixture snapshots may remain caches; their historical names do not select Redis in a PostgreSQL deployment. Admin health uses `storageProvider` / `storageState`. Existing Firestore implementations remain for deployments selecting that provider.

## Read-only production evidence

- At audit time, all 117 users had ticket wallets and `freeTicketGrantedAt` markers. The welcome grant is account-based, including new users; it is not a fixed-account migration list.
- The recipient directory contained 110 entries, last updated 2026-10-09. PostgreSQL personal delivery now bypasses that historical snapshot.
- Owner photo receipts for La Liga round 9 and Premier League rounds 12/13 recorded successful Telegram delivery on 2026-10-11. No corresponding personal round-alert broadcasts were present in the inspected PostgreSQL queue/receipt data.
- No production rounds, scores, memberships, payments, or user records were altered for this audit. No historical notification replay or test messages were sent to real accounts.

## Verification boundary

Native PGlite executes repository PostgreSQL SQL behind a simulated PostgREST transport. The new test exercises signed admin HTTP → committed round/catalog/intent → injected queue failure → recovery → 20 queued players → mocked Telegram → persisted receipts, plus transfer, suspension, dedupe, cold reports and read-state ownership. This proves application and SQL behavior; it does not prove an actual Telegram client's receipt or hosted latency. Existing PostgreSQL/admin/notification/matchday/Premium/season regression suites and CI cover the surrounding paths. Live checks after release are passive.
