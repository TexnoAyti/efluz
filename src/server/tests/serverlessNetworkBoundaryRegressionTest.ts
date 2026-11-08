import assert from 'node:assert/strict';
import {isAllowedServerlessSdkRequest,shouldRejectLegacyApiRequest}
  from '../../lib/serverlessNetworkBoundary';

const origin='https://app123456.tgcloud.ai/';
const native='/api/bootstrap';
assert.equal(isAllowedServerlessSdkRequest(native,origin,'POST'),true);
assert.equal(shouldRejectLegacyApiRequest(native,origin,'POST'),false,
 'Official Telegram WebApp SDK POST must not be blocked');
assert.equal(shouldRejectLegacyApiRequest('/api/myFixtures',origin,'POST'),false);
for(const [url,base,method] of [
  ['/api/bootstrap',origin,'GET'],
  ['/api/bootstrap','https://efluz.vercel.app/','POST'],
  ['https://efluz.vercel.app/api/bootstrap',origin,'POST'],
  ['https://app654321.tgcloud.ai/api/bootstrap',origin,'POST'],
  ['//efluz.vercel.app/api/bootstrap',origin,'POST'],
  ['/api/bootstrap?token=leak',origin,'POST'],
  ['/api/bootstrap#fragment',origin,'POST'],
  ['/api/../api/bootstrap',origin,'GET'],
  ['/api/bootstrap/extra',origin,'POST'],
  ['/api',origin,'POST'],
  ['/api/bootstrap','http://app123456.tgcloud.ai/','POST'],
  ['/api/bootstrap','https://custom.example.com/','POST'],
  ['/api/bootstrap','https://app0.tgcloud.ai/','POST']
]){
  assert.equal(isAllowedServerlessSdkRequest(url,base,method),false,
    'Legacy HTTP must not escape SDK boundary');
  assert.equal(shouldRejectLegacyApiRequest(url,base,method),true,
    'Legacy route should be blocked');
}
assert.equal(shouldRejectLegacyApiRequest('/assets/main.js',origin,'GET'),false);
assert.equal(shouldRejectLegacyApiRequest('https://cdn.example.org/style.css',origin,'GET'),false);
console.log('PASS_SERVERLESS_NATIVE_SDK_HTTP_GATE: trusted same-origin POST works, Vercel and unsafe routes blocked');
