# Munfiz and EFL UZ private chat

## Native assistant (selected deployment)

The selected approach runs text conversation directly in EFL, using its existing Gemini provider and `telegram_ai_state` PostgreSQL store (or configured Redis). No Munfiz server, Railway service, additional AI subscription or new paid resource is provisioned. Existing provider quotas and hosting limits still apply; this does not make model usage unlimited or guarantee free operation beyond those limits.

`EFL_PRIVATE_ASSISTANT_ENABLED` defaults to enabled; set it to `false` to restore the old owner DM behavior. Scope is the primary owner's genuine direct messages only, excluding forwarded/anonymous messages and delegate admins. Group behavior stays football-only. The optional external CowAgent adapter below stays disabled unless explicitly configured separately.

Native memory retains up to 24 exchanges (48 turns), 32000 UTF-16 characters total, 1200 Unicode code points per user turn and 3000 per assistant turn. It expires 30 days after the last successful save. It uses keys scoped by environment, bot and sender, separately from older one-hour group histories. It is a bounded transcript, not unlimited autobiographical memory or semantic retrieval. Prior answers are not evidence of completed actions. PostgreSQL/Redis outages can prevent memory reads/writes; no disk inside Vercel is used.

`/forget`, `xotirani tozala`, `kontekstni tozala` or `yangi suhbat` clears native chat history. It does not erase Telegram messages, payment/audit records or pending admin plans. Use `bekor qil` to cancel a pending plan. The reset only claims success after state storage confirms it.

General text, translation, planning and code questions can use the existing model. Short replies inherit verified conversation history, and a plain affirmation replying to a normal assistant answer is not routed into admin confirmation. An actual delivered pending admin plan retains its confirmation flow. EFL writes require the existing validated plan and confirmation. Web browsing, shell execution, CowAgent plugins, attachment processing, background work and artifact delivery have not been ported. Existing request deadlines, provider limits, delivery replay guards and read tools remain in force.

The tests mock model and Telegram calls and exercise durable state through the selected storage interface. They do not prove subjective model quality or a live Telegram conversation.

## External CowAgent adapter: verified source and current state

Reviewed `TexnoAyti/munfiz` at `396d22618090659480650719cf236c57598a8b82` (default branch `master`). It is a CowAgent fork, not an EFL backend. Its `docs/extensions/chat-api.mdx` and `channel/web/api/openai_compat.py` implement bearer-authenticated `POST /v1/chat/completions`, `agent_id`, and stateful `conversation_id`.

The user confirmed the service has not been started. No live Munfiz endpoint or key was available during implementation. EFL's adapter is disabled until the server is running and configured. Adapter tests mock external HTTP; they do not prove the Python service or model is deployed.

On 2026-10-15, Railway was connected and `efootball-bot` production was inspected (project `8e02f9df-5c95-4716-bf36-fac073d788aa`, environment `bed64adc-e004-48da-b030-6b77c7e894f6`). Creating a separate `munfiz` service was rejected with “Your trial has expired. Please select a plan to continue using Railway.” A subsequent inventory confirmed no service, volume or staged change was created. Billing activation is required before the deployment steps below can run. Existing Postgres was not modified.

## Routing and scope

EFL remains the Telegram webhook receiver. Its existing start/help/payment and admin confirmation routes run first. Public facts and deterministic EFL operations stay in EFL. Generative text answers in the primary owner's direct chat use Munfiz when enabled. Other users, delegates, forum topics, forwarded messages and anonymous senders do not get access to Munfiz through this adapter.

Munfiz receives the current text and public EFL context, with a conversation ID containing environment, bot, chat and sender. It receives no EFL bot token or database credentials. Only `message.content` is returned; reasoning and tool traces are not sent to Telegram. Responses use plain text. Photos, voice, files, CowAgent slash commands and asynchronous artifact delivery are not implemented by this Chat API adapter.

An outbound agent request is durably claimed before HTTP. A timeout or unsuccessful call is not automatically repeated: its tools may already have run. Telegram's existing delivery claims and limits also apply. The current EFL request budget is 30 seconds, so long agent jobs need a separate asynchronous delivery path; this adapter reports an unconfirmed outcome rather than pretending they completed.

## Run the fork on a persistent host

Use a long-running Docker host, for example Railway with a volume. Ordinary stateless Functions do not preserve CowAgent's workspace, SQLite history and memory files.

Build the **fork's source**, using `docker/Dockerfile.latest` at the reviewed commit, with `INSTALL_BROWSER=false`, `USE_CN_MIRROR=false`, and `TZ=Asia/Tashkent`. The root `Dockerfile` only inherits an upstream `latest` image and does not copy the fork source. The source Dockerfile uses Python 3.10/Bullseye and installs mutable upstream dependencies; a Docker build was not run in the implementation environment. Review a successful build and its logs before enabling the adapter.

Mount a persistent volume at `/home/agent`. Set:

```text
CHANNEL_TYPE=web
WEB_HOST=0.0.0.0
WEB_PORT=9899
WEB_PASSWORD=<random console password>
EXTERNAL_API_ENABLED=true
EXTERNAL_API_TOKEN=<different long random bearer token>
AGENT=true
AGENT_WORKSPACE=/home/agent/cow
COW_DATA_DIR=/home/agent/.cow
AGENT_PERMISSION_MODE=workspace-write
TZ=Asia/Tashkent
```

Configure a working model/provider in the CowAgent console, or with its documented `MODEL` and provider-key environment variables. Credentials belong in the host's secret settings, never Git. Permission modes are argument checks, not an OS sandbox; keep the agent inside its container and do not mount the EFL checkout, database secrets or Docker socket.

Expose port 9899 through the host's HTTPS domain. Do not connect the existing EFL Telegram token to CowAgent's Telegram channel: that channel uses polling, while EFL already receives updates through its webhook.

## Verify before activation

1. Confirm the Docker build, persistent mount, HTTPS domain and console authentication work.
2. Call authenticated `GET /v1/models` and confirm the intended model is configured. Missing or incorrect bearer tokens must be rejected.
3. Send two harmless Chat API messages with the same `conversation_id` and verify conversation continuity and final text. Restart the service and check persisted history. These tests can consume model credits.
4. Set EFL **production only** environment variables:

```text
MUNFIZ_CHAT_API_URL=https://<real-service-domain>/v1/chat/completions
MUNFIZ_CHAT_API_TOKEN=<EXTERNAL_API_TOKEN from the host>
MUNFIZ_AGENT_ID=default
MUNFIZ_PRIVATE_CHAT_ENABLED=true
```

5. Redeploy EFL and test one harmless message from the primary owner's direct chat. Confirm the source host receives one request and Telegram receives one answer. Verify a group message and another user's DM do not call Munfiz, and existing admin approvals and payments retain their own routing.

To disable the integration, set `MUNFIZ_PRIVATE_CHAT_ENABLED=false` and redeploy; existing Gemini/local responses remain available. Never claim a live connection solely because the adapter's mocked tests passed.
