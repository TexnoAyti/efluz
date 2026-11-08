# EFLUZ — Telegram Serverless isolated staging deployment

**Status: staged code only, not deployed.** This runbook is intentionally
not a replacement for the production cutover and does not migrate production
data. Never enter bot tokens into ChatGPT, GitHub commits, CI logs, URLs or
frontend environment variables.

## Prerequisites

- A **separate Telegram test bot** with its own Telegram Serverless app.
  Its login credentials must not belong to the currently active EFLUZ bot.
- A Telegram Serverless app ID for the staging bot; if the active production
  bot has a Serverless app ID, record it separately for the inequality gate.
- GitHub repository **environment** `tgcloud-staging` configured with
  required reviewers where available.
- Environment secret `TGCLOUD_STAGING_TOKEN` holding the **staging**
  Serverless CLI token. Do not create a shared `TGCLOUD_TOKEN` repository
  secret; it is injected only for the gated deployment job.
- Environment variables `TGCLOUD_STAGING_APP_ID` and
  `TGCLOUD_PRODUCTION_APP_ID`, matching the public `app<id>` prefixes
  of their respective Serverless apps. They **must be different**. If the
  production app does not have an ID, do not guess a replacement; this
  runbook cannot safely execute the workflow until the isolation check is
  adjusted to another verified production identity.

## What has already been prepared

- CI checks SQL migrations, stable imports, read-only bot command and callback
  permissions, admin overview, and the isolated, read-only Telegram SDK smoke Mini App build.
- The `tgcloud/handlers` routes only support a **limited read-only**
  staging command set and are not production parity-complete.
- Result, club claim and confirmation endpoints have
  `MUTATION_CONTROL.enabled=false` by design.
- The raw-document importer is also disabled by default.
- The production webhook remains on the legacy backend; **do not change it**.

## Manual deployment path

1. Verify that the source branch is reviewed and staging credentials belong
   to a **different bot**. Deploy workflows that are not yet on the default
   branch may need to be made available in GitHub Actions through a reviewed
   workflow addition; never merge an unfinished Serverless implementation
   into production merely to enable a workflow.
2. Run GitHub Actions workflow `Telegram Serverless staging deploy
   (manual only)` with confirmation `DEPLOY_STAGING_ONLY`. It validates
   token identity **before** building or communicating with Telegram.
3. The workflow performs `tgcloud push`, `tgcloud migrate --dry-run`,
   and `tgcloud migrate --safe` for the staging bot only. Inspect its logs and stop at any failure;
   no automatic retry with production credentials is allowed.
4. Open the staging Mini App URL reported by the CLI through the *staging*
   bot and test signed user identity, `/start`, `/myclub`, the read-only
   callbacks, `health` and `bootstrap`. The hosted staging page is intentionally
   limited; it must **not** present the legacy React app as migrated.
5. Import only a privacy-protected staging snapshot when the authorized
   importer has been reviewed and deliberately enabled for this staging
   bot. Check row counts, SHA-256 checksums, missing references, duplicates,
   ownership and permissions against the original source.

## Production cutover gates

Do not switch production until all of the following are true:

- Every EFLUZ domain and bot update is migrated (including TEAMS, UZEFLIFE,
  ticket/payments, admin operations, season admissions, all cups, notifications,
  moderation and AI), and test users can exercise complete workflows.
- All legacy source fields are converted without loss; production snapshot
  totals and hashes match the isolated Serverless target independently.
- Host-specific errors, partial batches, duplicate Telegram updates, payment
  retries, idempotency, score disputes, ownership races and scheduled jobs are
  tested under actual Telegram Serverless.
- Backups, rollback/previous webhook and downtime-free transfer order are
  documented and tested, with an explicit operator-controlled write freeze.
- The end-to-end authenticated Mini App no longer depends on Vercel endpoints.

**Passing CI and creating a staging bot are not proof of a fully migrated
production system.** See `SERVERLESS_CUTOVER_GATES.md` for the blockers.

The existing React web UI is **not** deployed to staging while it still
calls Vercel. The `tgcloud-staging/` front-end is an isolated, read-only
smoke UI. Its build is checked to exclude server bundles and legacy API calls.
