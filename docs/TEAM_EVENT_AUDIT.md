# TEAMS/event readiness audit

## Fixed

- Retired the El Clasico directory entry; legacy launch links show that it is closed. Server writes and subscription checks default to HTTP 410. Historical results remain stored.
- El Clasico's reusable event flow now includes Telegram contact links, participant result proposals, opponent confirmation, disputes and owner resolution.
- Team tournaments now expose an authenticated “My matches” panel with fresh opponent contacts and a separate participant result endpoint. It cannot invoke lineup, pairing, administrative scoring or tournament controls.
- Unconfirmed proposals never change standings, statistics or progression. Spectator responses omit proposals. Scores use home/away labels regardless of who submits.
- Pending/disputed team results block roster reset and substitutions. Administrator score corrections clear proposals/disputes.
- Version checks serialize stale/concurrent writes. Participant views poll while visible; old poll responses cannot replace newer versions.

## Verification

Passed TypeScript, production build/deployment self-checks and native PostgreSQL HTTP integration suite. Coverage includes membership invitations and races, administrator revocation, real 64-team schedules, 30-player pairings, substitutions, knockout ties, qualification, final completion, failed-commit rollback, notification intents/retries, participant ACL, self-confirmation refusal, stale-version rejection, disputes and exactly-once concurrent completion.

These are isolated tests. Telegram HTTP delivery is simulated, not a real message to a production participant. The new panel still requires visual verification in Telegram on mobile, especially tg://user contact links for accounts without usernames. Production deployment and real delivery have not been verified by this audit. Do not call the entire feature production-ready until those checks pass.

El Clasico stays disabled by default. EL_CLASICO_ENABLED=true is an explicit server opt-in for testing/reuse, not part of this retirement release.
