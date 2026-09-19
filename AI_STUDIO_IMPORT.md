# EFL UZ — import and deployment notes

This copy contains the read-model, club ownership, domestic cup, European qualification, and Telegram queue repairs. It was checked locally without production credentials.

## Required Vercel variables

Set these in **Production** and **Preview** where the API is deployed:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (preserve `\n` escapes or paste the multiline value supported by Vercel)
- `FIRESTORE_DATABASE_ID`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `CRON_SECRET` (a long random value)

The Redis variables may also be supplied by Vercel Storage as `KV_REST_API_URL` and `KV_REST_API_TOKEN`; the server accepts both names.

Do not set `FIREBASE_FORCE_LOCAL_FALLBACK=true` in Vercel, Cloud Run, or any production deployment. That mode is only for the isolated tests below.

## Deploy sequence

1. Import this folder into the GitHub repository used by Vercel.
2. Run `npm install` or use the existing Bun lockfile.
3. Add the variables above, then deploy.
4. Open `/api/health` and confirm a JSON `status: "ok"` response.
5. In the admin panel, open **Read Model Health**. If a dataset is `MISSING`, run **Rebuild Read Model** once after confirming Firestore and Redis variables.
6. Telegram broadcasts require the Redis recipient directory. Open the Telegram admin tab, refresh recipients, select users, and send. The queue is durable in Redis; **Flush Queue** processes it immediately. A failed or interrupted Telegram delivery is marked `DELIVERY_UNKNOWN` so it is reviewed instead of being blindly duplicated.

## European competitions

The qualification preview reads current confirmed domestic results and the stored competition format. Apply is blocked if the preview data changed, a European match has started, the allocation does not equal the configured team count, or the preview was already applied. Generate a new preview after any data change.

## Isolated verification

These commands use a temporary SQLite directory, local in-memory Firestore, and a network guard. They do not write to production:

```bash
npm run lint
npm run test:critical-safety
npm run test:read-model
npm run test:domestic-cup:isolated
npm run test:european-safety
npm run test:redis-durability
npm run build
```

The Redis durability test uses a local Redis binary. Set `REDIS_SERVER_BIN` if `redis-server` is not on PATH.
