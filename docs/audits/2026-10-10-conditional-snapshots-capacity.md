# Conditional PostgreSQL snapshots and free-plan capacity

## Problem and implementation

Eight production snapshot RPC reads timed out together around 16:49 UTC. The generic snapshot lookup always transferred payloads, and the bundle loaded both fresh and LKG copies before deciding which was needed. Concurrent requests repeated this work. This audit identifies those amplifiers; it does not claim that every timeout had the same sole cause.

The additive private, STABLE, security-invoker `efl_runtime_snapshot_read` RPC performs at most three primary-key lookups. A short-lived per-document xmin revision lets it return metadata without detoasting/serializing unchanged payloads. Each read validates revisions at the database: there is no unchecked freshness TTL. Payload storage is bounded to 8 MB of serialized values and 128 records, with an unconditional refresh after five minutes. Identical in-flight reads share one request. Fresh bundles no longer eagerly fetch LKG; invalidation, expiry, misses, or refresh failure still fetch the actual fallback. Unrelated namespace writes do not invalidate unchanged snapshots.

The migrated competition fixture path also skips packaged SQLite when PostgreSQL has no fixtures. This prevents old baseline fixtures from reappearing on a cold cache.

## Verification

Actual repository SQL ran in isolated PGlite. With 1,266 synthetic fixture records:

- Eight concurrent readers made one snapshot request, fetching fresh plus dirty metadata without LKG.
- The cold payload was 2,200,197 bytes. Ten unchanged reads totaled 2,240 bytes.
- Update, deletion, expiry and dirty-marker changes were visible; unrelated writes did not resend the payload. Ticket records were unchanged.
- Local CPU for those ten warm reads was 30.591 ms, including Node and PGlite. This is not hosted Vercel CPU and not a complete authenticated user session.
- The actual production largest snapshot probe returned 2,679,857 bytes cold and 131 bytes unchanged. Anonymous/authenticated RPC execution remained denied.
- Native SQL, snapshots, migrated runtime services, ticket recipient, admin cold-start, and result lifecycle regression checks passed; lint and production build/self-check passed.

## Capacity model and limits

Official limits checked on 2026-10-10: Supabase Free has 500 MB database and 5 GB uncached egress per month; Vercel Hobby has 4 CPU-hours, 360 GB-hours provisioned memory and 1 million function invocations. Supabase Auth's 50,000 MAU allowance does not describe this application's Telegram session capacity. The organization is Free and Auth contains zero users. Vercel observability CPU queries required a paid feature and were not accessible; no billing change was made.

Production cold snapshot sizes for clubs, competitions, one standings table, and 11 available competition fixture snapshots totaled 2,279,990 bytes. The missing Premier League slice uses the existing admin snapshot fallback, another approximately 2.68 MB. Therefore a deliberately broad cold session is modeled at 5 MB. A warm session budget of 0.03 MB allows metadata and small reads, but is an assumption beyond the measured individual RPC. No production-wide cache-hit rate has been measured.

For two such visits per active day and a 30% egress reserve, usable monthly egress is 3,500 MB:

| Warm-session share (assumed) | MB per active user-day | Constant DAU for 30 days | MAU if each user is active 5 days |
| --- | ---: | ---: | ---: |
| 0% | 10.000 | 11 | 70 |
| 50% | 5.030 | 23 | 139 |
| 90% | 1.054 | 110 | 664 |

These are uncompressed egress-budget projections for the stated broad workload, not a proven throughput maximum or a claim about the current remaining monthly allowance. Compression, shared cache reuse, session behavior, payload changes and cold starts change the outcome. Compute, concurrent requests, AI/model limits and accumulated database growth can bind earlier. A working planning target of roughly 100 DAU / 600 MAU requires about 90% warm sessions under this model; it is conditional, not guaranteed. If the same people use the app every day, their MAU equals DAU.

Sources: https://supabase.com/pricing ; https://supabase.com/docs/guides/platform/manage-your-usage/egress ; https://vercel.com/docs/plans/hobby ; https://www.postgresql.org/docs/current/ddl-system-columns.html .
