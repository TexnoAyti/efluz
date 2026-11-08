import assert from 'node:assert/strict';
import {mapEflReadRequest,normalizeEflReadResponse} from '../../lib/serverlessRequestGateway';

// No network, no production database, no Telegram credentials.
assert.deepEqual(mapEflReadRequest('/api/competitions?seasonId=season-2026-27'),{
 operation:'competitions',input:{seasonId:'season-2026-27',limit:100},shape:'competitions'
});
assert.deepEqual(mapEflReadRequest('/api/me/matches?seasonId=season-2026-27'),{
 operation:'myFixtures',input:{seasonId:'season-2026-27',limit:100},shape:'fixtures'
});
assert.equal(normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:true,competitions:[]}).competitions.length,0);
for(const [endpoint,method,code] of [
 ['/api/admin/fixtures/x/result','POST','SERVERLESS_WRITE_NOT_MIGRATED'],
 ['/api/auth/telegram','POST','SERVERLESS_WRITE_NOT_MIGRATED'],
 ['/api/admin/overview','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['/api/competitions/cup/fixtures','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['/api/me/matches?status=CONFIRMED','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['https://efluz.vercel.app/api/me','GET','SERVERLESS_RELATIVE_API_ONLY'],
 ['/api/competitions?seasonId=invalid','GET','SERVERLESS_INVALID_SEASON'],
] as const)assert.throws(()=>mapEflReadRequest(endpoint,method),new RegExp(code));
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:false,error:'FAILED'}),/SERVERLESS_RESPONSE_UNVERIFIED/);
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:true,competitions:{}}),/SERVERLESS_RESPONSE_CONTRACT_MISMATCH/);
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/health'),{ok:true,service:'untrusted'}),/SERVERLESS_WRONG_SERVICE/);
console.log('PASS_SERVERLESS_GATEWAY: supported reads, guarded contracts, writes/legacy routes denied');
