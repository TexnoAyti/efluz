# TEAMS: tickets, verified rosters and invitations

This implementation continues from current main and the existing `tp_...` team/league model. The AI Studio source preserved in recovery PR #180 is reference material; its old application baseline and separate `teams` model are not deployed.

## User flow

- TEAMS opens the selected league directly as before. The toolbar adds **Team yaratish**, **Mening teamlarim**, and **Takliflar**.
- A normal user needs one **team creation ticket**, issued by the platform owner. The default balance is zero. The owner can create teams without a ticket, but group membership still applies.
- Successful creation makes the creator the team administrator and its first confirmed member/captain.
- Administrators invite an exact EFLUZ user by username, Telegram ID or EFLUZ user ID. An invitation does not add that person to the confirmed roster.
- The recipient receives a bot invitation with accept/reject and profile buttons, and can also respond in the app. Joining the configured official Telegram group is required. After joining, retry the same button; it rechecks membership.
- Pending invitations can be cancelled, expire after seven days and can be renewed. Cancelled/expired invitations cannot be accepted.
- Existing manual roster slots can be linked through an invitation. The original member ID is preserved. Names are never silently treated as verified accounts.

## Owner and team administration

**Admin panel → TEAMS → Team ticketlarini boshqarish** grants, checks or revokes unused team tickets. These balances and audit records are separate from personal-tournament tickets.

The owner sees all teams in the existing workspace. **A’zolar va takliflarni boshqarish** opens the same verified roster manager used by a team's administrator. The owner may assign the team administrator to a confirmed member or return control to the platform owner. Other global admins do not inherit these rights.

Team administrators can edit their own profile, choose a confirmed captain, invite/link members and remove eligible current roster entries. Active tournament rosters remain locked; role-only owner reassignment does not modify a roster. League creation, draws, round advancement and result management remain owner-only.

Natural Munfiz commands include:

- `@username team ochish uchun 2 ticket ber`
- `@username team ticketini tekshir`
- `@username dan 1 team ticketini qaytarib ol`

They use existing private-admin planning and delivered-confirmation rules. An AI delegate cannot grant team tickets. A model-supplied idempotency key cannot replace the server operation ID.

## Limits and historical compatibility

League participant counts support 2–64 teams; playoff sizes are 2, 4, 8, 16, 32 or 64. One/two-leg schedules and odd-team BYEs remain supported. Shared constants are in `src/types/teamLeaguePreview.ts`; the owner workspace has a 256-team and eight-league bound.

New leagues set `membershipRequired: true`. Only confirmed, linked members enter new snapshots; the captain must be confirmed too. Group membership is checked on creation/acceptance, for captains before a new league starts, and for selected players before lineups, pairing and substitutions. Telegram errors, missing production configuration and fail-open legacy responses cannot authorize these new actions.

Existing leagues without that flag retain their historical snapshots and can finish their pre-feature workflows. New profile/member edits never rewrite their old results or statistics. Active-roster changes are rejected; invitations can wait for the tournament to finish.

## Storage and consistency

- Existing teams/leagues stay in `team_league_preview_teams` and `team_league_preview_leagues` under the platform workspace. `adminUserId` identifies a team's administrator; `memberUserIds` supports a member's own directory.
- `team_creation_tickets`, `team_ticket_transactions`, `team_membership_receipts` hold balances, audit records and user-scoped request receipts.
- `team_membership_invitations` holds recipient-specific lifecycle records and a durable `noticePending` outbox marker.
- Team persistence, ticket debit, receipt and ledger entry commit together. Retries return the same team. Different concurrent create requests cannot overspend one ticket.
- Acceptance and roster membership commit together. Concurrent joins merge through database transactions. Expiry/cancellation, target identity, capacity and team permissions are checked in the transaction.
- Outbox preparation feeds the existing smart Telegram queue with a deterministic event ID. Delivery is not claimed by merely persisting an invitation. The existing worker retries pending notices. Preview/write-freeze namespaces do not enqueue real delivery.
- Actor suspension/revocation is checked against stored accounts. Normal users cannot forge verified roster fields, another recipient's reply or another team's management rights.

