import { z } from 'zod';

type AdminAction = { method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; path: string; fields: string; };
const action = (method: AdminAction['method'], path: string, fields = ''): AdminAction => ({ method, path, fields });
/** Fixed application endpoints only. No SQL, shell, arbitrary URL or collection access. */
export const AI_ADMIN_ACTIONS: Record<string, AdminAction> = {
  result_edit: action('POST', '/fixtures/:id/result', 'homeScore:number, awayScore:number, status?:CONFIRMED|AWAITING_RESULT|SCHEDULED, notes?'),
  result_clear: action('POST', '/fixtures/:id/delete-result', 'deleteSubmissions?:boolean, notes?'),
  result_approve: action('POST', '/results/:id/approve', 'homeScore:number, awayScore:number, notes?'),
  result_reject: action('POST', '/results/:id/reject', 'notes?'),
  fixture_reopen: action('POST', '/fixtures/:id/reopen', 'notes?'),
  fixture_delete: action('DELETE', '/fixtures/:id', 'reason:string minimum 3 characters'),
  fixture_deadline: action('POST', '/fixtures/:id/deadline', 'deadlineAt:ISO datetime, notes?'),
  fixture_remind: action('POST', '/fixtures/:id/remind', 'message?'),
  submission_delete: action('DELETE', '/submissions/:id', 'reason?'),
  club_assign: action('POST', '/clubs/:id/assign', 'targetUserId:exact @username or user-id, seasonId?'),
  club_release: action('POST', '/clubs/:id/release', 'seasonId?'),
  user_role: action('POST', '/users/:id/role', 'isAdmin:boolean, adminPermissions:{scope:ALL|LEAGUES,leagueIds:string[]}'),
  user_suspend: action('POST', '/users/:id/suspend', 'isSuspended:boolean, reason?'),
  user_delete: action('DELETE', '/users/:id', 'reason?'),
  dispute_resolve: action('POST', '/disputes/:id/resolve', 'action:CONFIRM_HOME_SUBMISSION|CONFIRM_AWAY_SUBMISSION|MANUAL_SCORE|CANCEL_MATCH, homeScore?, awayScore?, notes?; consult existing API validation'),
  matchday_control: action('POST', '/competitions/:id/matchday/control', 'action:SELECT|OPEN|LOCK|EXTEND|RESTART, matchday:number, durationHours?, expectedUpdatedAt?'),
  matchday_advance: action('POST', '/competitions/:id/matchday/advance', 'durationHours?, seasonId?'),
  matchday_open_now: action('POST', '/competitions/:id/matchday/open-now', 'durationHours?, matchday?, seasonId?'),
  matchday_override: action('POST', '/competitions/:id/matchday/override', 'overrideStatus:AUTO|FORCE_OPEN|FORCE_LOCKED|PAUSED, matchday?, durationHours?, seasonId?'),
  matchday_timer: action('POST', '/competitions/:id/matchday/set-timer', 'currentMatchday?, durationHours?, nextOpenAt?, overrideStatus?'),
  matchday_remind: action('POST', '/competitions/:id/matchday/remind', 'seasonId?, matchday?'),
  standings_rebuild: action('POST', '/competitions/:id/rebuild-standings', 'seasonId?'),
  fixtures_generate: action('POST', '/fixtures/generate', 'competitionId, seasonId?'),
  fixtures_reset: action('POST', '/fixtures/reset', 'competitionId, confirmation:boolean'),
  fixtures_restore: action('POST', '/fixtures/restore-missing-pairs', 'competitionId, seasonId?'),
  knockout_generate: action('POST', '/knockouts/generate', 'competitionId, seasonId?'),
  cup_preview: action('POST', '/cups/:id/bracket/preview', 'seasonId?, newDraw?:boolean, drawSeed?'),
  cup_generate: action('POST', '/cups/:id/bracket/generate', 'seasonId?, confirmation:true, drawSeed:from cup_preview only'),
  cup_fixture_edit: action('PATCH', '/cups/:id/bracket/fixture/:secondaryId', 'homeClubId?, awayClubId?, seasonId?'),
  cup_reconcile: action('POST', '/cups/:id/reconcile', 'reason?'),
  cup_round: action('POST', '/cups/:id/round', 'roundNumber:number, action:OPEN|LOCK'),
  cup_advance: action('POST', '/cups/:id/round/advance'),
  cup_winner_advance: action('POST', '/cups/matches/:id/advance', 'seasonId?'),
  european_rebuild: action('POST', '/european/standings/rebuild', 'seasonId?'),
  european_preview: action('GET', '/european/qualification/preview', 'seasonId?'),
  european_apply: action('POST', '/european/qualification/apply', 'seasonId?, previewToken:from european_preview only, confirmation:true'),
  qualifications_evaluate: action('POST', '/qualifications/evaluate', 'seasonId?'),
  notification_message: action('PATCH', '/notifications/messages/:id', 'visibility:visible|hidden|deleted'),
  notification_type: action('PATCH', '/notifications/types/:id', 'visible:boolean'),
  notification_item: action('PATCH', '/notifications/:id', 'visibility:visible|hidden|deleted'),
  notification_settings: action('PUT', '/telegram/smart-settings', 'existing smart notification settings object'),
  broadcast: action('POST', '/telegram-notifications/broadcast', 'title:string, body:string, type?, targetAudience?, targetLeagueId?, selectedUserIds?, seasonId?'),
  broadcast_retry: action('POST', '/telegram-notifications/broadcasts/:id/retry-failed'),
  notification_queue: action('POST', '/telegram-notifications/process-queue'),
  recipients_refresh: action('POST', '/telegram-notifications/recipients/refresh'),
  admission_advance: action('POST', '/clubs/admission/advance', 'expectedStage:number, seasonId?'),
  read_model_rebuild: action('POST', '/read-model/rebuild', 'seasonId?'),
  sync: action('POST', '/sync'),
  metrics_reset: action('POST', '/read-metrics/reset'),
  migrate: action('POST', '/migrate-to-firestore', 'Explicit SQLite to Firestore migration only'),
  ai_config: action('PUT', '/telegram-ai/config', 'enabled?, allowedChatId?, allowedThreadId?, rateLimitUserPerMin?, rateLimitTopicPerMin?, maxDailyRequests?'),
  deadline_sweep: action('POST', '/match-ops/deadline-sweep', 'seasonId?'),
  no_show_resolve: action('POST', '/match-ops/no-show/:id/resolve', 'action:WALKOVER_HOME|WALKOVER_AWAY|POSTPONE|REJECT, notes?, deadlineAt?'),
  match_dispute_resolve: action('POST', '/match-ops/disputes/:id/resolve', 'action:CONFIRM_HOME_SUBMISSION|CONFIRM_AWAY_SUBMISSION|MANUAL_SCORE|CANCEL_MATCH, manualHomeScore?, manualAwayScore?, notes?'),
  lifecycle_override: action('POST', '/season-lifecycle/override', 'seasonId?, phase?, matchday?, reason?'),
  lifecycle_clear: action('DELETE', '/season-lifecycle/override', 'seasonId?'),
  season_rollover: action('POST', '/season-ops/rollover', 'seasonId?, confirmation:CREATE_NEXT_SEASON_SHELL'),
  season_archive: action('POST', '/season-ops/archive', 'seasonId, confirmation:ARCHIVE_COMPLETED_SEASON'),
  premium_grant: action('POST', '@telegram/premium/admin/grant', 'userId:exact ID, seasonId?'),
  premium_revoke: action('POST', '@telegram/premium/admin/revoke', 'userId:exact ID, seasonId?, reason?'),
  overview: action('GET', '/overview', 'seasonId?'), clubs: action('GET', '/clubs', 'seasonId?, leagueId?'),
  fixtures: action('GET', '/fixtures', 'seasonId?, competitionId?, matchday?, page?, pageSize?'),
  pending_results: action('GET', '/results/pending', 'seasonId?, limit?'),
  submissions: action('GET', '/submissions', 'fixtureId?, userId?, limit?'),
  users: action('GET', '/users', 'search?, page?, limit?'), user_detail: action('GET', '/users/:id/detail'),
  disputes: action('GET', '/disputes', 'status?, limit?'), audit: action('GET', '/audit-logs', 'limit?'),
  matchday_status: action('GET', '/competitions/:id/matchday/control'), cup_details: action('GET', '/cups/:id'),
  cup_health: action('GET', '/cups/:id/health'), health: action('GET', '/read-model/health', 'seasonId?'),
  notification_messages: action('GET', '/notifications/messages', 'cursor?'), notification_types: action('GET', '/notifications'),
  broadcasts: action('GET', '/telegram-notifications/broadcasts', 'limit?'),
  admission: action('GET', '/clubs/admission', 'seasonId?'),
  metrics: action('GET', '/read-metrics'),
  ai_settings: action('GET', '/telegram-ai/config'),
  season_control: action('GET', '/season-ops/control', 'seasonId?'),
  premium_overview: action('GET', '@telegram/premium/admin/overview', 'seasonId?'),
};
export const adminPlanSchema = z.object({
  action: z.string().refine(v => Object.hasOwn(AI_ADMIN_ACTIONS, v), 'Unknown action'),
  targetId: z.string().regex(/^[a-zA-Z0-9_:-]{1,180}$/).optional(),
  secondaryId: z.string().regex(/^[a-zA-Z0-9_:-]{1,180}$/).optional(),
  body: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((p, ctx) => {
  const spec = AI_ADMIN_ACTIONS[p.action];
  if (spec?.path.includes(':id') && !p.targetId) ctx.addIssue({ code: 'custom', message: 'Exact targetId required', path: ['targetId'] });
  if (spec?.path.includes(':secondaryId') && !p.secondaryId) ctx.addIssue({ code: 'custom', message: 'Exact secondaryId required', path: ['secondaryId'] });
  if (JSON.stringify(p.body).length > 4000) ctx.addIssue({ code: 'custom', message: 'Body too large', path: ['body'] });
});
export type AdminPlan = z.infer<typeof adminPlanSchema>;
export function adminPlanPath(plan: AdminPlan): string {
  return AI_ADMIN_ACTIONS[plan.action].path.replace(':secondaryId', plan.secondaryId || '').replace(':id', plan.targetId || '');
}
export const isAiAdminCommand = (text: string) => /^\/ai_(?:admin|confirm|cancel|actions|read)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/i.test(text.trim());
