import assert from 'node:assert/strict';
import fs from 'node:fs';
import { workerLaneEnabled, workerRecoveryBatch, workerRecoveryMode } from '../services/backgroundWorkerRecovery';

const env=(values:Record<string,string>={})=>({
 DISABLE_BACKGROUND_WORKERS:'true',
 MIGRATION_WRITE_FREEZE:'false',
 ...values,
}) as NodeJS.ProcessEnv;
assert.equal(workerRecoveryMode(env()),'paused','Incident pause stays fail-closed');
for(const lane of ['notifications','reconciliation','uzeflife','round-post','tags','daily-report'] as const) {
 assert.equal(workerLaneEnabled(lane,env()),false,'Default pause stops '+lane);
}
assert.equal(workerLaneEnabled('notifications',env({SERVERLESS_WORKER_RECOVERY_MODE:'notifications'})),true);
assert.equal(workerLaneEnabled('reconciliation',env({SERVERLESS_WORKER_RECOVERY_MODE:'notifications'})),false);
assert.equal(workerLaneEnabled('reconciliation',env({SERVERLESS_WORKER_RECOVERY_MODE:'reconciliation'})),true);
assert.equal(workerLaneEnabled('notifications',env({SERVERLESS_WORKER_RECOVERY_MODE:'reconciliation'})),false);
assert.equal(workerLaneEnabled('uzeflife',env({SERVERLESS_WORKER_RECOVERY_MODE:'notifications'})),false);
assert.equal(workerLaneEnabled('tags',env({SERVERLESS_WORKER_RECOVERY_MODE:'notifications'})),false);
assert.equal(workerRecoveryMode(env({SERVERLESS_WORKER_RECOVERY_MODE:'invalid'})),'paused');
assert.equal(workerRecoveryMode(env({SERVERLESS_WORKER_RECOVERY_MODE:'all'})),'all');
assert.equal(workerRecoveryMode(env({MIGRATION_WRITE_FREEZE:'true',SERVERLESS_WORKER_RECOVERY_MODE:'all'})),'paused');
assert.equal(workerLaneEnabled('notifications',env({DISABLE_BACKGROUND_WORKERS:'false'})),true);
assert.equal(workerRecoveryBatch(env()),3);
assert.equal(workerRecoveryBatch(env({SERVERLESS_RECOVERY_BATCH_SIZE:'999'})),5);
assert.equal(workerRecoveryBatch(env({SERVERLESS_RECOVERY_BATCH_SIZE:'0'})),3);
assert.equal(workerRecoveryBatch(env({SERVERLESS_RECOVERY_BATCH_SIZE:'NaN'})),3);
assert.equal(workerRecoveryBatch(env({DISABLE_BACKGROUND_WORKERS:'false'})),25);

const root='src/server/';
const read=(path:string)=>fs.readFileSync(root+path,'utf8');
const app=read('app.ts');
assert.match(app,/workerRecoveryMode\(\)/,'Scheduled worker route checks recovery mode');
assert.match(app,/workerLaneEnabled\('notifications'\)/,'Notification lane checked separately');
assert.match(app,/workerLaneEnabled\('reconciliation'\)/,'Reconciliation lane checked separately');
assert.match(app,/timingSafeEqual/,'Internal cron authentication remains enforced');
const queue=read('services/telegramNotificationQueue.ts');
assert.match(queue,/processNotificationQueue\(workerRecoveryBatch\(\)/,'Queue uses strict recovery batch budget');
assert.match(queue,/if \(process\.env\.DISABLE_BACKGROUND_WORKERS === 'true'\) return;/,'A recovery invocation does no more than one bounded batch');
assert.match(read('sync/scheduleReconciliation.ts'),/workerLaneEnabled\('reconciliation'\)/);
assert.match(read('services/uzeflifeNotifications.ts'),/workerLaneEnabled\('uzeflife'\)/);
console.log('PASS serverless worker recovery: safe pause, independent lanes, freeze, bounded queue, authenticated cron');
