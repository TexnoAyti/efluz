import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { initDatabase } from '../db';
import { getTopicResultStateClient } from '../services/telegramAiDeadline';
import { releaseRejectedTopicResultLease, isDefinitiveTopicResultRejection, TOPIC_RESULT_RELEASE, TOPIC_RESULT_REBASE, TOPIC_RESULT_CLAIM, safeFixtureSnapshotForTopicRetry } from '../services/telegramTopicResults';

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
// Live regression: the original button had 409 because its expected fixture
// was SCHEDULED, while current fixture had become PENDING_CONFIRMATION.
const current={id:fixtureId,competitionId:'comp-uzbekistan-superliga-2027',seasonId:'season-2027-28',
  homeClubId:'club-neftchi',awayClubId:'club-navbahor',status:'PENDING_CONFIRMATION',updatedAt:'v2',
  homeScore:null,awayScore:null};
const original={...current,status:'SCHEDULED',updatedAt:'v1'};
const token409=token(), sourceKey=prefix+'source:123:11972:456';
const plan:any={action:'result_edit',targetId:fixtureId,body:{homeScore:4,awayScore:0,expectedFixture:{
  seasonId:original.seasonId,competitionId:original.competitionId,homeClubId:original.homeClubId,
  awayClubId:original.awayClubId,status:original.status,updatedAt:original.updatedAt
}}};
const fresh=safeFixtureSnapshotForTopicRetry(plan,current);
assert.equal(fresh?.status,'PENDING_CONFIRMATION');
assert.equal(safeFixtureSnapshotForTopicRetry(plan,{...current,status:'CONFIRMED',homeScore:4,awayScore:0}),null);
assert.equal(safeFixtureSnapshotForTopicRetry(plan,{...current,homeClubId:'different'}),null);
assert.equal(safeFixtureSnapshotForTopicRetry(plan,{...current,awayScore:2}),null);
const proposal409={token:token409,plan,state:'done',receipt:{status:409},chat:123,thread:11972,
  sourceMessage:456,deliveredMessage:789,expiresAt:Date.now()+600000};
await client!.set(proposal(token409),proposal409,{ex:600});
await client!.set(sourceKey,{token:token409,updateId:100},{ex:600});
await client!.set(lease(fixtureId),token409,{ex:600});
assert.equal(await client!.eval(TOPIC_RESULT_REBASE,[proposal(token409),sourceKey,lease(fixtureId)],
  [token409,JSON.stringify(fresh),Date.now(),600]),1);
assert.equal(await client!.get(lease(fixtureId)),null);
const ready=await client!.get<any>(proposal(token409));
assert.equal(ready.state,'pending');
assert.equal(ready.plan.body.expectedFixture.status,'PENDING_CONFIRMATION');
assert.equal(ready.plan.body.expectedFixture.updatedAt,'v2');
assert.equal(await client!.eval(TOPIC_RESULT_CLAIM,
  [proposal(token409),lease(fixtureId),sourceKey,sourceKey],
  [Date.now(),123,11972,789,'executing',600]),1);
assert.equal(await client!.eval(TOPIC_RESULT_CLAIM,
  [proposal(token409),lease(fixtureId),sourceKey,sourceKey],
  [Date.now(),123,11972,789,'executing',600]),0);
await client!.eval(TOPIC_RESULT_RELEASE,[lease(fixtureId)],[token409]);
const success409=token();
await client!.set(proposal(success409),{...proposal409,token:success409,state:'done',receipt:{status:200}},{ex:600});
await client!.set(sourceKey,{token:success409,updateId:101},{ex:600});
await client!.set(lease(fixtureId),success409,{ex:600});
assert.equal(await client!.eval(TOPIC_RESULT_REBASE,[proposal(success409),sourceKey,lease(fixtureId)],
  [success409,JSON.stringify(fresh),Date.now(),600]),0,'Never replay a saved fixture');
assert.equal(await client!.get(lease(fixtureId)),success409);
await client!.eval(TOPIC_RESULT_RELEASE,[lease(fixtureId)],[success409]);
const outdated=token();
await client!.set(proposal(outdated),{...proposal409,token:outdated},{ex:600});
assert.equal(await client!.eval(TOPIC_RESULT_REBASE,[proposal(outdated),sourceKey,lease(fixtureId)],
  [outdated,JSON.stringify(fresh),Date.now(),600]),0,'Superseded button cannot be revived');
console.log('PASS 409 confirmation recovery: live fixture CAS rebase, same-button claim, no duplicate writes, no saved-score replays');
console.log('PASS Telegram result approval: failed 400 leases recover; successful/unknown/5xx approvals remain protected');
