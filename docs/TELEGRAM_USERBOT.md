# EFLUZ personal Telegram worker

This worker connects to the owner's Telegram account through Telegram's MTProto API. It must run on a persistent process host; Vercel serverless functions cannot hold this connection.

## Setup

1. Copy the personal worker variables from `.env.example` into the host's secret settings.
2. Set `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` from `my.telegram.org`.
3. On a trusted local machine, run `npm run telegram:userbot:session` once. Put the printed `TELEGRAM_USER_SESSION` value in the host secret settings. Never commit it.
4. Set `TELEGRAM_USERBOT_ALLOWED_CHATS` to the groups the worker may inspect.
5. Mount `TELEGRAM_USERBOT_STATE_PATH` on persistent storage and run `npm run telegram:userbot`.

Send commands to your own **Saved Messages** chat:

- `/collect @group 500` scans up to 500 recent messages and stores unique human authors.
- `/campaign https://t.me/channel/123` sends the greeting and forwards the post once per stored author, subject to the daily limit.
- `/userbot_status` displays the current state.

With `GEMINI_API_KEY` configured, the same actions can be requested in ordinary Uzbek, for example: `@efootballnextgroup guruhidagi oxirgi 1000 xabardan mualliflarni yig‘`. The AI planner may select only the worker's implemented actions; it cannot invent arbitrary Telegram privileges.

The worker does not bypass Telegram flood controls. Keep the delay and daily limit conservative, and use campaigns only for recipients who agreed to receive them.
