import express from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { AdminPlan } from './telegramAiAdminCatalog';
import { AI_ADMIN_ACTIONS, adminPlanPath, adminPlanSchema } from './telegramAiAdminCatalog';
import { isPrimaryOwner, PRIMARY_OWNER_TELEGRAM_ID } from './telegramAiConfigService';

let gatewayPromise: Promise<ReturnType<typeof express>> | undefined;
async function getGateway() {
  return gatewayPromise ||= (async () => {
    const [cups, cupOps, matches, consistency, main, seasons, lifecycle, telegram, aiConfig] = await Promise.all([
      import('../routes/adminCupDraw.routes'), import('../routes/adminCupOps.routes'),
      import('../routes/adminMatchControl.routes'), import('../routes/consistencyGuard.routes'),
      import('../routes/admin.routes'), import('../routes/seasonOperations.routes'),
      import('../routes/seasonLifecycle.routes'), import('../routes/telegram.routes'), import('../routes/adminAiConfig.routes'),
    ]);
    const app = express();
    // Same routing order as production; preserves cup auto-progression and deletion guards.
    app.use('/api/admin/telegram-ai', aiConfig.adminAiConfigRouter);
    app.use('/api/admin/cups', cups.adminCupDrawRouter);
    app.use('/api/admin/season-lifecycle', lifecycle.adminSeasonLifecycleRouter);
    app.use('/api/admin/season-ops', seasons.adminSeasonOperationsRouter);
    app.use('/api/admin', cupOps.adminCupOpsRouter, matches.adminMatchControlRouter, consistency.adminConsistencyRouter, main.adminRouter);
    app.use('/api/telegram', telegram.telegramRouter);
    return app;
  })();
}

/** In-process route dispatch, no network or minted sessions. requireAdmin re-reads
 * the real account, scope/danger guards, validation, cache invalidation and audit run unchanged. */
export async function executeAiAdminRoute(plan: AdminPlan, ownerId: number, operationId: string, signal?: AbortSignal): Promise<{ status: number; data: any }> {
  if (!isPrimaryOwner(ownerId) || !Number.isSafeInteger(ownerId)) throw new Error('OWNER_ONLY');
  plan = adminPlanSchema.parse(plan);
  const { getAuthoritativeUserForAuthorization } = await import('../firebase/firestoreStore');
  const realOwner = await getAuthoritativeUserForAuthorization(`user-${PRIMARY_OWNER_TELEGRAM_ID}`);
  if (!realOwner || !isPrimaryOwner(realOwner.telegramId) || !realOwner.isAdmin || realOwner.isSuspended) throw new Error('OWNER_AUTHORIZATION_UNAVAILABLE');
  if (signal?.aborted) throw new Error('TIMEOUT_ABORTED');
  const spec = AI_ADMIN_ACTIONS[plan.action];
  const path = adminPlanPath(plan);
  const url = path.startsWith('@telegram') ? '/api/telegram' + path.slice('@telegram'.length) : '/api/admin' + path;
  const app = await getGateway();
  if (signal?.aborted) throw new Error('TIMEOUT_ABORTED');
  return new Promise((resolve, reject) => {
    const req = new IncomingMessage(new Socket()) as express.Request;
    req.method = spec.method;
    const query = spec.method === 'GET' || spec.method === 'DELETE' && plan.action === 'lifecycle_clear'
      ? new URLSearchParams(Object.entries(plan.body).filter(([, value]) => ['string','number','boolean'].includes(typeof value)).map(([key, value]) => [key, String(value)])).toString() : '';
    req.url = url + (query ? '?' + query : '');
    req.headers = { 'x-idempotency-key': operationId, 'content-type': 'application/json' };
    req.body = { ...plan.body };
    req.user = realOwner;
    const res = new ServerResponse(req) as express.Response;
    let settled = false;
    const finish = (error?: Error, result?: {status:number; data:any}) => {
      if (settled) return; settled = true;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new Error('ADMIN_EXECUTION_OUTCOME_UNKNOWN'));
    signal?.addEventListener('abort', abort, { once: true });
    // Capture only the route's JSON response. No listening socket, auth header or HTTP client.
    res.end = ((chunk?: any) => {
      let data: any;
      try { data = JSON.parse(String(chunk || '{}')); } catch { data = { error: 'NON_JSON_ADMIN_RESPONSE' }; }
      finish(undefined, { status: res.statusCode, data });
      return res;
    }) as any;
    app(req, res, (error?: any) => finish(error || new Error('ADMIN_ROUTE_NOT_FOUND')));
  });
}
