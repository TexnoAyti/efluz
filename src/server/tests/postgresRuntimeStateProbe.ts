import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { authorizeExport } from '../migration/serverExport';
import { getFirestoreDb } from '../firebase/admin';
import { PostgresRuntimeStore } from '../services/postgresRuntimeStore';
import { PostgresNotificationStore } from '../services/postgresNotificationStore';
import { updateSmartNotificationSettings, getSmartNotificationSettings, DEFAULT_SMART_NOTIFICATION_EVENTS } from '../services/smartNotificationSettingsService';
import { updatePremiumSmartAlertPreferences, getPremiumSmartAlertPreferences } from '../services/premiumSmartNotificationService';
import { createTournamentImageDownloadService } from '../services/tournamentImageDownload';
import { saveQualificationPreviewToken, getQualificationPreviewToken, deleteQualificationPreviewToken } from '../tournament/qualificationEngine';
import { quotaCachedRead, invalidateQuotaRead } from '../services/quotaReadCache';
import { SMART_ENQUEUE_SCRIPT } from '../services/notificationBackupQueue';

/** Explicitly compiled into a temporary authenticated preview, never mounted
 * by apiEntry/app. Every test key is synthetic; cleanup is part of the result. */
export function runtimeStateProbe(expectedHash: string, expiresAt: number) {
  return async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (!authorizeExport(req.method, req.headers.authorization || '', expectedHash, expiresAt, process.env.VERCEL_ENV || '')) {
      res.statusCode = 403; res.end(JSON.stringify({ error: 'PROBE_DISABLED' })); return;
    }
    process.env.DATABASE_PROVIDER = 'supabase'; process.env.SUPABASE_DATA_NAMESPACE = 'preview';
    delete process.env.FIREBASE_FORCE_LOCAL_FALLBACK;
    const db = getFirestoreDb(), state = new PostgresRuntimeStore(), other = new PostgresRuntimeStore();
    const notifications = new PostgresNotificationStore();
    const prefix = 'state-probe-' + randomUUID(), keys: string[] = [], notificationKeys: string[] = [];
    const key = (suffix: string) => { const value = prefix + ':' + suffix; keys.push(value); return value; };
    const lease = key('lease'), expiry = key('expiry'), zero = key('zero'), budget = key('budget');
    const previewToken = key('qualification'), season = prefix;
    keys.push('qualification:preview:' + previewToken, 'efluz:v1:telegram:smart:settings:' + season, `efluz:v1:premium:smart-alerts:${season}:${prefix}`);
    const cache = key('cache');
    keys.push(...['fresh', 'lkg', 'version', 'lease'].map(part => `efluz:v1:quota-read:${cache}:${part}`));
    let outcome: any = { status: 'FAILED', reason: 'POSTGRES_STATE_PROBE_FAILED' };
    const originalFetch = globalThis.fetch;
    let nonDatabaseRequests = 0;
    globalThis.fetch = (async (input: any, init: any) => {
      const url = new URL(String(input));
      if (url.origin !== new URL(process.env.SUPABASE_URL!).origin) { nonDatabaseRequests++; throw Error('ONLY_POSTGRES_TRANSPORT_ALLOWED'); }
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      const claims = await Promise.all([state, other, state, other].map(store => store.set(lease, 'owner', { nx: true, ex: 60 })));
      assert.equal(claims.filter(Boolean).length, 1);
      await state.set(zero, 0); assert.equal(await other.get(zero), 0);
      await state.set(expiry, { private: 'temporary' }, { ex: .01 });
      await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(await other.get(expiry), null);
      assert.equal(await other.set(expiry, 'renewed', { nx: true, ex: 60 }), 'OK');
      const counts = await Promise.all([state, other, state, other].map(store => store.eval('EFL_RATE_LIMIT_V1', [budget], [60])));
      assert.deepEqual(counts.sort(), [1, 2, 3, 4]);
      assert.equal(await state.eval('EFL_STATE_RELEASE_V1', [lease], ['other']), 0);
      assert.equal(await other.eval('EFL_STATE_RELEASE_V1', [lease], ['owner']), 1);
      await updateSmartNotificationSettings({ seasonId: season, enabled: false, events: DEFAULT_SMART_NOTIFICATION_EVENTS, updatedBy: prefix });
      assert.equal((await getSmartNotificationSettings(season)).enabled, false);
      await updatePremiumSmartAlertPreferences({ userId: prefix, seasonId: season, values: { careerDigest: false }, updatedBy: prefix });
      assert.equal((await getPremiumSmartAlertPreferences(prefix, season)).careerDigest, false);
      const preview: any = { previewToken, seasonId: season, sourceFingerprint: prefix };
      await saveQualificationPreviewToken(previewToken, preview);
      assert.deepEqual(await getQualificationPreviewToken(previewToken), preview);
      await deleteQualificationPreviewToken(previewToken); assert.equal(await getQualificationPreviewToken(previewToken), null);
      let reads = 0;
      await quotaCachedRead(cache, 60, async () => { reads++; return []; });
      assert.deepEqual(await quotaCachedRead(cache, 60, async () => { reads++; return ['wrong']; }), []); assert.equal(reads, 1);
      await invalidateQuotaRead(cache);
      assert.deepEqual(await quotaCachedRead(cache, 60, async () => { reads++; return ['new']; }), ['new']); assert.equal(reads, 2);
      // A valid minimal PNG header/trailer; image validator is tested with a full
      // rendered PNG by the isolated HTTP suite. Here verify exact DB bytes.
      const png = Buffer.alloc(45); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.write('IHDR', 12); png.writeUInt32BE(1080, 16); png.writeUInt32BE(100, 20); png.write('IEND', 37);
      const image = createTournamentImageDownloadService();
      const exported = await image.create(png.toString('base64'), 'efluz-probe.png');
      const token = exported.downloadPath.match(/\/([a-f0-9]{48})\.png$/)![1]; keys.push('efluz:image-export:' + token);
      assert.deepEqual((await image.get(token))?.png, png);
      const queueKeys = ['dedupe', 'records', 'queue', 'processing', 'worker'].map(suffix => prefix + ':notify:' + suffix); notificationKeys.push(...queueKeys);
      const record = JSON.stringify({ id: prefix }), job = JSON.stringify({ jobId: prefix, availableAt: 0 });
      assert.equal(await notifications.eval(SMART_ENQUEUE_SCRIPT, queueKeys.slice(0, 3), [60, prefix, record, job]), 1);
      assert.equal(await notifications.eval(SMART_ENQUEUE_SCRIPT, queueKeys.slice(0, 3), [60, prefix, record, job]), 0);
      assert.equal(await notifications.hexists(queueKeys[1], prefix), 1);
      await notifications.set(queueKeys[4], 'worker', { ex: 60 });
      const claimed = await notifications.eval<any[], any>('EFL_NOTIFY_CLAIM_V1', [queueKeys[2], queueKeys[3], queueKeys[4]], ['worker', Date.now()]);
      assert.equal(claimed.jobId, prefix); assert.deepEqual(await notifications.get(queueKeys[2]), []);
      assert.equal(nonDatabaseRequests, 0);
      outcome = { status: 'PASS', namespace: 'preview', checks: ['real_pg_concurrent_nx', 'real_pg_atomic_rate_limit', 'expiry_renewal', 'lease_release', 'disabled_settings', 'premium_preferences', 'consumed_qualification_token', 'cache_invalidation', 'image_bytes', 'queue_dedupe_and_worker_claim', 'no_redis_or_telegram_calls'] };
    } catch (error: any) { console.error('[PG_STATE_PROBE_FAILED]', error?.message?.slice(0, 120)); res.statusCode = 500; }
    finally {
      try {
        await state.del(...keys); await notifications.del(...notificationKeys);
        const ids = keys.map(value => createHash('sha256').update(value).digest('hex'));
        const remaining = await db.collection('runtime_state').where('__name__', 'in', ids).get(); assert.equal(remaining.size, 0);
        outcome.cleaned = true;
      } catch { res.statusCode = 500; outcome = { status: 'FAILED', reason: 'PROBE_CLEANUP_FAILED' }; }
      globalThis.fetch = originalFetch;
    }
    res.end(JSON.stringify(outcome));
  };
}
