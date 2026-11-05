# Photo intake recovery — 2026-11-05

Production observation: the UZEFLIFE photo update reached the webhook at 10:57 UTC but no topic result was produced. The owner DM returned the generic photo-service exception message. Earlier logs do not preserve forwarding metadata or the underlying provider/file exception, so the precise original exception cannot be reconstructed.

Changes:
- Manual screenshot forwards are accepted as evidence from the current sender. The original forwarding identity never grants permissions. Existing fresh-account, suspension, fixture ownership, approval, conflict and deduplication checks remain; automatic channel forwards and forwarded text remain excluded.
- Owner DM photo forwards bypass the optional channel archive and use the read-only image reader.
- Trim the bot token consistently with other Telegram clients.
- Bound model retries to one retry for transient 5xx errors. Do not retry hard quota/auth failures. Preserve deadlines and reserve time to reply. Increase JSON output allowance to avoid truncation.
- Log only predefined failure stage/kind and numeric HTTP status, never provider messages, request URLs, credentials or image content. Replies distinguish quota, configuration, Telegram download, format and timeout failures. Optional GEMINI_VISION_MODEL can override the text model without changing it.

Validation: isolated forwarded-photo proposals and original-author impersonation denial; signed owner-DM forward through the real SDK with mocked Telegram/model transport; token whitespace; 429 single attempt; Telegram 400 stage; transient 503 retry; existing topic/follow-up suites; typecheck and production build. No live messages/results submitted. Actual provider availability and the original screenshot need a fresh real photo update after release to verify; do not claim the original exception was fixed solely from mocked tests.
