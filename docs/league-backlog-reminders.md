# Outstanding league game reminders

The authenticated existing notification workers now prepare one daily digest per current player and domestic league. The existing Supabase ten-minute worker and Vercel Telegram worker both use `prepareUNotifications`; ordinary page reads never prepare these digests. No additional cron, migration or credential is required.

The worker runs between 09:00 and 21:00 Asia/Tashkent. It considers all scheduled or pending-confirmation fixtures from round 1 through the competition's current round, even without an individual deadline. Finished, cancelled, postponed, disputed, future, retired and withdrawn fixtures are excluded. Closed/draft competitions are excluded. Pending scores are labelled as awaiting confirmation rather than presented as a request to play again. Older rounds explicitly direct players to the administrator with the round, opponent and score; existing phase/matchday submission locks remain enforced.

The scan also retains rounds already reached before an administrator selected an earlier round. Its upper bound includes authoritative confirmed/pending results and past opening timestamps from the same season's round locks. Scheduled fixtures or future opening timestamps alone never extend that bound. The message still reports the selected current round; games outside that round request admin assistance. Scan version 2 restarts a pre-fix daily scan once, including an old DONE/zero result, while preserving daily broadcast IDs and dispatch deduplication.

Current occupancies and user records authorize recipients. Embedded fixture owners and caches are ignored. Contacts use validated Telegram usernames; the group/admin fallback and Mini App action remain available without a username. Long calendars/text are bounded to fit Telegram; the Mini App contains the full list.

A fenced lease, four-player slices, daily deterministic broadcast IDs and a durable competition/player cursor resume interrupted preparation. Failed enqueues do not advance the recipient. A repeated worker cannot send seven independent messages for seven games. A new owner or new fixture arriving after the day's digest is complete is picked up in the next daily scan.

Each queued digest carries a private freshness guard. Dispatch rebuilds it from current authoritative fixtures and occupancy, removing completed games and invalid owners. Previous-day digests are skipped. Source failures before dispatch are retryable. Interrupted jobs with a PENDING durable receipt are safe to recover; SENDING/uncertain Telegram acceptance still requires reconciliation, preserving duplicate protection. Existing settings and recipient suspension checks remain enforced.

Deadline reminders also retain empty sent markers on partial enqueue failure. A failed fixture read no longer silently becomes an absent fixture. Per-owner queue writes are serial to avoid contention on shared PostgreSQL queue documents.

## Operations

Admin → Notifications shows preparation status, queued/disabled-or-duplicate counts, actual delivered/failed/pending/skipped receipts, uncertain delivery, last slice duration and last error. `GET /api/admin/notifications/league-reminder-health` uses the existing fresh admin authorization, returns no recipient IDs or cursors, and does not initiate a send. Preparation status DONE means enqueueing finished, not that Telegram accepted every message.

Login and result POSTs emit structured `PLAYER_OPERATION_FAILED` logs for HTTP 5xx or `PLAYER_OPERATION_SLOW` at two seconds. Logs contain only operation name, status and elapsed milliseconds. Notification preparation/freshness errors and existing per-delivery timing logs remain available in Vercel. This is diagnostics, not a new production capacity guarantee.

## Verification

`node scripts/run-isolated-test.mjs src/server/tests/leagueBacklogReminderRegressionTest.ts` exercises round 19/seven old games, status exclusions, contact fallback, transfer/suspension boundaries, preview/night guards, partial recovery, daily deduplication, freshness outages, rebuilt delivery through mocked Telegram and admin-only receipt health. The same audit runs against repository SQL with native PGlite inside `postgresSqlIntegrationTest.ts`.

Existing security HTTP, signed session launch, admin result notification, notification backup/recovery, moderation, AI matchday and UZEFLIFE workflow tests cover the surrounding flows. Tests use disposable data with external network blocked or mocked; production fixtures/results and real Telegram messages are not test fixtures.
