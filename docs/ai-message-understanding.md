# Meaning routing and ordered admin tasks

The owner DM assistant can route unfamiliar informal Uzbek, Russian and English EFL requests through a bounded Gemini meaning classifier. It classifies the original message as discussion, admin planning or a clarification; it cannot rewrite the request, pick IDs, run tools or approve an action. Known deterministic routes remain first. Provider failure falls back to ordinary grounded conversation. The classifier adds one model request only for eligible unfamiliar phrases and has a 4.5-second ceiling, reserving time for planning/delivery. This is not a guarantee of understanding every possible message; actual model quality still needs live evaluation.

Explicit club pronouns such as `shu klubni egasidan bo‘shat` may reuse exactly one selected club only when the latest non-courtesy user message explicitly named that club. The roster is re-read and stale/incomplete data is refused. Ambiguous or unrelated context asks for the missing club; an old discussion cannot authorize an action by itself.

## Task queues

In an authorized admin's genuine private chat, up to four explicit tasks can be separated by semicolons, newlines, `keyin` or `so‘ng`. Separators inside quoted messages/code are ignored; ordinary `va` is not guessed as a task boundary. Each part must already be recognizable as an admin request. Example:

```
La Liga 10-turni qulfla;
APL 11-turni och
```

The assistant shows the queue and prepares the first step. Supported protected GET requests run as read-only operations. Every write retains the existing validated preview, authorization recheck and separate one-use confirmation. After a successful server receipt, the next request is planned against current data. No approval is carried from one write into another. Cup generation retains its separate draw preview/generation approval.

- `davom et`, `davom ettir`, `keyingisi`: show the current unexecuted preview or resume planning.
- `topshiriqlar holati`, `navbat holati`: show progress without execution.
- `bekor qil`: cancel the current pending queue plan and remaining requests.

Queue state lasts 30 minutes and is scoped by environment, bot, sender, chat and thread in the existing PostgreSQL/Redis state store. Versioned compare-and-swap transitions prevent racing requests or old callbacks from advancing a newer queue. Each existing execution receipt is checked before advancing. Failed, queued or unverified writes stop the queue; uncertain operations are not automatically retried. If the next preview was not delivered, resume shows its existing token rather than repeating the completed write. A missing-field clarification can fill the same step, and score/round revisions rebind only the corrected plan.

Requests outside supported application capabilities still need an explanation or a clarification. Browser/shell execution, arbitrary code deployment, general file processing and unrestricted background work are not added. Existing account roles, league scope, actor isolation and model quotas remain authoritative.

Validation uses isolated regression tests, actual Gemini SDK request construction with mocked HTTP, Telegram button dispatch, ordered approvals, read steps, duplicate clicks, failed-delivery resume, stale cancellations, version races, authorization isolation, provider JSON validation and fresh club context. No live model-quality benchmark or production data mutation is part of the tests.


## Bulk unplayed league results

In the authorized admin's private chat, `La Liga 9-turgacha o‘ynalmagan hamma o‘yinga 0-0 ber` prepares one bulk operation for rounds 1 through 9, inclusive. `La Liga 9-turdagi o‘ynalmagan barcha o‘yinlarga 1-1 qo‘y` selects only round 9. A missing league prompts for one league; the assistant does not infer an all-league scope. Unsupported exceptions, extra quantities, multiple scores and hypothetical or negative requests require clarification. Club-filtered requests are not broadened to the whole league. Non-equal scores use the home/away order clearly shown in the preview; this is an ordinary recorded score, not a disciplinary walkover.

The protected preview reads the authoritative PostgreSQL store. It reports season, inclusive range, exact count, counts per round, skipped count and four sample pairings. Only SCHEDULED/POSTPONED fixtures with no scores, winner, confirmation timestamp, submissions or disputes are eligible. Confirmed, submitted, disputed, cancelled, unresolved pairings, other seasons, other competitions and retired fixtures are excluded. Only an ACTIVE season and a LEAGUE competition are supported, at most 120 eligible fixtures per operation (the 90 games across nine rounds fit). More fixtures require a smaller range. Existing league-scoped permissions and current account status apply.

One separate five-minute, single-use approval commits the entire selected set, per-game audit records, visible fixture overrides, refresh/notification jobs and an idempotency receipt in a single transaction. A fingerprint binds the exact preview state and filters. Changes between preview and approval refuse the entire operation and require a new preview. A repeated request with the same operation key returns the saved receipt; a different approval cannot overwrite the completed results. There is no offline score fallback or automatic retry after an uncertain response. Standings and notification delivery are asynchronous and reported as pending, separately from committed scores.

Regression coverage includes natural phrasing, exact/inclusive ranges, existing scores and submissions, stale preview refusal, actor/league/season boundaries, actual protected route dispatch and receipt verification. The native PostgreSQL suite commits 90 matches, injects an SQL error to prove full rollback, retries successfully and checks simultaneous idempotent approvals. Tests do not modify production fixtures or send real Telegram messages.
