# Smart Notification outage backup

Configure an independent, persistent Redis database on the Vercel project:

- `NOTIFICATION_BACKUP_REDIS_REST_URL`
- `NOTIFICATION_BACKUP_REDIS_REST_TOKEN`

Use a different URL from the primary Redis database. These are server secrets;
do not place values in Git or browser-facing variables. The feature remains
disabled without a complete valid pair. A temporary expiring database is unsuitable.

On a primary enqueue failure, a generated Smart Notification is stored in the
backup without a TTL. Recovery transfers bounded batches into the existing
primary queue before deleting backup records. The primary broadcast ID prevents
repeat enqueue after an uncertain response. Recipient permissions are checked
again when recovered jobs are delivered. Existing event-driven workers and daily
recovery cron process pending backups; no minute cron or Firestore reads are added.

Limits: both storage systems failing cannot preserve new messages. The backup
does not reconstruct events that were never generated because fixture/owner
snapshots were unavailable. Existing admin broadcasts continue using their current
primary queue and explicit request error/retry behavior. A second database on
the same provider does not protect against a provider-wide outage.

# Domestic league fixture counts

League catalog responses use existing complete fixture snapshots and apply
deletion tombstones, keeping displayed counts consistent with visible fixtures.
The previous catalog number is exposed as `configuredFixtureCount`, with source
and snapshot timestamp fields. Unknown counts keep the previous catalog value;
UEFA phase counts are unchanged. This does not generate, delete or restore games.

Read-only production check on 2026-10-01 found 189 Serie A fixtures and 152 Bundesliga
fixtures, with Bologna/Venezia and Bochum/Union Berlin pairings absent. The cause
of those missing records was not proven from public API responses. Admin deletion
history and authoritative records must be checked before restoring any game.

Validation: isolated backup and enqueue recovery tests, visible count tests,
read-budget regression and webhook regressions. CI also tests backup Lua against
its isolated Redis server; test Telegram transport is mocked.
