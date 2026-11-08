import assert from 'node:assert/strict';
import {mapEflReadRequest,normalizeEflReadResponse} from '../../lib/serverlessRequestGateway';

// No network, no production database, no Telegram credentials.
assert.deepEqual(mapEflReadRequest('/api/competitions?seasonId=season-2026-27'),{
 operation:'competitions',input:{seasonId:'season-2026-27',limit:100},shape:'competitions'
});
assert.deepEqual(mapEflReadRequest('/api/me/matches?seasonId=season-2026-27'),{
 operation:'myFixtures',input:{seasonId:'season-2026-27',limit:100},shape:'fixtures'
});
assert.deepEqual((normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:true,competitions:[]}) as {competitions:unknown[]}).competitions,[]);
const bracket=mapEflReadRequest('/api/competitions/comp-fa-cup-2026/fixtures?seasonId=season-2026-27');
assert.deepEqual(bracket,{operation:'competitionDetail',input:{
  competitionId:'comp-fa-cup-2026',seasonId:'season-2026-27',limit:100
},shape:'competitionFixtures'});
const fixtureResult=normalizeEflReadResponse(bracket,{
  ok:true,competition:{id:'comp-fa-cup-2026'},
  fixtures:[{id:'fixture-one',round:1,status:'SCHEDULED',homeClubId:'a',awayClubId:'b'}]
}) as {fixtures:Array<{matchday:number}>};
assert.equal(fixtureResult.fixtures[0].matchday,1);
assert.throws(()=>normalizeEflReadResponse(bracket,{ok:true,competition:{},fixtures:[{id:'x',status:'SCHEDULED',round:'bad'}]}),/SERVERLESS_FIXTURE_ROUND_INVALID/);

for(const [endpoint,method,code] of [
 ['/api/admin/fixtures/x/result','POST','SERVERLESS_WRITE_NOT_MIGRATED'],
 ['/api/auth/telegram','POST','SERVERLESS_WRITE_NOT_MIGRATED'],
 ['/api/admin/overview','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['/api/competitions/cup/fixtures?matchday=1','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['/api/me/matches?status=CONFIRMED','GET','SERVERLESS_ROUTE_NOT_MIGRATED'],
 ['https://efluz.vercel.app/api/me','GET','SERVERLESS_RELATIVE_API_ONLY'],
 ['/api/competitions?seasonId=invalid','GET','SERVERLESS_INVALID_SEASON'],
] as const)assert.throws(()=>mapEflReadRequest(endpoint,method),new RegExp(code));
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:false,error:'FAILED'}),/SERVERLESS_RESPONSE_UNVERIFIED/);
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/competitions'),{ok:true,competitions:{}}),/SERVERLESS_RESPONSE_CONTRACT_MISMATCH/);
assert.throws(()=>normalizeEflReadResponse(mapEflReadRequest('/api/health'),{ok:true,service:'untrusted'}),/SERVERLESS_WRONG_SERVICE/);
console.log('PASS_SERVERLESS_GATEWAY: supported reads, guarded contracts, writes/legacy routes denied');
