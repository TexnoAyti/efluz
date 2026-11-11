/** Staged serverless recovery after a database saturation incident.
 * Keep DISABLE_BACKGROUND_WORKERS=true while enabling one bounded lane at a
 * time. A missing/invalid recovery mode ALWAYS fails closed.
 */
export type WorkerLane = 'notifications' | 'reconciliation' | 'uzeflife' | 'round-post' | 'tags' | 'daily-report';
export type WorkerRecoveryMode = 'paused' | 'notifications' | 'reconciliation' | 'all';
export function workerRecoveryMode(env: NodeJS.ProcessEnv=process.env): WorkerRecoveryMode {
 if (env.MIGRATION_WRITE_FREEZE === 'true') return 'paused';
 if (env.DISABLE_BACKGROUND_WORKERS !== 'true') return 'all';
 const mode=env.SERVERLESS_WORKER_RECOVERY_MODE;
 return mode==='notifications'||mode==='reconciliation'||mode==='all'?mode:'paused';
}
export function workerLaneEnabled(lane: WorkerLane, env: NodeJS.ProcessEnv=process.env): boolean {
 const mode=workerRecoveryMode(env);
 return mode==='all'||mode===lane;
}
export function workerRecoveryBatch(env: NodeJS.ProcessEnv=process.env): number {
 if(env.DISABLE_BACKGROUND_WORKERS !== 'true') return 25;
 const num=Number(env.SERVERLESS_RECOVERY_BATCH_SIZE||3);
 // Always keep a strict recovery ceiling even with an invalid env value.
 return Number.isSafeInteger(num)&&num>=1 ? Math.min(5,num) : 3;
}
