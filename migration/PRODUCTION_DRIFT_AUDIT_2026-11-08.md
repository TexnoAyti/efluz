# EFLUZ serverless migration — production source drift audit (2026-11-08)

Status: READ-ONLY OBSERVATION; **not a transactionally consistent export**; cutover remains BLOCKED.

Source: connected Supabase project `efluz`, `efl_runtime.documents`, space `production`.
Comparison: `migration/source-collections-inventory.json` (point-in-time baseline, 2026-11-08).

| Metric | Inventory | New read-only observation |
| --- | ---: | ---: |
| Root collections with documents | 72 | 71 |
| Documents | 26,763 | 26,798 |
| Preview documents (separate space) | — | 3,535 |

No newly unknown nonempty root collections were observed. The baseline `result_refresh_jobs` root (1 document; review policy) was absent in the new nonempty-root query. This disappearance is **not** approval to delete or disregard it during migration.

Observed per-root count changes:

| Root | Baseline | Observed | Delta |
| --- | ---: | ---: | ---: |
| telegram_webhook_leases | 9,909 | 9,921 | +12 |
| telegram_ai_state | 6,707 | 6,714 | +7 |
| durable_read_snapshots | 865 | 871 | +6 |
| club_memberships | 158 | 160 | +2 |
| club_occupancies | 158 | 160 | +2 |
| runtime_state | 302 | 304 | +2 |
| user_memberships | 208 | 210 | +2 |
| ticket_transactions | 364 | 365 | +1 |
| user_tickets | 359 | 360 | +1 |
| users | 369 | 370 | +1 |
| result_refresh_jobs | 1 | 0 | -1 |
| **Total** | | | **+35** |

## Next mandatory gate

1. Obtain a transactionally consistent, **read-only** production export at a controlled point in time, plus a final delta plan; store private records outside Git.
2. Re-audit all source roots and unresolved review domains using that export.
3. Perform staging-only normalization/import and independently compare source/target hashes and row counts.
4. Verify runtime parity and the 1,000 distinct authenticated-user staging acceptance gate; keep production webhooks and current Vercel/Supabase traffic unchanged.
5. Do not label Task 1 complete or switch production based on this live count observation.

## Additional read-only observation, 2026-11-08

A subsequent live `SELECT COUNT(*)` from `efl_runtime.documents` filtered by `space='production'` returned **26,849 documents** across **71 nonempty root collections**. This is **51 more documents** than the earlier 26,798 observation, without evidence that individual records are consistent at one moment.

This later observation **does not supersede the inventory policy or establish export completeness**. Never assume a fixed total during import while production remains active. A single-transaction snapshot and source/target normalized hash comparison remain mandatory.

No production database writes, deployment, webhook changes or secret extraction were performed by this audit.
