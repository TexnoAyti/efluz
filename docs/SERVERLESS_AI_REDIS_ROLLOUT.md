# EFLUZ serverless AI state offload

The existing Telegram AI webhook and model pipeline remain unchanged.

## Staged rollout

1. Confirm a single complete Upstash REST URL/token pair is available to the deployment. The existing `resolveRedisConfig()` supports the `UPSTASH_REDIS_KV_REST_API_URL` + `UPSTASH_REDIS_KV_REST_API_TOKEN` pair. Do not log their values.
2. On a **staging branch only**, set `EFL_AI_STATE_BACKEND=redis` and deploy. The existing PostgreSQL AI config is copied once into Redis with `enabled:false`; topic, scope and limits are retained. Pending conversations and admin confirmations are intentionally not copied. No automatic admin actions occur.
3. Verify `/api/telegram/status` reports `aiStateBackend:"redis"`, `redisAvailable:true`, and `aiEnabled:false`. Confirm that AI state writes are isolated from the PostgreSQL `telegram_ai_state` store. If Redis is unavailable, AI must remain disabled (fail closed).
4. Test the Telegram private admin `/ai_status`; check group topic binding and webhook. Only an authorized primary owner can turn it on with `/ai_on`.
5. Observe PostgreSQL RPC error/latency, Telegram webhook retry/error count, and Web App response times before considering production. In production, set the flag and redeploy **only after** preview and data-store tests pass. The owner must explicitly enable AI afterward.

## Scope and caveats

The flag offloads AI conversation state, rate counters, delivery deduplication, AI configs, topic-result proposal state and similar short-lived keys. The match/club read models in Supabase mode still consult PostgreSQL snapshots; this does not eliminate all database access. Avoid enabling at high volume until snapshot read paths are independently verified and appropriately cached. Redis must provide durable state and sufficient capacity, not in-process storage.

To roll back the transport, remove the flag and redeploy; AI then uses its previous PostgreSQL-backed state. Clear or disable AI before rolling back to avoid serving mismatched in-flight callback state. Never automatically interpret old admin confirmations after switching stores.
