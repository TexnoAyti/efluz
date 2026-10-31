# UZEFLIFE: shared 15-round league

The owner requested a single league while preserving the original eight group lists and their slot numbers. The source roster from 21 October is retained verbatim in `src/data/uzeflifeRoster20261021.ts`: 256 slots, 242 unique usernames, 14 duplicate occurrences. Matching is case insensitive. The first occurrence stays; later occurrences become empty slots with their original name and first location recorded. No participant is moved to another source group.

Only an unstarted draft/registration without approved entrants is automatically configured. Pending applications are retained and upgrade only when their authenticated owner links a matching reserved slot. The previous configuration is atomically backed up to `uzeflife_config_history/league-roster-20261021`. Existing participants, games, roles, channels and archives are preserved; approved entrants or any games prevent this migration. El Clasico remains disabled.

Roster entries reserve positions, not Telegram identities. A real authenticated user with a matching username links their position using the registration button after mandatory subscriptions. An authorized administrator can link an existing account or edit an unclaimed slot; usernames and accounts cannot occupy two slots. No Telegram IDs or deliverable accounts are fabricated from usernames.

Once all occupied slots are linked and approved, the administrator starts a deterministic 15-round schedule. Between 16 and 256 entrants are supported, with an even number required. For the current 242-person roster there are 121 games per round and 1,815 total. Each player meets 15 different opponents. The source roster is never shuffled. This is a partial round robin, not Swiss pairing or knockout.

A win earns 3 points, a draw 1, a loss 0. Sorting uses points, goal difference, goals scored, original roster order. Pending/disputed proposals do not affect the standings. Draws require opponent/admin confirmation and never penalties. An administrator opens each next round only after the current round is complete. The league finishes after all 15 rounds and archives the league format, source roster, official results and top two.

The public league uses shared EFL match cards, round navigation and standings; lists are paginated. Source group filters retain all 32 original slots, including vacancies. Telegram deep links cover rounds 1–15. Result dialogs support rival contact, player submissions, confirmation/disputes, administrative scoring and scheduling.

Notification repairs preserve opponent announcements across score submissions while still rejecting changed pairings/cancellations. Bot delivery is queued before the live in-app projection. An interrupted job does not block unrelated jobs, and an unrelated deadline sweep does not prevent another tournament's outbox from preparing. Existing queue deduplication and read-state preservation remain in effect. No production participant notifications were manually sent during development.

## Notification delivery follow-up

UZEFLIFE opponent, result, dispute, reminder and completion messages now also create private in-app notifications. Both channels retain the same validated match destination. The live projection publishes only on delivery; viewing the notification list does not add database reads to warm polls.

Retries preserve notification read status and original timestamps. New outbox jobs distinguish a new occurrence (for example, resubmitting the same score after rejection) from retrying an existing occurrence. Older jobs retain their previous Telegram queue identity. Failed recipients are retained as durable retry indices while later recipients in the same job continue. Missing/suspended accounts, revoked admin roles and unrelated players do not receive private match notices.

The existing request/continuation/cron wakeups and notification settings remain in use. Isolated tests simulate Telegram enqueueing; no production participant messages were manually sent for verification.
