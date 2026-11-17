import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyStagingGate} from './verifyTgcloudStagingGate.mjs';

// IDs are public routing identifiers. Never commit a real CLI credential.
const staging='8533963416', production='8785073471';
const script=readFileSync('scripts/deployEflStaging8533963416.ps1','utf8');
const workflow=readFileSync('.github/workflows/tgcloud-staging-manual.yml','utf8');
test('staging script uses isolated staging identity and the existing secure deploy',()=>{
  assert.notEqual(staging,production);
  assert.match(script,/\$staging = '8533963416'/);
  assert.match(script,/\$production = '8785073471'/);
  assert.match(script,/deployEflStaging\.ps1/);
  assert.doesNotMatch(script,/\b(?:tgcloud\s+(?:push|migrate)|TGCLOUD_TOKEN\s*=|SECRET\s*=)/i);
});
test('staging workflow has fixed operator-approved app IDs and protected env secret',()=>{
  assert.match(workflow,/TGCLOUD_STAGING_APP_ID: '8533963416'/);
  assert.match(workflow,/TGCLOUD_PRODUCTION_APP_ID: '8785073471'/);
  assert.match(workflow,/environment: tgcloud-staging/);
  assert.match(workflow,/secrets\.TGCLOUD_STAGING_TOKEN/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s+push:\s*$/m,'Staging deploy remains manual-only');
});
test('test token passes, production token is always rejected without logging secrets',()=>{
  const env={
    TGCLOUD_STAGING_APP_ID:staging,
    TGCLOUD_PRODUCTION_APP_ID:production,
    CONFIRM_TGCLOUD_STAGING_DEPLOY:'DEPLOY_STAGING_ONLY',
    TGCLOUD_TOKEN:'app'+staging+':synthetic-not-a-real-token'
  };
  assert.equal(verifyStagingGate(env).ok,true);
  assert.throws(()=>verifyStagingGate({...env,TGCLOUD_TOKEN:'app'+production+':synthetic-not-a-real-token'}),/STAGING_TOKEN_APP_MISMATCH/);
  assert.throws(()=>verifyStagingGate({...env,TGCLOUD_PRODUCTION_APP_ID:staging}),/STAGING_EQUALS_PRODUCTION/);
  assert.throws(()=>verifyStagingGate({...env,CONFIRM_TGCLOUD_STAGING_DEPLOY:'DO_NOT_DEPLOY'}),/STAGING_CONFIRMATION_REQUIRED/);
});

test('staging workflow pins source and requires application-level import confirmation',()=>{
  assert.match(workflow,/ref: feat\/tgcloud-staging-8533963416-20261111/);
  assert.doesNotMatch(workflow,/inputs\.source_branch/);
  assert.ok(workflow.includes('verifyEflStagingImportReceipt.mjs'));
  assert.match(workflow,/STAGING_IMPORT_COMMAND_FAILED/);
  assert.ok(!workflow.includes("grep -Eq 'ok[[:space:]]"));
  assert.doesNotMatch(workflow,/tail -40 \/tmp\/tgcloud-import\.log/);
});

test('staging workflow uses immutable import packet identities without upsert',()=>{
  assert.match(workflow,/payload="\$\(cat -- "\$\{file\}"\)"/);
  assert.doesNotMatch(workflow,/stagingReplaceExisting\s*=\s*true/);
  assert.doesNotMatch(workflow,/packet\.batchId\s*=/);
  assert.doesNotMatch(workflow,/GITHUB_RUN_ID/);
  assert.ok(workflow.includes('verifyEflStagingImportReceipt.mjs'));
});

test('staging deploy enables independent readback and requires full parity',()=>{
  assert.match(workflow,/READBACK_CONTROL_TEMPLATE_NOT_FOUND/);
  assert.match(workflow,/verifyEflStagingTargetParity\.mjs/);
  assert.match(workflow,/STAGING_PARITY_COMPLETE_PRODUCTION_UNCHANGED/);
  assert.doesNotMatch(workflow,/tail -40 "\$log"/);
});
