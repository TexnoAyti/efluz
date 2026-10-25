# AI Studio recovery — 25 October 2026

## Status

**Recovery snapshot only. Do not deploy or merge this branch into main as-is.**

The uploaded `efluz (1).zip` was preserved unchanged. This branch saves the 22 source files that differ from its closest matching Git baseline, `0befe39c64257b9b0f57d4e46fcd663046e2211e` (7 October 2026). Eleven are modified files and eleven are new files. Their exact uploaded bytes are recorded in `aistudio-20261025-manifest.json`.

The current production/main revision at recovery was `6d38e00d988342539d803ea5f8ea0a0b507ef147`. It contains the newer TEAMS league UI, owner administration, swipe navigation, UZEFLIFE, season policies and other work absent from the ZIP. None of that main-branch work has been replaced.

The archive has no Git metadata, so it cannot establish the exact original pull/push error or the state of AI Studio authentication. Matching Git object contents establishes the old baseline; it does not establish what the AI Studio Git UI displayed.

## What was recovered

- Separate team types, API client, directory, creation/detail/invitation dialogs.
- Team ticket, roster and invitation services and routes.
- AI catalog, planner, readiness, gateway and response-description additions for team tickets.
- Telegram invitation callback handling and server route registration.
- User selector lookup additions.
- Changes to the personal/custom-tournament preview engine.
- The uploaded ecosystem regression test.

Generated API bundles, local databases, local mutation queues and the nested `public/aistudio-backup.tar.gz` were not published. The nested backup contains a project snapshot and must not be served from a public website. The original uploaded ZIP remains the complete source of those excluded artifacts.

## Verification and blockers

### Type checking

The uploaded project was checked with the installed workspace TypeScript dependencies. It exits 2 with these four diagnostics:

- `src/lib/customTournamentEngine.ts:72`: number is not assignable to `2 | 8 | 4 | 16`.
- `src/server/services/customTournamentEngine.ts:83`: same qualifier union mismatch.
- `src/server/services/customTournamentEngine.ts:194`: number is not assignable to `1 | 2`.
- `src/server/services/customTournamentService.ts:850`: `actorUserId` is absent from `CustomTournamentAuditLog`.

These are diagnostics of the uploaded snapshot, not a claim that all four were newly introduced by AI Studio.

### Uploaded regression suite

`node scripts/run-isolated-test.mjs src/server/tests/teamsEcosystemRegressionTest.ts` exits 1 at its natural-language test. The expected `team_ticket_grant` action is classified as `club_assign`. Later invitation tests do not run after that assertion; the suite is not passing.

### Independently reproduced behavior

A separate isolated audit used test-only memory stores, dummy accounts, cleared environment credentials, blocked external networking and suppressed bot notifications:

1. Grant one ticket, call `createTeam` twice with the same idempotency key. Two different team IDs are returned while only one ticket is spent. Team creation is not idempotent.
2. Create an invitation, cancel it, then accept it as the correct recipient. Its status becomes `ACCEPTED`; cancellation is not enforced.

No real Telegram messages or production records were used.

### Static integration and transaction issues

- `createTeam` spends its ticket before persisting the team in a separate write. A failed team write is not atomic with the ticket debit.
- Invitation acceptance reads a roster, then updates the team and invitation separately. Concurrent joins may overwrite each other; a team write and invitation state are not committed together.
- `respondToTeamInvitation` does not reject `CANCELLED` / `EXPIRED` invitations or compare `expiresAt` before accepting.
- New team records use the independent `teams` collection and `team_...` IDs. Current production leagues use `team_league_preview_teams` and `tp_...` IDs. The uploaded work is not integrated with current league snapshots, profiles or statistics.
- The uploaded limit changes touch the personal/custom-tournament engine, not the current TEAMS league wizard and `savePreviewLeague` checks. The production TEAMS 16-team limit is therefore not fixed by importing these edits.
- Some route/service permissions allow any global admin; the requested policy distinguishes the platform owner from a team's own administrator. Authoritative account revocation/suspension must also be checked.
- The old baseline's Telegram membership service includes fail-open paths. Carry forward the current main implementation and require verified membership for the new actions.

## Merge preview against current main

A non-mutating `git merge-tree --write-tree` preview reports five actual content conflicts:

- `src/components/CompetitionHubView.tsx`
- `src/lib/customTournamentEngine.ts`
- `src/server/app.ts`
- `src/server/services/customTournamentEngine.ts`
- `src/server/services/telegramAiAdminGateway.ts`

This preview did not modify the main working tree or resolve conflicts. A clean text merge elsewhere would not resolve the architectural and transactional blockers above.

## Safe continuation

1. Start implementation from the latest `main`, never replace it with this old snapshot.
2. Use this branch and its manifest as the source of recoverable AI Studio work.
3. Reconcile the recovered membership/ticket model with the existing production TEAMS league model and historical snapshots.
4. Make ticket debit + team creation a single durable transaction with user-scoped idempotency. Make invitations and roster changes transactional too.
5. Enforce invitation status/expiry, recipient identity, owner/team-admin scope, account revocation and mandatory group membership.
6. Integrate the actual TEAMS league limits, admin UI, bot callbacks and AI ticket commands.
7. Pass type checking, the existing production regression suite and additional durable/concurrent HTTP tests before deployment.

The recovery branch deliberately blocks its build command so the archived runtime cannot be accidentally deployed. Remove this guard only in a new implementation branch based on current main, after the blockers are fixed.
