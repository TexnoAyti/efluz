import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {confirmFixtureResultWithOutbox} from '../../../tgcloud/lib/confirmResultWithOutbox.js';
import {MUTATION_CONTROL} from '../../../tgcloud/lib/mutationControl.js';

// These are offline checks only; they must not imply that the Telegram SDK
// supports transactional multi-table commits until verified in real staging.
assert.equal(MUTATION_CONTROL.enabled,false);
assert.equal(MUTATION_CONTROL.resultConfirmationTransactionsVerified,false);
let writes=0;
const unsafeDb={
  async run(){writes++;throw Error('UNSAFE_WRITE');},
  async get(){throw Error('UNSAFE_READ');},
  async all(){throw Error('UNSAFE_READ');},
};
await assert.rejects(
 confirmFixtureResultWithOutbox(unsafeDb,'user-home',{submissionId:'sub-1'},undefined),
 /RESULT_OUTBOX_TRANSACTION_REQUIRED/
);
assert.equal(writes,0,'No update may occur without an atomic transaction provider');
await assert.rejects(
 confirmFixtureResultWithOutbox(unsafeDb,'user-home',{submissionId:'sub-1'},
   async callback=>callback({get:async()=>null})),
 /RESULT_OUTBOX_TRANSACTION_REQUIRED/
);
assert.equal(writes,0);
let txWrites=0;
const tx={
 async get(sql:string){
   if(sql.includes('FROM efl_result_submissions'))
     return {fixtureId:'fixture-1',submitterId:'user-away',
       submittedClub:'club-away',seasonId:'season-2026-27',
       homeClub:'club-home',awayClub:'club-away'};
   return null;
 },
 async all(){
   // A released opponent means the fixture must never be confirmed.
   return [{userId:'user-home',clubId:'club-home'}];
 },
 async run(){txWrites++;throw Error('SHOULD_NOT_WRITE');}
};
await assert.rejects(
 confirmFixtureResultWithOutbox(unsafeDb,'user-home',
   {submissionId:'sub-1'},async callback=>callback(tx)),
 /RESULT_OUTBOX_OWNERSHIP_CONFLICT/
);
assert.equal(txWrites,0,'Invalid current ownership must prevent all writes');
const endpoint=await readFile(
 new URL('../../../tgcloud/endpoints/confirmResult.js',import.meta.url),'utf8'
);
assert.match(endpoint,/confirmFixtureResultWithOutbox/);
assert.match(endpoint,/resultConfirmationTransactionsVerified/);
assert.doesNotMatch(endpoint,/import\s*\{\s*confirmFixtureResult\s*\}/);
console.log('PASS_SERVERLESS_RESULT_TRANSACTION_GATE: unverified provider and revoked owner fail closed');
