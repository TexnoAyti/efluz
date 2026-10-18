# Telegram AI assistant upgrade

## Owner chat

Text requests up to 12,000 Unicode code points reach Gemini in full. Larger requests receive an explicit request to split them and cannot create an admin action. Existing response ceilings remain 1,000 / 3,000 characters. Admin clarification drafts retain their existing smaller bounds.

Private memory keeps at most 24 exchanges / 32,000 transcript characters for 30 days, with at most 4,000 characters of labelled extracts from evicted exchanges. This is extractive compaction, not a semantic memory database. Extracts are quoted conversation data, not instructions or evidence of completed work. Existing array records and `/forget` continue to work.

Send a football result screenshot as a Telegram **photo** in the primary owner's genuine DM. A bounded JPEG/PNG (up to 4 MiB) is downloaded from Telegram and sent to the configured Gemini model. Photos, captions and model output cannot directly create or confirm actions. The answer shows an unverified result and asks the owner to send a separate explicit result request with competition/stage; the usual verified fixture preview and confirmation then apply. Image files, voice and arbitrary documents are not supported. No images are retained by EFL.

## Decisive single-match cup results

Examples:

- `Barcelona 1-1 Real Sociedad Copa del Rey chorak final, penalti 3-1 natijasini kirit`
- `Barcelona 1-1 Real Sociedad Copa del Rey chorak final, qo‘shimcha vaqt 2-1 natijasini kirit`

Extra-time values are the **cumulative score after extra time**, not additional goals, stored separately as `homeExtraTimeScore` / `awayExtraTimeScore`; regulation scores remain unchanged. Shootout scores are separate `homePenaltyScore` / `awayPenaltyScore` fields and do not enter goals or league points. Both match and shootout orientation follows the explicitly named teams; server home/away order may differ. An unlabelled second score, tied shootout or shootout after a decisive main score is rejected. European two-leg aggregate decisions are not implemented by this single-match path.

The PostgreSQL result transaction saves scores, winner, fixture override, audit and refresh/notification intent together. Existing winner advancement runs from the durable result refresh worker. The same shared cup-result validator used by the site handles AI requests. Normal corrections and reset clear stale penalty fields. Existing admin authorization and delivered, one-use confirmation still apply. This change does not repair historical results automatically.

## Daily report and diagnostics

Admin → Telegram AI now includes response counts, average handler latency and sanitized failure categories for today (UTC). No user prompts, responses, tokens or raw exception messages are stored in metrics. Updates are deduplicated by update ID and expire after eight days. Missing metrics are displayed as unavailable/no observations, not as proof of a healthy model.

The report preview is a primary-owner-only GET. It lists current-round unfinished games, pending results, disputed games and confirmed tied domestic cups without a winner. It discloses incomplete/stale snapshots; no scores are modified.

Daily delivery is **off by default**. Enable the checkbox and save settings to receive the report in the primary owner's DM. It uses the existing authenticated `/api/internal/telegram-worker` cron (03:00 UTC / 08:00 Asia/Tashkent), requiring the existing `CRON_SECRET` and Vercel cron deployment. Repeated worker triggers share an environment/bot/local-date claim. Incomplete datasets are not delivered. Unknown/failed send attempts are not automatically replayed that day, avoiding duplicate messages.

## Validation

`npm run lint`, `npm run test:telegram-ai:all`, `npm run build` plus result-notification, topic-result and domestic-cup-flow regressions. The enhancement suite exercises actual Gemini SDK request construction against mocked HTTP, long input, extracts, image parsing without writes, reversed penalties, authoritative result receipts, concurrent report delivery and metrics deduplication. Telegram and model calls are mocked; no live messages, production scores or deployment settings are changed by these tests.
