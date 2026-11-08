#!/usr/bin/env bash
# Read-only, point-in-time source export. Requires PostgreSQL psql.
# Uses the credentials supplied by the operator; never logs their value.
set -euo pipefail
umask 077
: "${EFL_SOURCE_DATABASE_URL:?Set EFL_SOURCE_DATABASE_URL to a read-only PostgreSQL connection URL}"
output="${1:?Usage: scripts/exportEflSupabaseRuntime.sh private-output.jsonl}"
if [[ -e "$output" ]]; then
  echo "Refusing to overwrite an existing snapshot." >&2
  exit 2
fi
mkdir -p -- "$(dirname -- "$output")"
tmp="${output}.partial.$$"
trap 'rm -f -- "$tmp"' EXIT
# All data is obtained in one consistent PostgreSQL statement snapshot.
# Never export preview and production into the same live cutover snapshot.
PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=180000" \
  psql "$EFL_SOURCE_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT jsonb_build_object(
    'space',space,
    'collection_path',collection_path,
    'document_id',document_id,
    'encoded',encoded,
    'data',data
  )::text
  FROM efl_runtime.documents
  WHERE space='production'
  ORDER BY collection_path,document_id" > "$tmp"
[[ -s "$tmp" ]] || { echo "Empty source export. Aborted." >&2; exit 1; }
# The observed inventory is a moving baseline, NOT a frozen snapshot: live
# production continues changing. Always reject new unclassified collections,
# invalid identity and duplicate documents. A strict baseline comparison is an
# optional explicit freeze-time check, never the default export requirement.
# Reviewed collections still need resolution before raw archive/import.
inventory_flags=()
if [[ "${EFL_REQUIRE_OBSERVED_COUNTS:-0}" == "1" ]]; then
  inventory_flags+=(--require-observed-counts)
fi
node "$(dirname "$0")/auditEflSourceInventory.mjs" "$tmp" "${inventory_flags[@]}"
# This is only a source snapshot. Do not infer import or cutover readiness.
mv -- "$tmp" "$output"
trap - EXIT
printf 'Read-only source snapshot saved to %s. Keep this private.\n' "$output"