Large directory, fixture and profile responses use bounded pages. The client hydrates them into the existing engine format. Snapshot tokens reject mixed revisions; hashes survive database key reordering. Cached snapshots are account-scoped, expire after one minute and are bounded to 16 MiB. Team mutations clear the cache.

## Validation

The native PostgreSQL HTTP audit covers failed-write rollback, concurrent create/grant/join/cancel cases, recipient and owner/team-admin authorization, strict group failure/retry, legacy linking, Telegram callbacks, full 64-team scheduling and AI dispatch. Separate tests cover natural AI grant/check/revoke with delivered confirmation, replay and receipt verification; bounded transport/hydration; existing tournament/profile navigation and rendering.

Tests use isolated accounts, a native local PostgreSQL engine, blocked external networking and mocked Telegram responses. No real recipients or production records are used for tests.

Each confirmed account may belong to only one current team. Creating a second team, inviting an existing member of another team, and accepting a conflicting invitation return 409 `TEAM_MEMBER_ALREADY_ASSIGNED`. Cross-team acceptance and creation share a transactional per-account concurrency guard. Actual rosters remain the source of truth, including teams without membership indexes. Removing a player permits joining another team; historical tournament snapshots remain unchanged.

## Owner deletion and EFL appearance

TEAMS uses the shared EFL competition heading, tabs, panels, buttons, fields and creation steps. Its own stylesheet contains team roster, pairing, score, profile and bracket geometry. The legacy custom tournament appearance no longer wraps TEAMS.

Owner-only Delete buttons are present on each team/league directory card and the league detail header. League deletion removes the live record and archives its complete snapshot privately in `team_league_deleted_leagues`; deleting an active league closes live play. Team deletion archives the team in `team_league_deleted_teams`, cancels pending invites, and removes it from draft leagues with version increments. A draft with fewer than two teams cannot start. Completed/cancelled league snapshots are not rewritten. An active league blocks team deletion with its name and instructions to finish, cancel or delete that league first. Deletion requests check versions and are idempotent for the same deleted version.

## Team tournaments and delegated administrators

The primary owner can create tournaments directly from **TEAMS → Turnir yaratish**
or from the admin panel. Presets are Liga, Kubok, Chempionlar ligasi, and custom.
The Champions League preset uses the existing round-robin league phase followed
by playoffs; it does not reproduce UEFA's opponent-selection rules. Choose the
number of qualifiers and one/two league legs in the wizard.

The owner selects a registered, active account by username/Telegram ID/EFLUZ ID.
`ownerId` stays the platform owner; `adminUserId` delegates only that tournament.
The administrator discovers drafts and active tournaments through **TEAMS →
Turnir boshqaruvi**, also available in the personal profile. They can edit a draft
using its current participants, start it, manage lineups/pairings/results, advance
rounds, settle playoff ties and cancel it. Team membership/tickets, unrelated
private teams, tournament deletion, creating tournaments and assigning admins
remain owner operations. Team-admin and tournament-admin roles are independent.

The owner can replace/remove an administrator even after the tournament starts,
without changing rosters or past results. Each managed read/page checks the fresh
account and assignment; each mutation rechecks both inside the transaction. A
cached fixture page cannot bypass revocation. Audit entries record the actor ID.
Public responses include the competition type but omit administrator account IDs.

API routes (under `/api/team-leagues-preview`):
- GET `/administrators/resolve?reference=...` (owner only; minimal account data)
- POST `/leagues/:id/administrator` (`adminUserId`, `version`; owner only)
- GET `/managed/leagues/:id` and `/managed/leagues/:id/teams`
- POST `/managed/leagues/:id/update` and `/managed/leagues/:id/actions`

The native PostgreSQL HTTP audit exercises a Champions League from creation to
final, role boundaries, revocation/suspension, transaction rollback, version
conflicts and pagination with a fresh ACL on every page.

## Tournament creation settings

The first step now exposes the match size directly: quick 1v1/2v2/3v3/etc.
choices plus a numeric 1–30 starter count, and an exact 2–64 participating-team
count. Step two selects those teams and configures reserves, league legs,
qualification and scoring; the final step shows both team fixtures and individual
games before saving.

