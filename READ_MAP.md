# EFL UZ — Runtime Read Map & Quota Policy

## Canonical policy

EFL UZ is SQLite-first for normal runtime reads. Firestore remains the authoritative remote synchronization store, but ordinary navigation must not depend on Firestore reads.

### Hot-path reads

| Area | Runtime source | Firestore reads on normal navigation |
|---|---|---:|
| Seasons | Seed / SQLite | 0 |
| Leagues | Seed | 0 |
| League clubs | Seed + local occupancy snapshot | 0 |
| Available clubs | Seed + local occupancy snapshot | 0 |
| Club detail | Seed + SQLite occupancy | 0 |
| Competitions | Seed + SQLite state | 0 |
| Competition participants | SQLite | 0 |
| Standings | Materialized SQLite | 0 |
| Fixtures | SQLite | 0 |
| User profile/stats | SQLite | 0 |
| Notifications | SQLite | 0 |

## Authentication

Telegram `initData` is still cryptographically verified per request. The server-side user lookup is cached in-process for 60 seconds by default, so repeated API navigation does not repeatedly read the user document.

## Firestore usage is restricted to controlled paths

Firestore is used for remote synchronization, mutations, recovery, and explicitly non-hot administrative/reconciliation operations. Reads go through the central Firestore read guard and circuit breaker.

The breaker has three runtime modes:

- `FIRESTORE_PRIMARY`
- `SQLITE_FALLBACK`
- `RECOVERING`

Quota/unavailable errors open the breaker immediately. Recovery performs one guarded HALF_OPEN probe after the cooldown (5 seconds by default) rather than creating a retry storm.

## Background policy

Passive users have no continuous Firestore polling. Admin dispute refresh is limited to the active Admin view and a 5-minute interval while the document is visible.

Background reconciliation runs once shortly after startup and then once per minute, but it first performs the guarded recovery probe; it does not continuously issue Firestore reads while the circuit is closed/healthy without pending synchronization work.

## Free-tier reference

Cloud Firestore Standard edition provides 50,000 document reads per day, 20,000 writes per day, and 20,000 deletes per day in the no-cost tier. The quotas are applied daily and reset around midnight Pacific Time. See Firebase's current pricing documentation.

## Operational target

Normal user navigation should produce zero Firestore reads after authentication warm-up. Cold startup may require a small number of controlled Firestore reads only when a recovery/synchronization path explicitly needs them. Exhausted quota must not cause the UI to become empty or trigger repeated retries: SQLite remains the visible source of truth for runtime reads until Firestore recovers.

## Write path

UI mutation → SQLite transaction → immediate user-facing success → durable pending mutation → background Firestore synchronization → `SYNCED`/`FAILED` lifecycle.

Confirmed results update materialized standings locally before any remote synchronization attempt.

## Safety constraints

Production fixture generation/reset is non-destructive through exposed admin routes. Existing season, league, club, competition, fixture, user, Telegram, and membership identifiers must remain stable.

Google AI Studio must treat this architecture as canonical and must not create a second parallel database/resilience implementation.
