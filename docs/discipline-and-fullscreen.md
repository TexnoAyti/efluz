# Player discipline and Telegram fullscreen

## Administration

Open **Admin → Foydalanuvchilar → player details → Intizom**. Full administrators can issue a yellow warning or a red one-game suspension for abuse, delaying a game, missing the playing time, or another stated reason. A free-text explanation is required; a related match is optional. A reversal requires an explanation and retains the original card in history. Requests carry an idempotency key to prevent duplicate cards when retried.

Cards and in-app notices are persisted atomically. Participants see their own explanations; other authenticated visitors see only the category, colour, date and sanction. League-scoped helpers cannot issue/revoke cards. Existing administrator authorization is checked again from the database inside the card transaction.

Yellow cards do not automatically turn into reds. A red reserves the next scheduled/ready/postponed/overdue EFL league or cup fixture belonging to the player in that season, excluding the incident fixture, unfinished pairings, and already-played/reviewed matches. Both participants' normal result submissions are blocked for the reserved fixture; the administrator chooses its outcome through the existing admin result controls. No technical score or point deduction is invented automatically. Confirmation of that fixture marks the one-game sanction as served.

If no schedule exists, the red stays pending. The score-form POST check, participant submission guard and administrator result path bind it once a match is available. Cancellation/deletion or a club transfer reassigns an unserved sanction, so it does not punish a new club owner. The card follows the player; a served card remains in history. Classic EFL fixtures use this system; separate custom/team/UZEFLIFE tournaments retain their own result workflows.

Result transactions read the fixture hold alongside normal consensus checks, closing races with card issuance. Durable result replay goes through the same transaction and retains deterministic audit records and notices. An unavailable authoritative discipline read fails the action rather than silently allowing a suspended game.

## Fullscreen

BotFather's launch setting remains authoritative; the app does not request or exit fullscreen itself. CSS combines system safe-area insets with Telegram's content safe-area insets, including horizontal insets in landscape. The Telegram SDK updates these variables when the viewport/insets change. Header, desktop navigation, floating mobile navigation, toasts, main dialogs, welcome screen and tournament drawers use the usable viewport.

Reference: https://core.telegram.org/bots/webapps#safeareainset and https://core.telegram.org/bots/webapps#contentsafeareainset

Validation: discipline HTTP/service regression (authorization, private details, retry, one-game guards, cancellation, transfer, pending schedules, admin resolution and concurrency), standard result HTTP lifecycle, critical safety, durable replay, startup, build and existing design checks. Live native fullscreen still requires device verification: Android/iOS, portrait/landscape, keyboard open, fullscreen/normal launch, score form/search/admin dialogs, and bottom navigation.
