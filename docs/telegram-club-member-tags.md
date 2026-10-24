# Official-group club owner tags

Regular members of the configured `TELEGRAM_GROUP_USERNAME` group receive their current primary club name through Telegram Bot API `setChatMemberTag`. The bot must already be an administrator with `can_manage_tags`. This feature never promotes users or edits administrator titles. Telegram limits tags to 16 characters without emoji; longer club names use recognizable aliases, with the catalog short name as a final fallback.

The reconciler is enabled only for the production Vercel environment and production PostgreSQL namespace with a configured bot and official group username. `TELEGRAM_CLUB_TAGS_ENABLED=false` disables it. Preview deployments, missing credentials and migration freezes cannot run tag mutations.

Successful API traffic schedules a bounded background pass using `waitUntil`. A durable 60-second lease prevents overlapping workers across instances; each pass processes at most 24 users within a 42-second request budget. Further traffic continues the remaining backfill. Owners are resolved directly from the unique active season and canonical active club occupancy documents, without relying on cached ownership. Suspended/unresolved accounts, nonmembers, bots and group administrators are skipped. For multiple owned clubs, the active primary user membership must match a current occupancy. Ambiguity preserves the existing tag.

Ownership changes receive priority over the normal six-hour recheck. When a previously managed owner loses their club, the old tag is cleared only if Telegram still reports that exact managed tag. An unrelated manually edited tag is preserved. Failed member lookups do not block later users. Telegram 429 retry delays and missing bot permissions are backed off; failed writes are never counted as successful.

`GET /api/telegram/status` includes aggregate `clubMemberTags` status without owner IDs. The primary owner's existing protected admin API also exposes `GET /api/admin/telegram-ai/club-member-tags` and `POST /api/admin/telegram-ai/club-member-tags/sync`. Callers cannot supply target groups, users or tags. Status reports completed passes, remaining work and explicit permission/service failures; deployment alone is not evidence that Telegram accepted tags.

Reference: https://core.telegram.org/bots/api#setchatmembertag

The isolated regression suite mocks Telegram and covers all catalog tag lengths, current versus previous season, primary premium club, transfer/release cleanup, preserved manual tags, distributed exclusion, regular/restricted/admin/nonmember behavior, permission and rate-limit backoff, preview isolation and migration freeze. No real users are modified by tests.

Skip diagnostics distinguish group administrators, nonmembers, banned members, bot accounts, missing Telegram IDs, missing/suspended owner accounts, unresolved primary clubs, lookup failures and Telegram tag rejections. Public status exposes only reason counts and a pending-diagnostics count. Old grouped reasons are rechecked once under diagnostic version 2, even before their normal retry time; matching successful tags are not rewritten. This distinguishes a confirmed nonmember status from an unavailable Telegram lookup. Raw Telegram error descriptions and account identifiers never appear in public diagnostics.


## Private AI list of absent club owners

The primary owner can ask in the bot's genuine private chat: `Guruhda yo‘q klub egalarini ko‘rsat`, `Guruhda yoqlarni chiqarib ber`, or `Guruhga kirmagan o‘yinchilar kimlar?`. This is a read, without mutation confirmation. It does not kick members, release clubs, send invitations or change tags. The roster shows club name(s), @username or display name plus Telegram ID, and an explicit ban label where Telegram reports `kicked`. Natural page requests such as `Guruhda yo‘q klub egalari 2-sahifa` are supported.

`GET /api/admin/telegram-ai/club-member-tags/missing-owners?page=1&limit=20` is protected by the current admin lookup and primary-owner guard, with private/no-store caching. Other admins, ordinary users and group-chat AI cannot retrieve the identities. Public `/api/telegram/status` still contains only aggregate counts.

The list resolves current canonical active-season club occupancies and user records directly, then calls `getChatMember` for the actual owners. It does not trust the tag worker's cached missing records. Administrators and current regular/restricted members are not listed as absent. `left`, `kicked`, and restricted nonmembers are included; missing identities, unavailable lookups, unknown responses and timeouts remain unverified, never proof of absence. One owner with multiple clubs appears once. Rejoined users and former owners disappear on a fresh audit.

Reads run in batches of four within an 18-second Telegram budget; a partial audit is explicitly marked incomplete with checked/total and unverified counts. Output is paged at up to 20 absent owners, and the native private reply has room for the formatted list. The isolated regression exercises the real protected gateway and HTTP routes, fresh membership reads, pagination, partial failures, natural wording, owner-only private dispatch and preserved public privacy, with Telegram fully mocked.
