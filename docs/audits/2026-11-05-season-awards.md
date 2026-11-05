# EFL season awards — 2026-11-05

The public entry is Turnirlar → Mukofotlar; global administrators also have Admin → Mukofotlar. The existing TEAMS placement and tournament navigation remain intact. Awards load only when the section is opened.

## Automatic shortlisting and statistics

Season-scoped fixtures, occupancies and recorded player trophies are read, followed by batched account lookups. No per-player season-report fanout is used. Only confirmed integer scores count; shootout totals and pending proposals do not count as goals. A recorded fixture owner takes precedence over current occupancy. Without a recorded owner, attribution requires a confirmation timestamp during the current owner's tenure; unknown old ownership is reported and excluded instead of awarding old goals to a new owner. Suspended and ambiguous Telegram accounts are excluded from automatic shortlisting.

TOP-10 eligibility defaults to three confirmed appearances, configurable before opening. The published EFL shortlist algorithm compares points per game, goal difference per game, recorded trophies, goals per game and appearances, with an immutable ID only as the final deterministic ordering. This is an EFL statistical shortlist, not a claim that France Football uses an automatic ranking formula. Individual performance, collective achievement and fair play are explained to voters; no invented fair-play score is used. If fewer than ten qualify, opening is refused rather than fabricating nominees.

Golden Boot is the current season goal leaderboard, including tied leaders. Player of the Week shows the preceding complete week and the current race, with Monday midnight boundaries in Asia/Tashkent. Weekly ordering is points, goal difference and goals, with joint preceding-week winners where all three tie. Only resultConfirmedAt is used for weekly inclusion; scheduled times are not treated as proof of when a result was confirmed.

## Ballon voting

France Football's published 2026 criteria, ranking points and countback were checked at https://ballondor.com/news/posts/check-all-the-criteria-and-full-regulations-to-understand-ballon-dor-2026-trophy . EFL uses ten automatic nominees and club owners as its electorate. The ten places give 15, 12, 10, 8, 7, 5, 4, 3, 2 and 1 points. Total points and successive place counts determine the winner. Only a completely unresolved countback tie can be adjudicated by an administrator, restricted to the tied leaders and with a recorded reason.

The nominee list freezes when opening. Opening also freezes the unique Telegram identities of current eligible club owners. Casting rechecks the authoritative account, suspension, unique Telegram account, jury membership, current ownership, election identity and server deadline inside a transaction. One Telegram identity has one updateable ballot, regardless of club count. Joining a club after opening cannot add a new voter. Global admin permissions are rechecked transactionally; scoped admins cannot manage the election. Administrators can prepare/recompute a draft, open/reopen with a deadline, close, and publish; they cannot replace a voted winner with an unrelated nominee or rewrite individual ballots. Reopening preserves the same nominees, electorate and votes.

Ballots and jury identities are omitted from every response. Only the caller's ballot is returned after a fresh identity check. Public totals stay hidden until publication; admins can inspect the tally once voting closes. No production election was opened, result changed or Telegram message sent by validation. Season award and audit documents use the existing private document runtime; no schema migration or public grants were added.

## Validation

TypeScript, production build/self-check and native PostgreSQL integration passed. New unit/HTTP/SQL coverage exercises automatic TOP-10, cross-club ballot dedupe, recorded/unknown historical ownership, weekly boundaries, malformed/duplicate rankings, forged/scoped admin claims, suspension, duplicate Telegram identities, outsider/new-owner rejection, concurrent vote preservation, private ballots, deadline expiry, closed voting, publication barriers and countback-only tie adjudication. An isolated browser audit at 320, 393 and 844px checks admin error display, prepare/open, ranking changes and acknowledgement, double-click single-flight, hidden live totals, close/publish and horizontal overflow. Light and dark screenshots were inspected as implementation previews, not production phone screenshots.
