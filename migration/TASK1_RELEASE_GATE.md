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

## Result confirmation atomicity gate — 2026-11-08

- The original native `confirmResult` endpoint previously invoked the
  nontransactional fixture updater directly. The migration branch now routes
  through `confirmFixtureResultWithOutbox`, which requires one transaction
  spanning the confirmed score, audit record, two inbox messages and two
  delivery outbox entries.
- The new `MUTATION_CONTROL.resultConfirmationTransactionsVerified` flag is
  **false** independently of the global mutation switch. An SDK method named
  `transaction` alone is NOT evidence of atomic rollback semantics.
- Staging tests deny a missing transaction provider, invalid transaction
  context and released-club ownership before any fixture write. These
  offline tests cannot establish that Telegram's actual SDK rolls back
  cross-table operations on network failure.
- Migration-only CI run
  [42508562695](https://github.com/TexnoAyti/efluz/actions/runs/42508562695)
  passed build, TypeScript, gateway/result safety tests and backend syntax.
- Offline transaction simulator now exercises all-or-nothing score/audit/inbox/
  delivery commit under three injected failure points, then checks one
  audit and two inbox/delivery records on retry and stable replay.
  This does **not** validate the Telegram SDK's real transaction guarantees.
  CI: https://github.com/TexnoAyti/efluz/actions/runs/42509802587
- [ ] Verify SDK transaction semantics in isolated staging with injected
  audit/notification failure, concurrent confirmation attempts, retry and
  full rollback/readback; then review enabling the separate gate.
- [ ] Prove proposer result persistence, conflict handling, season-one cup
  tie-break parity, official standings updates and Telegram delivery parity.
- **No production result mutation or bot deployment has occurred.**

## Private import bundle integrity — 2026-11-08

- `prepareEflMigrationBundle.sh` now refuses to publish a completed
  private bundle unless both `verifyEflRawBatches.mjs` and
  `verifyEflNormalizedPackets.mjs` pass.
- The new normalized verifier compares all imported rows and source hashes
  against the distinct normalized snapshot, checks bounded packet envelopes,
  sequential packet identifiers and filenames, and rejects missing/extra files.
- CI [42510477363](https://github.com/TexnoAyti/efluz/actions/runs/42510477363)
  passed packet tampering, omitted-row, missing-file and snapshot-drift
  regressions, existing import replay tests, SDK gateway tests and both builds.
- No private export was generated or transferred by this change. **Archive
  integrity is not staging import or target parity.** Review-quarantined roots
  still require explicit resolution. Import and mutation endpoint gates remain
  disabled; production release remains BLOCKED.

## Target staging readback gate — 2026-11-08

- Added `tgcloud/endpoints/migrationReadback.js` and pure paginated
  `tgcloud/lib/migrationReadback.js`. A separately disabled
  `READBACK_CONTROL` demands an explicitly configured staging operator's
  server-verified Telegram ID. Existing import access does NOT grant readback.
- Readback accepts an exact allowlisted logical table, bounded keyset cursor
  and at most 20 rows per request. It explicitly lists known columns;
  rejects oversized responses, invalid keys, missing columns and nonascending
  rows. **It can contain private records; never enable it on production.**
- No target data has been read back yet. An actual staging export using the
  explicitly enabled operator-only endpoint, independent persisted target
  content, row hash parity, and checked provenance is still mandatory.
  A successful count-only `migrationAudit` is insufficient proof of parity.
- Offline CI [42511822457](https://github.com/TexnoAyti/efluz/actions/runs/42511822457)
  passed readback authorization/limit/keyset tests, migration packet checks,
  frontend TypeScript, backend parsing and both staging/React builds.
- Both import and readback controls remain `false`. Live production and
  staging data are unchanged; cutover stays BLOCKED.

## Live deployment / capacity blockers

There is no verified Telegram Serverless staging app URL, 1,000 distinct
staging credentials, or completed target import evidenced in this branch.
The load harness has passed **local automated tests**, which are NOT an
actual 1,000-user load result. Do not disable Supabase or Vercel before
a measured success in the actual target environment.

**Authoritative release state: NOT READY.**
