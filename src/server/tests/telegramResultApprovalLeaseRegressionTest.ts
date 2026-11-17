import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { initDatabase } from '../db';
import { getTopicResultStateClient } from '../services/telegramAiDeadline';
import { releaseRejectedTopicResultLease, isDefinitiveTopicResultRejection, TOPIC_RESULT_RELEASE } from '../services/telegramTopicResults';

process.env.DATABASE_PROVIDER = 'supabase';
process.env.SUPABASE_DATA_NAMESPACE = 'preview';
await initDatabase();
const client = getTopicResultStateClient();
assert.ok(client);
const prefix = 'efluz:v1:telegram:topic-result:';
const token = () => randomBytes(12).toString('hex');
const lease = (fixtureId:string) => prefix+'fixture:'+fixtureId;
const proposal = (tokenId:string) => prefix+'proposal:'+tokenId;
const fixtureId = 'lease-regression-'+token();

assert.equal(isDefinitiveTopicResultRejection(400),true);
assert.equal(isDefinitiveTopicResultRejection(403),true);
assert.equal(isDefinitiveTopicResultRejection(422),true);
assert.equal(isDefinitiveTopicResultRejection(500),false);
assert.equal(isDefinitiveTopicResultRejection(409),false);

// Legacy production bug: a failed 400 validation was persisted as DONE,
// but the lock remained and blocked every new approval for 24 hours.
const previous = token();
await client!.set(lease(fixtureId), previous, {ex:3600});
await client!.set(proposal(previous), {token:previous,state:'done',receipt:{status:400}}, {ex:3600});
assert.equal(await releaseRejectedTopicResultLease(client!,lease(fixtureId)),true);
assert.equal(await client!.get(lease(fixtureId)),null);

// Successful results are not retried, even if a stale fixture snapshot would
// still display an unused confirmation button.
const successful = token();
await client!.set(lease(fixtureId),successful,{ex:3600});
await client!.set(proposal(successful),{token:successful,state:'done',receipt:{status:200}},{ex:3600});
assert.equal(await releaseRejectedTopicResultLease(client!,lease(fixtureId)),false);
assert.equal(await client!.get(lease(fixtureId)),successful);
await client!.eval(TOPIC_RESULT_RELEASE,[lease(fixtureId)],[successful]);

// Unknown commit results and 5xx failures must keep their lease:
const unknown=token();
await client!.set(lease(fixtureId),unknown,{ex:3600});
await client!.set(proposal(unknown),{token:unknown,state:'unknown'},{ex:3600});
assert.equal(await releaseRejectedTopicResultLease(client!,lease(fixtureId)),false);
assert.equal(await client!.get(lease(fixtureId)),unknown);
await client!.eval(TOPIC_RESULT_RELEASE,[lease(fixtureId)],[unknown]);

const serverFailure=token();
await client!.set(lease(fixtureId),serverFailure,{ex:3600});
await client!.set(proposal(serverFailure),{token:serverFailure,state:'done',receipt:{status:500}},{ex:3600});
assert.equal(await releaseRejectedTopicResultLease(client!,lease(fixtureId)),false);
assert.equal(await client!.get(lease(fixtureId)),serverFailure);
await client!.eval(TOPIC_RESULT_RELEASE,[lease(fixtureId)],[serverFailure]);

// State without proof of a definitive failed write is never released.
const missingProof=token();
await client!.set(lease(fixtureId),missingProof,{ex:3600});
await client!.set(proposal(missingProof),{token:missingProof,state:'done'},{ex:3600});
assert.equal(await releaseRejectedTopicResultLease(client!,lease(fixtureId)),false);
assert.equal(await client!.get(lease(fixtureId)),missingProof);
await client!.eval(TOPIC_RESULT_RELEASE,[lease(fixtureId)],[missingProof]);
console.log('PASS Telegram result approval: failed 400 leases recover; successful/unknown/5xx approvals remain protected');
