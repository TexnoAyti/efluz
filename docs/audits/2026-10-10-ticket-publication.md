# Tournament publication and ticket atomicity

## Finding and fix

The durable publication path previously committed a ticket debit before updating the tournament. A failure in the second write left a charged wallet and a DRAFT tournament. Concurrent publications using different idempotency keys could also debit twice.

Publication now reads the tournament and wallet, debits the ticket, records the ledger and idempotency entry, and opens registration in one document-adapter transaction. A competing publisher retries against the committed tournament status and returns the existing publication without another debit. Idempotency keys are bound to their user and tournament; legacy entries resolve their owner through the ledger. No database schema migration is required.

## Verification

- Reproduced the old failed-publication debit using the repository's actual PostgreSQL RPC SQL in isolated PGlite, with HTTP transport simulated.
- Injected a real SQL batch failure after the proposed publication writes: the wallet and DRAFT tournament both remain unchanged after the fix.
- Concurrent publications with different keys consume exactly one ticket and return the same ledger transaction. Reusing that key for another tournament returns IDEMPOTENCY_CONFLICT without mutation.
- Native PostgreSQL integration, ticket recipient/authorization/notification regression, custom tournament, match result lifecycle, and club admission suites pass. Telegram delivery in these tests is mocked.
- TypeScript lint and the production build/deployment self-check pass. The ticket recipient regression is now included in CI and uses the safe conflict RPC response.

## Live read-only checks

At 16:35 UTC, the PostgREST configuration-call counter remained 128083758 and there were zero legacy commit RPC sessions: the previously stopped retry loop had not returned. The deployed CPU fix was READY. This counter is not a dashboard CPU percentage.

The production ticket-wallet structural query found zero invalid balances or mismatched user identifiers. No production wallets, tournaments, or Telegram recipients were mutated for testing. Real Telegram device startup latency and unavailable legacy Redis history are outside this isolated verification.
