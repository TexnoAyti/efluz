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
