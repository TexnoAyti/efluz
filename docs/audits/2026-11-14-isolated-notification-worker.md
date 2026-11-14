# Isolated production notification delivery — 2026-11-14

The emergency `DISABLE_BACKGROUND_WORKERS=true` switch remains enabled. Production now has a narrower `ENABLE_NOTIFICATION_DELIVERY_WORKER=true` override that permits only the durable Telegram delivery queue.

The isolated path does not start mutation reconciliation, UZEFLIFE preparation, team-invitation preparation, or the AI daily report. It drains the existing PostgreSQL-backed queue in bounded batches of 25, keeps the worker lock, delivery receipts, retries, continuation cap and migration-freeze guard, and remains disabled in preview.

Validation completed before release: focused four-case gate regression, TypeScript, migration-freeze regression, production build and deployment self-check. No real Telegram test message or historical notification replay was performed during validation.
