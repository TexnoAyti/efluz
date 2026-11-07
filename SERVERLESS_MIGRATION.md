# EFLUZ Telegram Serverless migration

Production remains on Vercel until parity checks pass. Do not run `tgcloud push`,
`tgcloud migrate`, or `tgcloud webhook sync` from this branch against the live bot.

## Cutover gates

- Core tables imported with row counts and checksums verified.
- Mini App uses `Telegram.WebApp.Serverless.call` for all authenticated reads/writes.
- Club profile, leagues, fixtures, domestic cups, result confirmation and match chat pass.
- Message, callback query, channel post and pre-checkout handlers pass replay tests.
- Admin operations are owner-checked and idempotent.
- Second-season admission and one-club ownership constraints pass concurrency tests.
- A rollback webhook command is prepared and tested before final cutover.

The final webhook switch is the last step, never the first.
