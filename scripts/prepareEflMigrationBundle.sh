#!/usr/bin/env bash
# Offline source -> verified private shadow import bundle. NEVER deploys or modifies production.
set -euo pipefail
umask 077
if [[ $# -ne 2 ]]; then
  echo 'Usage: bash scripts/prepareEflMigrationBundle.sh private-production.jsonl private-new-output-dir' >&2
  exit 2
fi
source_file="$(realpath -e -- "$1")"
output="$2"
[[ -f "$source_file" && -s "$source_file" ]] || { echo 'Source is missing or empty.' >&2; exit 2; }
[[ ! -e "$output" ]] || { echo 'Output already exists; refusing overwrite.' >&2; exit 2; }
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null || { echo 'Node.js is required.' >&2; exit 2; }
mkdir -p -- "$(dirname -- "$output")"
output_parent="$(cd -- "$(dirname -- "$output")" && pwd)"
output_name="$(basename -- "$output")"
[[ "$output_name" != '.' && "$output_name" != '..' ]] || exit 2
output_abs="$output_parent/$output_name"
[[ "$source_file" != "$output_abs" ]] || { echo 'Output cannot be source.' >&2; exit 2; }
staging="$(mktemp -d "$output_parent/.efl-migration.XXXXXXXX")"
chmod 700 "$staging"
finish() {
  if [[ -n "${staging:-}" && -d "$staging" ]]; then
    rm -rf -- "$staging"
  fi
}
trap finish EXIT
printf 'Step 1/5: validating authorized source inventory\n'
node "$script_dir/auditEflSourceInventory.mjs" "$source_file" > "$staging/inventory-report.json"
printf 'Step 2/5: generating protected raw archive and review quarantine\n'
node "$script_dir/prepareEflRawDocumentBatches.mjs" "$source_file" "$staging/private-archive" > "$staging/archive-report.json"
printf 'Step 3/5: projecting normalized shadow tables\n'
node "$script_dir/convertEflCoreSnapshot.mjs" "$source_file" "$staging/normalized-source.json" --require-complete-source --verified-archive "$staging/private-archive" > "$staging/conversion-report.json"
printf 'Step 4/5: verifying deterministic source binding\n'
node "$script_dir/verifyEflNormalizedSourceBinding.mjs" "$source_file" "$staging/private-archive" "$staging/normalized-source.json" > "$staging/binding-report.json"
printf 'Step 5/5: preparing staging-only normalized import packets\n'
node "$script_dir/prepareServerlessImport.mjs" "$staging/normalized-source.json" "$staging/normalized-import" > "$staging/packet-report.txt"
node "$script_dir/verifyEflNormalizedPackets.mjs" "$staging/normalized-source.json" "$staging/normalized-import" > "$staging/packet-verify-report.json"
node "$script_dir/verifyEflRawBatches.mjs" "$staging/private-archive" > "$staging/raw-verify-report.json"
node --input-type=module - "$staging" <<'NODE'
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const dir=process.argv[2];
const load=async path=>JSON.parse(await readFile(join(dir,path),'utf8'));
const inventory=await load('inventory-report.json');
const archive=await load('private-archive/manifest.json');
const binding=await load('binding-report.json');
const packets=await load('normalized-import/manifest.json');
if(!inventory.ok||binding.sourceBound!==true||!archive.count||!packets.tables ||
   inventory.total!==archive.sourceDocuments){throw Error('BUNDLE_VALIDATION_FAILED');}
const source=await readFile(join(dir,'normalized-source.json'));
const counts=Object.fromEntries(Object.entries(packets.tables).map(([key,value])=>[key,value.count]));
const summary={kind:'EFLUZ_PRIVATE_STAGING_BUNDLE',version:1,productionMigrated:false,
  cutoverReady:false,sourceDocuments:inventory.total,reviewCollections:inventory.reviewCollections.map(x=>x.collection),
  quarantinedReviewDocuments:archive.reviewExcluded,excludedTransientDocuments:archive.rebuildExcluded,
  preservedRawDocuments:archive.count,normalizedSha256:createHash('sha256').update(source).digest('hex'),
  normalizedTableCounts:counts,
  next:'Staging import, independent readback and Telegram end-to-end parity are still required.'};
await writeFile(join(dir,'bundle-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
NODE
[[ ! -e "$output_abs" ]] || { echo 'Destination appeared during preparation; refusing overwrite.' >&2; exit 2; }
mv -T -- "$staging" "$output_abs"
staging=''
printf 'PRIVATE_STAGING_BUNDLE_READY: %s (NOT DEPLOYED; production unchanged)\n' "$output_abs"
