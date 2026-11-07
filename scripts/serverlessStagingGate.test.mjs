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
