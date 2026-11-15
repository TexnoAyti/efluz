# EFLUZ serverless AI state offload

The existing Telegram AI webhook and model pipeline remain unchanged.

## Staged rollout

1. Confirm a single complete Upstash REST URL/token pair is available to the deployment. The existing `resolveRedisConfig()` supports the `UPSTASH_REDIS_KV_REST_API_URL` + `UPSTASH_REDIS_KV_REST_API_TOKEN` pair. Do not log their values.
2. On a **staging branch only**, set `EFL_AI_STATE_BACKEND=redis` and a unique `EFL_AI_STATE_NAMESPACE` (e.g. `staging-8533963416`), then deploy. The existing PostgreSQL AI config is copied once into namespaced Redis, with staging `enabled:false`; topic, scope and limits are retained. Pending AI conversations and admin confirmations are intentionally not copied. No automatic admin actions occur.
3. Verify `/api/telegram/status` reports `aiStateBackend:"redis"`, `redisAvailable:true`, and `aiEnabled:false` in staging. Verify that preview and production have different namespaces and that no keys cross environments. If Redis is unavailable, AI must remain disabled (fail closed).
4. Test the Telegram private admin `/ai_status`; check group topic binding and webhook. Only an authorized primary owner can turn it on with `/ai_on`.
5. Observe PostgreSQL RPC error/latency, Telegram webhook retry/error count, and Web App response times before considering production. In production, set `EFL_AI_STATE_NAMESPACE=production-8785073471` and enable the flag only after staging checks pass. Production migration preserves an already enabled AI only when a valid Telegram group/topic binding is present. The owner may still use `/ai_on` or `/ai_off`.

## Scope and caveats

The flag offloads AI conversation state, rate counters, delivery deduplication, AI config and similar short-lived keys. **Match-result proposal state remains on the old durable transport**, so current score confirmations are not invalidated. The match/club read models in Supabase mode still consult PostgreSQL snapshots; this does not eliminate all database access. Avoid enabling at high volume until snapshot read paths are independently verified and appropriately cached. Redis must provide durable state and sufficient capacity, not in-process storage.

To roll back the transport, remove the flag and redeploy; AI then uses its previous PostgreSQL-backed state. Clear or disable AI before rolling back to avoid serving mismatched in-flight callback state. Never automatically interpret old admin confirmations after switching stores.
