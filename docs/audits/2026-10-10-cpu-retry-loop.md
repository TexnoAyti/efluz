# CPU alert: legacy PostgREST conflict retry loop

At 16:11:44 UTC the request-configuration statement had 127,611,525 calls; at 16:12:28 it had 127,695,086: approximately 1,900 calls/second, while successful document reads remained unchanged at 28,967. Active/aborted PostgREST 14.18 sessions repeatedly executed the legacy `efl_runtime_commit` RPC. Only 139 edge requests were logged in the sampled 22-minute window, all HTTP 200. The counters measure request-configuration executions, not user requests or CPU percentage.

Supabase documents the PostgREST 14 infinite retry bug for custom SQLSTATE 40001 errors: https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b

The deployed application already used `efl_runtime_commit_safe`, which catches serialization failures. Older requests continued to reach the legacy RPC. The approved live migration changes the legacy application generation-conflict code to PT409 and lets the safe RPC convert PT409 or genuine serialization failures to `{conflict:true}`. It preserves the CAS checks, atomic writes, invoker security and private grants. Existing historical migrations are unchanged; bootstrap SQL and the native SQL regression are updated.

After applying the migration, the configuration counter was 128,083,752 at both 16:16:28 and 16:17:10 UTC. Legacy RPC sessions: zero. No backend termination or project restart was needed. Native PostgreSQL tests verify PT409 on stale legacy calls, safe conflict responses, unchanged state on conflict, private grants, concurrent retries and existing atomic ownership/counter/queue behavior. Live health remained PostgreSQL-connected, not offline, with the circuit closed.

The earlier full-document consistency audits also consumed several seconds per execution and contributed transient load. They are administrative checks, not an application polling loop, and will not be repeated as routine CPU monitoring. The dashboard CPU percentage and alert-clear state have not been retrieved; stopping the measured retry storm is confirmed.
