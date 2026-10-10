# Legacy ownership repair, 10 October 2026

The owner authorized production corrections and continuation after PR #91. The five defects below predated the PostgreSQL cutover. They were repaired in production after native PostgreSQL tests and a live transaction dry run followed by rollback.

| Record | Evidence | Repair |
| --- | --- | --- |
| 2026/27 Monaco membership | Admin release audit, released occupancy and released user membership at 26 September 10:22:11.363 UTC | Mark old club membership released at the recorded release time |
| 2026/27 Toulouse membership | Released occupancy and matching transfer to active Alaves membership/occupancy at 3 October 14:59:48.820 UTC | Mark old Toulouse membership released; preserve Alaves |
| 2027/28 Arsenal membership | Released occupancy and released user membership at 17 September 15:33:22.384 UTC | Mark future-season membership released; preserve current-season Arsenal |
| Two `fix-test-arsenal-chelsea` submissions | Missing fixture; exact synthetic fixture and users present in `adversarialTestSuite.ts`; September 7 timestamps | Move out of active submissions into recoverable archive |

`scripts/sql/repair-2026-10-10-legacy-memberships.sql` locks the production namespace, validates release/transfer evidence and submission identities/scores/timestamps, and performs ten operations in one existing document RPC transaction. It changes no schema. Changed evidence or a repeat execution aborts without writes.

Five complete originals are preserved in private `efl_runtime.documents`, collection `legacy_recovery_archive`, with deterministic IDs prefixed `2026-10-10_`. Each archive's `encoded.value.original` contains the exact original encoded document; `data.original` is its decoded representation. Recovery can use that encoded original in a `set` operation on the archived `sourcePath`, after verifying the repaired document has not subsequently changed, with a fresh namespace generation. Archive records must remain intact. This is an intentional administrative recovery procedure, not automatic application startup work.

The reverse user-to-club audit then found six additional old user memberships. Four belonged to former owners of Fulham, Bournemouth, Chelsea and Crystal Palace, whose occupancy, club membership and current user link all agree on newer owners. Their old user memberships were archived and marked released with the documented replacement claim as `supersededAt`; no unknown release time was invented. Two missing synthetic users (`user-cup-away`, `user-test-2`) had stale memberships against Manchester United and next-season Arsenal. Those memberships were quarantined after verifying that neither synthetic user owns an active occupancy. Current owners were preserved.

`scripts/sql/repair-2026-10-10-stale-user-memberships.sql` performs this second evidence-guarded transaction. Its native PostgreSQL tests verify six exact original archives, four superseded links, two quarantined links, preservation of all canonical ownership, changed-evidence rollback and repeat-execution rejection. Both scripts were tested locally and in live transactions that rolled back before the approved production applications.

Final live read-only audit (`scripts/sql/audit-postgres-ownership.sql`): membership-to-occupancy mismatches **0**, occupancy-to-membership mismatches **0**, active owners missing users **0**, active primary/secondary user links missing occupancy **0**, active occupancies missing user links **0**, orphan result submissions **0**, decoded/encoded discrepancies across production documents **0**, recoverable originals **11**. Current-season Arsenal and Alaves still have their original active owners.

The administrator assignment path could recreate Toulouse's defect: it released the previous occupancy separately, left the previous club membership active, then committed the new assignment. The correction reads ownership and commits both sides in one transaction, releases both previous ownership records, and refuses to overwrite another active owner. A competing claim causes a PostgreSQL generation conflict and re-read. Native PostgreSQL regression tests cover failed commit preservation, transfer consistency, occupied-club rejection and concurrent assignments.

Legacy Redis export remains blocked. One read-only `SCAN` request on 10 October returned HTTP 403: the Upstash database has reached its Fixed plan limits. No Redis write, plan change, queue replay or Telegram send occurred. Existing history/settings are not claimed to be migrated or empty; PostgreSQL stays the production provider. Real Telegram login and mobile startup timing still require observation on a real device.