`SINGLE_MATCH` is a dedicated type: exactly two teams, PLAYOFF, one leg. With one
starter per team it produces one fixture and one individual game. More starters
produce that many individual games inside the same team fixture. Knockout ties
still need an explicitly confirmed winner; league home/away is configured with
`rounds` 1 or 2. This does not add two-legged knockout ties.

Optional `reserveLimit` is enforced on each submitted lineup and cannot exceed
30 minus the starter count. Zero disables reserves. Optional `points` contains
integer `win`, `draw`, `loss` values from 0–10 with win > draw >= loss; standings
and league-phase qualifiers use these values. Existing records without those
fields retain the prior reserve behavior and 3/1/0 scoring. Started tournament
rules remain immutable. Optional request `teamCount` must equal `teamIds.length`.

### El-Clasico event

TEAMS has a separate El-Clasico event entry. Registration is open by default;
players first verify the existing mandatory Telegram group subscription, then
choose Real Madrid or Barcelona (11 slots each). Joining and switching recheck
subscription server-side; one authenticated account holds at most one event
slot. An event side is temporary and does not change permanent team membership,
club ownership, tickets or league results.

The primary owner starts the event after all 22 slots fill. Start verifies fresh
accounts and subscriptions and freezes the roster; the 11 individual pairs use
registration order within each side. The owner enters/corrects scores (0–99),
with version conflict protection. The event completes after all 11 results.
The headline score counts individual wins; draws appear separately. Cancellation
requires confirmation and preserves registrations/results. No automatic bot
messages are sent.

Authenticated endpoints below `/api/team-leagues-preview/events/el-clasico`:
GET event; POST `/subscription`; POST `/actions` with JOIN(side), LEAVE,
START(version), SCORE(version,boutId,homeScore,awayScore), CANCEL(version).
The singleton `el_clasico_events/el-clasico` is committed atomically through the
existing document store; it is bounded at 22 players and 11 pairs. Fresh reads
bypass transport snapshots. There is no client identity or role override.

### Competition notifications and fullscreen layout

Event and TEAMS mutations now commit bounded delivery intents in the same
transaction as their domain change. The existing Telegram worker leases these
jobs, writes deterministic in-app notifications, and enqueues the existing
Telegram retry/deduplication transport. An interrupted retry preserves read
status. Fresh account checks suppress suspended recipients; source guards skip
obsolete pairing/result messages. Messages contain no private proof images or
Telegram IDs.

El-Clasico covers own registration/side change/leave, the owner's full-roster
alert, individual opponent on start, scores/corrections, completion and
cancellation. TEAMS covers new round/start, confirmed lineup/reserve status,
pairing/substitution/reset, scores/team results, completion and cancellation.
Only verified members with real accounts receive personal team messages.

Custom tournaments cover registration/review/removal/leave, start, first-round
or newly drawn opponents, pending confirmation/dispute/confirmed/corrected
results, completion and cancellation. Deadline reminders and overdue notices
use the existing worker wakeups and cron (no new paid or external scheduler).
The sweep reads at most 40 recent due fixtures per page, resumes with a cursor,
and never recreates an existing reminder intent. Expired advance reminders are
skipped. Existing domestic/UZEFLIFE notification settings and pipelines remain.

Delivery publishes a shared user-scoped notification projection. Polling reads
that projection with existing visibility/read controls and the prior resilient
reader as an outage fallback, avoiding a database query for each viewer. Team
and event notifications open their matching workspace; custom tournament buttons
open the existing authenticated Telegram tournament link. `tt1_` start parameters
restore a team tournament and optional fixture without granting access.

Fullscreen layout follows the visible WebView height and offset, Telegram
viewport/safe-area events, keyboard changes, and actual header height. Shared
legacy, team/event, native and tournament drawer dialogs stay inside device and
Telegram safe insets. Keyboard mode hides the floating destination bar; inner
form areas scroll so final actions remain reachable. Browser QA used actual
Tailwind styles at 320/390/844/1280 widths, portrait/landscape safe insets and a
live keyboard-height resize; no physical Telegram device test is claimed.
