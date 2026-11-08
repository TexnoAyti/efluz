import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStagingGate} from './verifyTgcloudStagingGate.mjs';

const good={TGCLOUD_TOKEN:'app123:staging-secret-example',
  TGCLOUD_STAGING_APP_ID:'123',TGCLOUD_PRODUCTION_APP_ID:'456',
  CONFIRM_TGCLOUD_STAGING_DEPLOY:'DEPLOY_STAGING_ONLY'};
test('only matching isolated staging credentials pass',()=>{
 assert.equal(verifyStagingGate(good).ok,true);
 for(const [delta,error] of [
  [{TGCLOUD_STAGING_APP_ID:'456'},/STAGING_EQUALS_PRODUCTION/],
  [{TGCLOUD_TOKEN:'app456:production-secret'},/STAGING_TOKEN_APP_MISMATCH/],
  [{TGCLOUD_TOKEN:''},/STAGING_TOKEN_UNAVAILABLE/],
  [{TGCLOUD_PRODUCTION_APP_ID:''},/APP_IDS_NOT_CONFIGURED/],
  [{CONFIRM_TGCLOUD_STAGING_DEPLOY:'DO_NOT_DEPLOY'},/STAGING_CONFIRMATION_REQUIRED/]
 ]){
  assert.throws(()=>verifyStagingGate({...good,...delta}),error);
 }
});

import {spawnSync} from 'node:child_process';
test('staging gate CLI actually executes and never logs credentials',()=>{
  const script=new URL('./verifyTgcloudStagingGate.mjs',import.meta.url).pathname;
  const safe=spawnSync(process.execPath,[script],{env:{...process.env,...good},encoding:'utf8'});
  assert.equal(safe.status,0,safe.stderr);
  assert.match(safe.stdout,/STAGING_GATE_OK/);
  assert.doesNotMatch(safe.stdout+safe.stderr,/staging-secret-example/);
  const dangerous=spawnSync(process.execPath,[script],{env:{...process.env,...good,
    TGCLOUD_TOKEN:'app456:production-secret-example'},encoding:'utf8'});
  assert.notEqual(dangerous.status,0);
  assert.match(dangerous.stderr,/STAGING_TOKEN_APP_MISMATCH/);
  assert.doesNotMatch(dangerous.stderr,/production-secret-example/);
});
