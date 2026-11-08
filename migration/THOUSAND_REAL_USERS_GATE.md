# EFLUZ / Telegram Serverless — 1,000 concurrent user gate

**This is a deployment blocker, not a claim of capacity.** Existing synthetic
migration unit tests cannot demonstrate that 1,000 simultaneous users can
open the actual Mini App. Never switch production based on this harness alone.

## Source of truth

- Intended service: a **separate and explicitly authorized Telegram
  Serverless staging deployment**. Production EFLUZ, bot webhooks and the
  existing Supabase database must remain untouched.
- The runner targets only a URL matching `EFL_TGCLOUD_STAGING_ORIGIN` exactly.
  Set `EFL_TGCLOUD_PRODUCTION_ORIGIN` to the known production host so it is
  rejected. `--local-smoke` is restricted to a loopback HTTP server.
- To simulate independent authenticated EFL users rather than 1,000 requests
  from one shared login, prepare exactly **1,000 distinct, isolated staging
  identities**. No production accounts, secrets or Telegram initData should
  be used. Secrets must never be checked into GitHub or uploaded as CI
  artifacts.
- Staging test users must not trigger real notifications, payment activity or
  production data changes. A separate staging dataset is mandatory.

## Private inputs

Save this **sample structure**, with staging-only credentials, in a
0600-permission, gitignored local file named `private-staging-auth.json`:

```json
{
  "users": [
    {"id": "stage-user-1", "headers": {"Authorization": "Bearer <staging-test-token-1>"}},
    {"id": "stage-user-2", "headers": {"Authorization": "Bearer <staging-test-token-2>"}}
  ]
}
```

For the 1,000-user acceptance run, use 1,000 distinct entries. These are only
sample placeholders, not actual tokens. The runner never prints IDs/tokens.

Create `private-staging-scenario.json` using **actual GET routes of the
deployed staging app**, after verifying them manually. The following are
illustrations only; Telegram SDK endpoint RPCs may not expose these paths as
HTTP GET and therefore must not be assumed to work:

```json
{
  "routes": [
    {"path": "/leagues", "weight": 40},
    {"path": "/standings", "weight": 30},
    {"path": "/fixtures", "weight": 20},
    {"path": "/profile", "weight": 10}
  ],
  "thinkMs": 400,
  "requestTimeoutMs": 5000,
  "thresholds": {"successRate": 0.999, "p95Ms": 500}
}
```

This initial runner performs authenticated GET requests only. SDK-specific
authenticated RPC calls, result writes, bot update handling and Mini App
rendering require separate scenario adapters or end-to-end tests. A 100%
successful run against placeholder/static routes is **not proof** of full
EFLUZ readiness.

## Command

Run from an authorized, isolated staging environment; never from CI against
the live bot:

```sh
export EFL_TGCLOUD_STAGING_ORIGIN="https://YOUR-STAGING-HOST"
export EFL_TGCLOUD_PRODUCTION_ORIGIN="https://YOUR-PRODUCTION-HOST"

node scripts/loadEflServerlessStaging.mjs \
  --origin="$EFL_TGCLOUD_STAGING_ORIGIN" \
  --scenario=private-staging-scenario.json \
  --identities=private-staging-auth.json \
  --users=1000 \
  --duration-sec=3600 \
  --confirm-staging=I_AUTHORIZE_STAGING_LOAD \
  --output=private-staging-load-report.json
```

The local CI smoke exercises real localhost HTTP only. It is intentionally
marked `loadGatePassed:false`. The 60-minute staging acceptance requires
all of these:

1. 1,000 **unique authenticated test identities**, with overlapping
   activity (not 1,000 sequential requests).
2. 60 minutes of sustained traffic, with mixed league, fixtures, profile
   and standings scenarios, **including actual SDK endpoint adapters**.
3. Read requests p95 under 500 ms, success rate at least 99.9%, with
   explicit tracking of 429, 5xx, network errors and timeouts.
4. Independent browser E2E: time to usable page, image/logo loads, freezes,
   memory, reconnection and dark-mode checks on mobile Telegram.
5. Independent correctness verification: concurrent club claims, duplicate
   result submissions, opponent confirmations, notification outbox and
   admin round transitions; no lost writes or duplicate effects.
6. Source/target hash parity, complete historical collection decisions,
   full function parity and a proven rollback path before production cutover.

## What the report actually proves

`virtualUsers` describes concurrent **client loops**, not physically
distinct human users. `maxInflight` is the maximum overlapping HTTP calls.
`loadGatePassed` only checks the quantitative HTTP acceptance condition
with 1,000 distinct staging auth contexts over at least 60 minutes.
`cutoverReady` intentionally remains false; remaining migration checks
cannot be inferred from one HTTP benchmark.

There are no staging credentials or verified staging endpoint URLs committed
to this repository. Real load test results remain **unavailable** until
that environment and its isolated identities are provided.
