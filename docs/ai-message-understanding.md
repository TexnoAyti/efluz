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
