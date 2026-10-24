# Official-group club owner tags

Regular members of the configured `TELEGRAM_GROUP_USERNAME` group receive their current primary club name through Telegram Bot API `setChatMemberTag`. The bot must already be an administrator with `can_manage_tags`. This feature never promotes users or edits administrator titles. Telegram limits tags to 16 characters without emoji; longer club names use recognizable aliases, with the catalog short name as a final fallback.

The reconciler is enabled only for the production Vercel environment and production PostgreSQL namespace with a configured bot and official group username. `TELEGRAM_CLUB_TAGS_ENABLED=false` disables it. Preview deployments, missing credentials and migration freezes cannot run tag mutations.

Successful API traffic schedules a bounded background pass using `waitUntil`. A durable 60-second lease prevents overlapping workers across instances; each pass processes at most 24 users within a 42-second request budget. Further traffic continues the remaining backfill. Owners are resolved directly from the unique active season and canonical active club occupancy documents, without relying on cached ownership. Suspended/unresolved accounts, nonmembers, bots and group administrators are skipped. For multiple owned clubs, the active primary user membership must match a current occupancy. Ambiguity preserves the existing tag.

Ownership changes receive priority over the normal six-hour recheck. When a previously managed owner loses their club, the old tag is cleared only if Telegram still reports that exact managed tag. An unrelated manually edited tag is preserved. Failed member lookups do not block later users. Telegram 429 retry delays and missing bot permissions are backed off; failed writes are never counted as successful.

`GET /api/telegram/status` includes aggregate `clubMemberTags` status without owner IDs. The primary owner's existing protected admin API also exposes `GET /api/admin/telegram-ai/club-member-tags` and `POST /api/admin/telegram-ai/club-member-tags/sync`. Callers cannot supply target groups, users or tags. Status reports completed passes, remaining work and explicit permission/service failures; deployment alone is not evidence that Telegram accepted tags.

Reference: https://core.telegram.org/bots/api#setchatmembertag

The isolated regression suite mocks Telegram and covers all catalog tag lengths, current versus previous season, primary premium club, transfer/release cleanup, preserved manual tags, distributed exclusion, regular/restricted/admin/nonmember behavior, permission and rate-limit backoff, preview isolation and migration freeze. No real users are modified by tests.
