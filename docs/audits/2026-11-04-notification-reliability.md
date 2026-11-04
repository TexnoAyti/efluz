# Notification reliability follow-up — 2026-11-04

The full audit found one `SMART_NOTIFY_NOT_PERSISTED` event caused by exhausted namespace-generation CAS retries, and one `DELIVERY_UNKNOWN` receipt. A missing receipt is not proof of delivery; an unknown receipt is not proof of failure.

## Changes

- Queue enqueue, dedupe, worker lease, claim, hash update and release now execute as one PostgreSQL RPC under the existing namespace lock. Unrelated writes no longer invalidate a notification's read/commit window. A broadcast receipt lookup returns only the requested record instead of transferring the entire history.
- Existing documents and opaque payloads stay compatible. PostgreSQL stores still share the authoritative database namespace, including in tests that temporarily change environment variables. The local document adapter remains available for isolated tests; a production RPC error never switches to it.
- Manual retries skip `DELIVERY_UNKNOWN` and successful receipts. A database read failure cannot fall back to a stale process-memory receipt and authorize another send.
- Admin delivery health displays unknown deliveries separately. The bulk retry control appears only for definite failures.
- CI uses its frozen lockfile, runs new SQL/retry regressions, and the Vercel handler test has a referenced completion deadline and request timeouts.

## Verification

Native PostgreSQL WASM tests cover 1600 existing receipts, 40 enqueues interleaved with unrelated writes, dedupe, lease fencing, atomic claim, TTL, freeze behavior, encoded/data equivalence and private invoker grants. The broader PostgreSQL HTTP suite also covers player results, old rounds, leagues, domestic/European cups and reminders. Build, TypeScript and all ten Vercel handler checks passed locally. Transport and Telegram are isolated in these tests.

The additive RPC migration was installed on the existing EFLUZ database. Live read-only verification confirmed private grants and an empty pending queue. No match result or existing delivery receipt was rewritten, and no Telegram message was sent by this follow-up's verification.

## Remaining limits

This removes the observed namespace-CAS failure mechanism; it does not guarantee delivery during every database outage. The broadcast history is still one opaque document inside PostgreSQL, although it no longer traverses the network for each receipt/update. Splitting it into per-event records remains a future scaling improvement. Telegram has no exactly-once send guarantee; unknown deliveries require operator investigation. The earlier missing event was not replayed blindly. A signed Telegram Mini App phone walkthrough remains necessary to validate the visible player/admin flow.
