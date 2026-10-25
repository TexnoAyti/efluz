import { aiAdminRequestUrl } from './telegramAiPlatformCatalog';
import express from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { AdminPlan } from './telegramAiAdminCatalog';
import { AI_ADMIN_ACTIONS, adminPlanPath, adminPlanSchema } from './telegramAiAdminCatalog';
import { isAiAdminActor, assertAiAdminActionAllowed } from './telegramAiAdminAccess';

const mountedRoutes:Array<{method:string;path:string}>=[];
export async function getAiAdminMountedRoutes(){await getGateway();return mountedRoutes.map(row=>({...row}));}
let gatewayPromise: Promise<ReturnType<typeof express>> | undefined;
async function getGateway() {
  return gatewayPromise ||= (async () => {
    const [cups, cupOps, matches, consistency, main, seasons, lifecycle, telegram, aiConfig, notifications, discipline, custom, tickets, team, uzeflife] = await Promise.all([
      import('../routes/adminCupDraw.routes'), import('../routes/adminCupOps.routes'),
      import('../routes/adminMatchControl.routes'), import('../routes/consistencyGuard.routes'),
      import('../routes/admin.routes'), import('../routes/seasonOperations.routes'),
      import('../routes/seasonLifecycle.routes'), import('../routes/telegram.routes'), import('../routes/adminAiConfig.routes'), import('../routes/adminNotifications.routes'), import('../routes/discipline.routes'), import('../routes/customTournaments.routes'), import('../routes/customTournamentTickets.routes'), import('../routes/teamLeaguePreview.routes'), import('../routes/uzeflife.routes'),
    ]);
    const app = express();
    // Same routing order as production; preserves cup auto-progression and deletion guards.
    const mounts:Array<[string,express.Router]>=[
      ['/api/discipline',discipline.disciplineRouter],
      ['/api/admin/telegram-ai',aiConfig.adminAiConfigRouter],['/api/admin/cups',cups.adminCupDrawRouter],
      ['/api/admin/season-lifecycle',lifecycle.adminSeasonLifecycleRouter],['/api/admin/season-ops',seasons.adminSeasonOperationsRouter],
      ['/api/admin',cupOps.adminCupOpsRouter],['/api/admin',matches.adminMatchControlRouter],['/api/admin',consistency.adminConsistencyRouter],['/api/admin',main.adminRouter],
      ['/api/telegram',telegram.telegramRouter],['/api/season-ops',seasons.seasonOperationsRouter],
      ['/api/admin/custom-tournaments/tickets',tickets.customTournamentTicketsRouter],['/api/custom-tournaments',custom.customTournamentsRouter],
      ['/api/team-leagues-preview',team.teamLeaguePreviewRouter],['/api/uzeflife',uzeflife.uzeflifeRouter],
    ];
    for(const [prefix,router] of mounts){
      app.use(prefix,router);
      for(const layer of (router as any).stack||[]) {
        if(layer.route)for(const method of Object.keys(layer.route.methods))mountedRoutes.push({method:method.toUpperCase(),path:prefix+(layer.route.path==='/'?'':layer.route.path)});
        else if(layer.handle===notifications.adminNotificationsRouter)for(const child of (layer.handle as any).stack||[])if(child.route)for(const method of Object.keys(child.route.methods))mountedRoutes.push({method:method.toUpperCase(),path:prefix+'/notifications'+(child.route.path==='/'?'':child.route.path)});
      }
    }
    return app;
  })();
}

/** In-process route dispatch, no network or minted sessions. requireAdmin re-reads
 * the real account, scope/danger guards, validation, cache invalidation and audit run unchanged. */
export async function executeAiAdminRoute(plan: AdminPlan, ownerId: number, operationId: string, signal?: AbortSignal): Promise<{ status: number; data: any }> {
  if (!isAiAdminActor(ownerId) || !Number.isSafeInteger(ownerId)) throw new Error('OWNER_ONLY');
  plan = adminPlanSchema.parse(plan);
  assertAiAdminActionAllowed(ownerId, plan);
  const { getAuthoritativeUserForAuthorization } = await import('../firebase/firestoreStore');
  let realOwner;
  try { realOwner = await getAuthoritativeUserForAuthorization(`user-${ownerId}`); }
  catch (error: any) { if (/RESOURCE_EXHAUSTED|quota|CIRCUIT_OPEN/i.test(error?.message || '')) throw new Error('ADMIN_DATABASE_QUOTA'); throw error; }
  if (!realOwner || String(realOwner.telegramId) !== String(ownerId) || !realOwner.isAdmin || realOwner.isSuspended) throw new Error('OWNER_AUTHORIZATION_UNAVAILABLE');
  if (signal?.aborted) throw new Error('TIMEOUT_ABORTED');
  if (plan.body.expectedUsername !== undefined) {
    const target = String(plan.body.targetUserId || plan.body.userId || plan.body.assistantUserId || (['uzeflife_participant_add','uzeflife_review','uzeflife_super_admin','uzeflife_assistant','uzeflife_assistant_remove'].includes(plan.action)?plan.body.target:'') || (['custom_review','custom_remove','custom_assistant_remove'].includes(plan.action)?plan.secondaryId:'') || plan.targetId || (Array.isArray(plan.body.selectedUserIds) && plan.body.selectedUserIds.length === 1 ? plan.body.selectedUserIds[0] : '') || '');
    let user;
    try { user = target === realOwner.id ? realOwner : await getAuthoritativeUserForAuthorization(target); }
    catch(error:any) { if (/RESOURCE_EXHAUSTED|quota|CIRCUIT_OPEN/i.test(error?.message || '')) throw new Error('ADMIN_DATABASE_QUOTA'); throw error; }
    if (!user || (user.username || '').replace(/^@/,'').toLowerCase() !== String(plan.body.expectedUsername).toLowerCase())
      return {status:409,data:{error:'USER_REFERENCE_CHANGED',message:'Username yoki akkaunt o‘zgargan. Amal bajarilmadi; username orqali yangi reja tayyorlang.'}};
    plan = {...plan,body:{...plan.body}};
    if(!plan.action.startsWith('team_ticket_'))delete plan.body.expectedUsername;
  }
  if (plan.body.expectedClubId !== undefined) {
    const { getFirestoreDb } = await import('../firebase/admin');
    const occupancy=(await getFirestoreDb().collection('club_occupancies').doc(`${plan.body.seasonId}_${plan.body.expectedClubId}`).get()).data();
    if (!occupancy || occupancy.status !== 'active' || occupancy.userId !== plan.targetId) return {status:409,data:{error:'CLUB_OWNER_CHANGED',message:'Klub egasi o‘zgardi. Yangi egasi bilan qayta reja tuzing.'}};
    plan={...plan,body:{...plan.body}};delete plan.body.expectedClubId;
  }
  if(['ticket_grant','team_ticket_grant','team_ticket_revoke','custom_create','custom_publish'].includes(plan.action))plan={...plan,body:{...plan.body,idempotencyKey:operationId}};
  const spec = AI_ADMIN_ACTIONS[plan.action];
  const path = adminPlanPath(plan);
  const url = aiAdminRequestUrl(path);
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
