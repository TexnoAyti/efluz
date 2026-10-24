# AI administrator capability audit

The fixed action catalog contains 169 operations, each matched against an actually mounted application route by `telegramAiCapabilityAuditRegressionTest.ts`.

| Area | Catalog operations |
|---|---:|
| EFL core management and diagnostics | 112 |
| Discipline | 4 |
| Custom tournaments | 16 |
| Tournament tickets | 4 |
| Team league preview | 6 |
| UZEFLIFE | 27 |

This is route coverage, not a claim that 169 operations were run against production. Functional regressions use isolated data, original application routes and middleware; Telegram delivery is mocked. No real cards, tournament draws, ticket credits or messages are created for release verification.

## Native administration

These commands prepare a delivered, expiring plan without a language-model call:

- `@username ga haqorat uchun sariq kartochka ber`
- `@username ga qizil kartochka ber. Sabab: o‘yinni cho‘zdi`
- `Arsenal egasiga haqorat uchun sariq kartochka ber`
- `@username kartochkalarini ko‘rsat`
- `@username qizil kartochkasini bekor qil. Sabab: xato berilgan`
- `APL klub tanlashni yop` / `APL klub tanlashni och`
- `APL klub tanlash holatini ko‘rsat`
- `APL o‘yinlar vaqtini ertaga 20:00 ga o‘zgartir`
- `fixture id: GAME_ID stadionini o‘zgartir. Stadion: Emirates Stadium`
- `UZEFLIFE ro‘yxatni och`, `UZEFLIFE keyingi bosqichga o‘tkaz`, `UZEFLIFE pauzaga qo‘y`, `UZEFLIFE davom ettir`

Scheduling also supports a precise calendar timestamp, one uniquely resolved club match, category selections and clearing an individual venue. Timestamps without an explicit offset and relative dates use Asia/Tashkent. Calendar-invalid dates are rejected. The server supplies every schedule signature and the admission revision; a model cannot fabricate those previews.

Yellow remains a warning. Red keeps the existing one-game EFL league/cup hold and ordinary result restrictions. The preview binds the next eligible match, including a pending assignment when there is no schedule. Changed matches reject the old preview; club-name targeting rechecks the current occupancy, and username targeting rechecks the current account. Revocation removes the hold and verifies the returned revoked card. Card IDs remain request-idempotent, and both issuance and revocation write deterministic audit records in the same transaction as their state/notification.

Card operations remain primary AI owner operations and require a current full application administrator. Existing league-delegated AI users gain no global discipline/ticket/platform permissions. Discipline records are read through the existing protected router; full notes are not made public.

## Platform actions and semantic planning

The model can discover the complete permitted catalog using the private `read_admin_data` capability tool, inspect current records and prepare custom-tournament, ticket, UZEFLIFE and owner-only team-preview actions. These operations use fixed application prefixes, not model-provided URLs. Organizer, module, owner, scope and suspension checks run through the original routes. Private record IDs must be explicit or verified from the appropriate source; ambiguous secondary match/player IDs require clarification. Creating team objects assigns server IDs when absent, while edits retain the application's version checks.

Ticket grants, custom creation and publication receive a server operation idempotency key. User identity checks bind the actual user field (including nested tournament assistants), rather than accidentally looking up a tournament ID as an account. UZEFLIFE writes bind the reviewed revision inside the existing state transaction, and pending-result approvals use the actual stored proposal. A stale revision cannot advance a different round.

The separate engines remain separate: EFL discipline does not silently become a UZEFLIFE/team suspension. Authentication, participant self-service, binary evidence uploads, image rendering/downloads and external operations are not generic AI admin endpoints. They keep their existing application workflows. Required fields, exact participants and valid application state are still necessary; missing information produces clarification.

## Verification

- Every catalog action matches a real mounted route; all core routes in the administrative gateway have catalog coverage.
- Real gateway integration tests cover ticket/custom idempotency, account binding, custom assistants, team creation/start, stale versions, notifications and actor revocation.
- Full AI dispatch tests cover delivered preview, once-only confirmation, yellow/red/revoke receipts, result holds, audit writes, stale match/owner protection, scoped denial, admission, Tashkent scheduling and UZEFLIFE CAS.
- Existing discipline, UZEFLIFE, schedule, club-admission and AI regression suites remain in CI alongside the new tests.

The final merged-source audit also covers the concurrently introduced club-member-tag status and sync routes. Sync remains an explicit, owner-only, confirmed operation; release verification never runs it.
