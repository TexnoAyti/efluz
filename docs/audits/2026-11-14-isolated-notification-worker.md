# Isolated production notification delivery — 2026-11-14

The emergency `DISABLE_BACKGROUND_WORKERS=true` switch remains enabled. Production has a narrower `ENABLE_NOTIFICATION_DELIVERY_WORKER=true` override that permits only the durable Telegram delivery queue.

The isolated path does not start mutation reconciliation, UZEFLIFE preparation, team-invitation preparation, or the AI daily report. It drains the existing PostgreSQL-backed queue in bounded batches of 25, keeps the worker lock, delivery receipts, retries, continuation cap and migration-freeze guard, and remains disabled in preview.

Before activation, 2,241 paused jobs older than 18:00 UTC were moved intact to a private rollback archive instead of being delivered. Eighteen current jobs were retained. The cutover wrote an audit record and did not alter user, fixture, ownership or result documents.

Validation completed before release: focused four-case gate regression, TypeScript, migration-freeze regression, production build and deployment self-check. Validation itself used no synthetic Telegram recipient and did not enqueue a test broadcast.
