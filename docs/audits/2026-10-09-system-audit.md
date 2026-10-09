# EFL UZ system audit — 2026-10-09

This audit covers the current React/Express app using the production PostgreSQL namespace. It does not claim every authenticated production journey has been performed.

## Changes

- Move AI configuration, limits, conversation context, reply indexes, delivery claims, admin plans and emoji state to PostgreSQL in migrated deployments. Unsupported atomic operations fail explicitly.
- Read AI grounding snapshots from PostgreSQL, including newer fixture deltas and stale-state flags.
- Move Telegram broadcast/smart-notification queue state and delivery receipts to PostgreSQL. Keep the worker lease, explicit-rejection retries and no automatic resend after uncertain delivery.
- Give migrated AI requests a bounded 30-second budget; retain pre-send scope/config checks. Increase client timeouts for broadcast enqueue/retry (45 seconds) and AI configuration (30 seconds).
- Avoid crashing the admin authorization error path when request URL metadata is absent.
- Update obsolete source-contract assertions and implement the missing lease-release behavior in the isolated Redis mock.

## Verification

| Check | Result | Boundary |
|---|---|---|
| Independent regression/contract suites | 91/91 passed | Isolated test data, external network blocked |
| Actual local Redis durability suite | Passed | Includes the club-claim suite requiring real Redis; Telegram mocked |
| PostgreSQL service/adapter integration | Passed | Authenticated ticket HTTP, owner restriction, canonical recipient, grant dedupe, spend/refund |
| PostgreSQL AI | Passed | Configuration persistence, owner checks, parallel rate limits, control exemption, one delivery claimant, plan replacement, fixture deltas, aborted writes |
| PostgreSQL notifications | Passed | Duplicate event, mocked HTTP 429 retry, durable SENT receipt, no resend after completion |
| TypeScript and production build | Passed | Deployment self-check included |
| Live public API | HTTP 200 | Health connected; 5 leagues; 17 visible competitions; Serie A 190 visible fixtures and 20 standings rows |
| Live unauthenticated access | HTTP 401 | /api/me and /api/admin/overview |
| Browser | Expected Telegram entry gate rendered | Cloud browser has no authenticated Telegram session |
| Production ownership integrity | No duplicate active club owners | One orphan user reference noted below |
| Production derived-result queue | No pending jobs at audit time | Count-only SQL |
| Database security advisor | Informational notices only | Private tables have RLS and deny anon/authenticated direct table access |

Public API timings from the audit transport ranged approximately 4.8–10.8 seconds, including network overhead. These measurements are not pure server/database timings.

## Remaining limits and required configuration

- The old AI topic/enabled settings were stored only in unavailable Redis. No topic or enabled state was invented. The primary owner must bind the intended topic with `/bind_ai_topic` and enable AI using its controls.
- Arsenal has an active legacy ownership reference whose user document is missing. Ownership is preserved pending an authoritative owner decision; no guessed replacement or club release was performed.
- Real Telegram login, new grants from the owner production session, model replies and delivery to real recipients were not executed. Integration tests use synthetic identities and mocked outbound services.
- The original Inter–Milan duplicate remains stored for recovery and is excluded by the explicit retired-fixture rule. The live Serie A endpoint returns 190 fixtures.
- The compatibility notification store preserves whole queue/receipt values per key. Large-scale throughput/history partitioning has not been benchmarked; current tests verify correctness, not a production load guarantee.
