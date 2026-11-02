# Opening capacity: 1000 daily visitors

The operating target is 1000 visitors over a day, including short bursts. Daily
visitors and simultaneous visitors are different measurements. This document
does not claim that the current hosted plan supports 1000 simultaneous users.

## Reproducible isolation test

Run `node scripts/run-isolated-test.mjs src/server/tests/postgresCapacityRegressionTest.ts`.
The external-network guard blocks outbound connections. The test uses the real
Express app, repository SQL in native PGlite, 1000 distinct signed sessions and
synthetic ownership snapshots. Only the PostgREST transport is simulated, with a
2 ms asynchronous delay. No production records or Telegram messages are used.

At 32 parallel visitors, each visitor opens bootstrap, the four-league catalog
and the APL table. Assertions cover 3000 successful HTTP requests, correct
account/club isolation (including spectators), unresolved scores excluded from
the public table, no database writes during opening and unauthorized rejection.
Fixtures are shared only while reads overlap; completed results are not cached
by the transport. The next read still verifies durable data.

One local run on 2026-11-02 reported 547 database RPCs, 136 fixture reads and zero
opening writes for the 3000 requests. Local elapsed time and p95 are printed by
the test, but are not hosted Vercel or Supabase measurements or a production SLO.
This is a resumed-session/read-path capacity test. First-ever Telegram login,
result submission, payments and background deliveries have separate correctness
regressions and are not included in this throughput number.

## Avoid hot counter writes

Read-cost telemetry previously committed one transaction for every metrics
update. The PostgreSQL runtime now collects only current telemetry updates in a
3 ms window. It commits at most 256 updates and 30 keys per transaction, with a
4096 field-pair batch bound and a 4096-entry pending-queue bound. The database
object scopes each queue. Each caller completes only after the shared commit;
a failed commit rejects every affected caller and leaves no acknowledged count.
The observability caller already treats failure as best effort.

1000 parallel updates to one hourly counter produce four commits instead of
1000, preserving total reads, request counts and individual endpoint totals.
This batching does not change business writes, authorization checks, rate-limit
budgets or leases. Seven-day telemetry retention remains unchanged.

## Production verification and limits

Do not flood the live bot with 1000 synthetic visitors. Check a small set of
public read endpoints and inspect Vercel errors and PostgreSQL wait states after
releasing. A successful single probe is not proof of stable peak capacity.
Review sustained timeout/503 rates, server timing, connection waits and hosted
CPU/I/O before increasing a tested concurrency target or changing plan size.
Never replace unavailable live ownership or fixture data with seed/demo data.
