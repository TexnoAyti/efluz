#!/usr/bin/env bash
set -Eeuo pipefail

# Work Mode/Linux equivalent of deployEflStaging8533963416.ps1.
# The token is read silently and is never written to stdout, Git, or logs.
staging_app_id='8533963416'
production_app_id='8785073471'
if [[ "$staging_app_id" == "$production_app_id" ]]; then
  echo 'STAGING_EQUALS_PRODUCTION' >&2
  exit 1
fi

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"
command -v node >/dev/null || { echo 'NODE_REQUIRED' >&2; exit 1; }
command -v npm >/dev/null || { echo 'NPM_REQUIRED' >&2; exit 1; }

if [[ -z "${TGCLOUD_TOKEN:-}" ]]; then
  printf 'Staging CLI token (app%s, hidden): ' "$staging_app_id" >&2
  IFS= read -r -s TGCLOUD_TOKEN
  printf '\n' >&2
fi
if [[ ! "$TGCLOUD_TOKEN" =~ ^app${staging_app_id}:[^[:space:]]{10,}$ ]]; then
  unset TGCLOUD_TOKEN
  echo 'INVALID_STAGING_APP_TOKEN' >&2
  exit 1
fi

export TGCLOUD_TOKEN
export TGCLOUD_STAGING_APP_ID="$staging_app_id"
export TGCLOUD_PRODUCTION_APP_ID="$production_app_id"
export CONFIRM_TGCLOUD_STAGING_DEPLOY='DEPLOY_STAGING_ONLY'
trap 'unset TGCLOUD_TOKEN TGCLOUD_STAGING_APP_ID TGCLOUD_PRODUCTION_APP_ID CONFIRM_TGCLOUD_STAGING_DEPLOY' EXIT

node scripts/verifyTgcloudStagingGate.mjs
node scripts/checkTgcloudModules.mjs
npm run build:tgcloud
node scripts/verifyTgcloudStatic.mjs
npx --yes --package=@tgcloud/cli tgcloud push
npx --yes --package=@tgcloud/cli tgcloud migrate --dry-run
npx --yes --package=@tgcloud/cli tgcloud migrate --safe
echo 'STAGING_CODE_DEPLOYED_ONLY'
