import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const outbox = readFileSync('src/server/outbox/redisOutbox.ts', 'utf8');
const queue = readFileSync('src/server/sync/mutationQueue.ts', 'utf8');
const app = readFileSync('src/server/app.ts', 'utf8');
const bundle = readFileSync('api/index.js', 'utf8');

assert.match(outbox, /claimDuePendingMutations/);
assert.match(outbox, /DEFAULT_CLAIM_LEASE_MS = 120_000/);
assert.match(outbox, /ZRANGEBYSCORE/);
assert.match(outbox, /status == 'SYNCING'/);
assert.match(outbox, /redis\.call\('ZADD'/);
assert.match(queue, /scheduleDurableMutationReplay/);
assert.match(queue, /claimDuePendingMutations\(15, 120_000\)/);
assert.match(queue, /db\.runTransaction/);
assert.match(queue, /OWNERSHIP_MISMATCH/);
assert.match(queue, /FIXTURE_ALREADY_CONFIRMED/);
assert.match(queue, /SUBMISSION_CONFLICT/);
assert.match(queue, /INVALID_FIXTURE_PARTICIPANT/);
assert.match(app, /\/api\/internal\/mutation-worker/);
assert.match(app, /timingSafeEqual/);
assert.match(app, /processPendingMutations/);
assert.match(bundle, /mutation-worker/);
console.log('durable sync worker regression: PASS');
