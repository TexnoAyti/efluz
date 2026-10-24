# AI matchday and notification controls

The owner AI accepts natural Uzbek matchday commands, including `ochgin`, `yopib qo‘y`, `cho‘zgin`, `joriy tur`, and `keyingi tur`. Durations accept hours or days, with a resulting whole-hour value between 1 and 720. Incomplete, conflicting, negative and hypothetical instructions never execute a write.

Examples:

- `APL 11-turni 2 kunga ochgin`
- `APL joriy turni yopib qo‘y`
- `APL 10-turni 6 soatga cho‘zgin`
- `APL keyingi turga 1 kunga o‘tkaz`
- `APL 10-turda hisob kiritmaganlarga eslatma yubor`
- `APL hozir nechanchi tur?`
- `APL hammaga “11-tur ochildi” deb bildirishnoma yubor`

Existing delivered-plan confirmation, actor/topic permissions and once-only execution remain in force. Round and duration corrections replace the delivered plan and invalidate the previous token. Next-round previews include their source round; confirmation rejects a changed current round or competition version rather than advancing from a newer state. Matchday-control plans also carry the source update version.

Broadcast recipient scope is taken only from the command outside quoted message text and labelled body/title. A named league takes precedence over “hammaga”; multiple leagues or a mixture of individual and group recipients require clarification. Semantic model broadcast proposals are re-parsed through the explicit native planner, so a model cannot silently broaden recipients or invent the message.

Manual reminders require an available fresh fixture snapshot and re-read candidate fixture documents, current club occupancies, users, and result submissions from the authoritative database before enqueueing anything. Confirmed, cancelled and postponed fixtures are excluded. Former/released club owners and users who already submitted a result are excluded. Source failures abort before any enqueue; queue failures are counted separately from deliberate/idempotent skips. A full 100-row submission page is treated as incomplete rather than assuming there are no further submissions.

Receipts distinguish queued messages from delivered messages. Matchday receipts verify the returned competition, round and open/locked state. Missing or mismatched receipts are reported as unverified and are never retried automatically. Read-only matchday status includes the current round, open rounds, deadlines in Tashkent time and unfinished fixture counts.

Validation: all Telegram AI regression files, focused matchday control/advance/reminder tests, TypeScript checking and production build/self-check. The additional `telegramAiMatchdayNotificationsRegressionTest.ts` is included in CI. All tests use isolated data and block external network; no real Telegram broadcasts or reminders are sent.

## Reply and inclusive reminders

`Bundesliga 9 turgacha o'ynalmagan o'yinlarga Eslatma yubor` selects Bundesliga rounds 1–9, including round 9; it cannot select round 10 or another league. Other mutations still reject `turgacha`.

Reply `Eslatma yubor` to a delivered AI fixture list to prepare a reminder for that exact message's selection. Recipient selection is stored with the Telegram bot-message index, bound to sender, chat, thread and bot message ID, rather than taken from the latest conversation. An older Bundesliga list remains Bundesliga even after a newer APL conversation. Single-match/list selections preserve exact fixture IDs; remaining-fixture summaries preserve their stated inclusive range. Missing or unverified reply context asks for the target and never guesses from history. Previously delivered bot lists can recover scope only from their fixed canonical competition/round header and unplayed-count summary, excluding incomplete or stale list warnings.

The existing confirmation and once-only execution flow applies to the bounded range. All fixture, occupancy and submission reads across the range must succeed before any enqueue; each actual game retains its own round in notification text and deduplication keys.
