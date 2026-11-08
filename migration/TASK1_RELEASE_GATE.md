# EFLUZ Task 1 — Telegram Serverless release gate
**State: BLOCKED — production has NOT migrated.**

This is a conservative engineering record, not authorization to cut over.

## Code / static source inventory

Baseline inventory: 72 root collections / 26,763 documents,
source `migration/source-collections-inventory.json` (a point-in-time estimate).
The live source can change; use a transactionally consistent export at cutover.

| Status | Roots | Baseline documents | What it means |
| --- | ---: | ---: | --- |
| Normalized converter path | 42 | 8,808 | Produces structured staging tables. Neither imported nor proven operationally equivalent. |
| Sealed private-archive binding | 9 | 23 | No private payload in normalized target; source checksum only. **Not operationally implemented.** |
| Review required | 17 | 7,147 | Sensitive/ambiguous runtime and AI state, recovery backups, workers and queues. Fail-closed policy. |
| Rebuild-only transient | 4 | 10,785 | Reconstruct only after proving correctness; never restore stale leases/sessions. |

**Do not sum historical root counts to claim target import completeness.**
Mixed source collections, especially `telegram_ai_state` and `runtime_state`,
contain volatile values. Stale notifications and Telegram callbacks must never
be replayed. Archived evidence can exceed one Serverless import packet;
`prepareEflRawDocumentBatches.mjs` handles multipart private raw records.

## Required tests before production release

- [ ] Final production export completed using read-only access and verified
      against a consistent source transaction.
- [ ] All source roots identified; no new unknown roots since inventory.
- [ ] A full private archive is verified by source hashes; review domains
      have explicit, audited handling decisions. **Do not mark reviews as
      rebuild only to make the gate green.**
- [ ] All normalized tables imported into an isolated Telegram Serverless
      staging app, independently read back, and compared with source rows.
- [ ] Historical sealed-only domains have an operational implementation,
      authorized historical read path, or a deliberately approved documented
      deprecation. No user-visible functionality can silently disappear.
- [ ] Telegram Mini App, bot, auth, AI, admin permissions, finance, clubs,
      leagues, fixtures, cups, custom tournaments, TEAMS, UZEFLIFE,
      trophies, messaging, notifications and round controls pass end-to-end
      feature parity, including concurrency and idempotent replay.
- [ ] 1,000 distinct **server-verified** staging user identities sustained
      for 60 minutes, plus real Mini App browser performance and write-
      contention testing. See `THOUSAND_REAL_USERS_GATE.md`.
- [ ] Frozen source snapshot + final delta reconciliation + rollback proof.
- [ ] Target credentials, app ID and deployment explicitly verified as
      staging before any deployment. Production webhook remains untouched
      until all above pass.

## Automatic fail-closed checks

- `scripts/auditServerlessDomainCoverage.mjs` distinguishes `mapped`,
  `sealed`, `unmapped`, `review` and `rebuild`. A sealed root is **not**
  normalized domain coverage.
- `scripts/verifyEflNormalizedSourceBinding.mjs` recomputes normalized
  tables independently from the exact archived source.
- `scripts/preflightEflCompleteMigration.mjs` checks exact archive binding,
  independently normalized source binding, and source/target row-hash parity.
  It intentionally reports `cutoverReady:false`.
- Shadow import and mutation controls remain disabled in
  `tgcloud/lib/importControl.js` and `tgcloud/lib/mutationControl.js`.

## Live deployment / capacity blockers

There is no verified Telegram Serverless staging app URL, 1,000 distinct
staging credentials, or completed target import evidenced in this branch.
The load harness has passed **local automated tests**, which are NOT an
actual 1,000-user load result. Do not disable Supabase or Vercel before
a measured success in the actual target environment.

**Authoritative release state: NOT READY.**
