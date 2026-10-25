/** Application-owned operations only; existing organizer/module permissions remain authoritative. */
const op=(method:'GET'|'POST'|'DELETE',path:string,fields='')=>({method,path,fields});
export const AI_PLATFORM_ACTIONS={
 custom_tournaments:op('GET','@custom','limit?'),custom_mine:op('GET','@custom/my'),custom_detail:op('GET','@custom/:id'),
 custom_create:op('POST','@custom/create','name, description?, format, leagueScope, selectedLeagueId?, maxParticipants, rules:roundsCount and playoffLegMode and matchDurationHours plus format-specific fields, visibility?, spectatorAccess?, idempotencyKey:server operation ID'),
 custom_publish:op('POST','@custom/:id/publish'),custom_start:op('POST','@custom/:id/start'),custom_cancel:op('POST','@custom/:id/cancel'),
 custom_review:op('POST','@custom/:id/participants/:secondaryId/review','action:APPROVE|REJECT'),
 custom_remove:op('POST','@custom/:id/participants/:secondaryId/remove'),
 custom_result:op('POST','@custom/:id/matches/:secondaryId/result','homeScore, awayScore, penaltyHomeScore?, penaltyAwayScore?'),
 custom_correct:op('POST','@custom/:id/matches/:secondaryId/correct','homeScore, awayScore, penaltyHomeScore?, penaltyAwayScore?, note'),
 custom_settings:op('POST','@custom/:id/settings','name?, description?, rules?, visibility?, spectatorAccess?'),
 custom_assistant:op('POST','@custom/:id/assistants','assistantUserId'),custom_assistant_remove:op('DELETE','@custom/:id/assistants/:secondaryId'),
 custom_audit:op('GET','@custom/:id/audit-logs','limit?'),custom_users:op('GET','@custom/:id/management-users'),
 team_ticket_grant:op('POST','@team/tickets/grant','targetUserId, amount:1–100, expectedUsername?, idempotencyKey:server operation ID'),
 team_ticket_revoke:op('POST','@team/tickets/revoke','targetUserId, amount:1–100, expectedUsername?, idempotencyKey:server operation ID'),
 team_ticket_check:op('GET','@team/tickets/balance','reference:verified user ID'),
 ticket_balance:op('GET','@tickets/balance'),ticket_transactions:op('GET','@tickets/transactions','userId?'),
 ticket_grant:op('POST','@tickets/grant','targetUserId, amount, note?, idempotencyKey:server operation ID'),
 ticket_refund:op('POST','@tickets/refund','targetUserId, tournamentId, note?'),
 team_overview:op('GET','@team'),team_league:op('GET','@team/leagues/:id'),team_profile:op('GET','@team/teams/:id'),
 team_save:op('POST','@team/teams','id?:exact tp_ ID for edit or server generated for creation, name, members:array of name and optional existing tp_ id, captainName:explicit member name for new team or captainMemberId, version:current server version for edit, logo?'),
 team_league_save:op('POST','@team/leagues','id?:exact tp_ ID for edit or server generated for creation, name, teamIds:existing exact tp_ IDs, starterCount, rounds:1|2, version:current server version for edit, format?:LEAGUE|PLAYOFF|LEAGUE_AND_PLAYOFF, qualifiers?, description?'),
 team_league_action:op('POST','@team/leagues/:id/actions','version:current server version, action:START|CANCEL|NEXT|LINEUP|PAIR|RESET|SUBSTITUTE|TIEBREAK|SCORE; other fields depend on action; read current league first'),
 uzeflife_state:op('GET','@uzeflife'),uzeflife_history:op('GET','@uzeflife/history/:id'),
 uzeflife_open:op('POST','@uzeflife/open'),uzeflife_close:op('POST','@uzeflife/close'),
 uzeflife_generate:op('POST','@uzeflife/generate'),uzeflife_pause:op('POST','@uzeflife/pause'),uzeflife_resume:op('POST','@uzeflife/resume'),
 uzeflife_next:op('POST','@uzeflife/next'),uzeflife_complete:op('POST','@uzeflife/complete'),
 uzeflife_settings:op('POST','@uzeflife/settings','description'),uzeflife_round_hours:op('POST','@uzeflife/roundSettings','hours:24–168'),
 uzeflife_deadline:op('POST','@uzeflife/deadline','matchId, deadlineAt:ISO'),uzeflife_schedule:op('POST','@uzeflife/schedule','matchId, scheduledAt:ISO'),
 uzeflife_result:op('POST','@uzeflife/result','matchId, home, away, penaltyHome?, penaltyAway?'),
 uzeflife_approve:op('POST','@uzeflife/approveResult','matchId, expected:current proposal from protected state only'),
 uzeflife_clear_proposal:op('POST','@uzeflife/clearProposal','matchId'),uzeflife_resolve_dispute:op('POST','@uzeflife/resolveDispute','matchId, resolution'),
 uzeflife_participant_add:op('POST','@uzeflife/addParticipant','target:verified user ID'),uzeflife_review:op('POST','@uzeflife/review','target:verified user ID, status:approved|removed'),
 uzeflife_super_admin:op('POST','@uzeflife/superAdmin','target:verified user ID or null'),
 uzeflife_assistant:op('POST','@uzeflife/assistant','target:verified user ID, permissions:explicit permission array'),uzeflife_assistant_remove:op('POST','@uzeflife/removeAssistant','target:verified user ID'),
 uzeflife_subscriptions:op('POST','@uzeflife/subscriptions','enabled:boolean'),uzeflife_channel_add:op('POST','@uzeflife/addChannel','id:Telegram channel reference, title, url:https t.me URL'),
 uzeflife_channel_remove:op('POST','@uzeflife/removeChannel','id:existing channel reference'),
 uzeflife_navigation:op('POST','@uzeflife/customNavigation','enabled:boolean'),uzeflife_announce:op('POST','@uzeflife/announce','text'),
};
export const AI_ROUTE_PREFIXES:Record<string,string>={'@discipline':'/api/discipline','@telegram':'/api/telegram','@season':'/api/season-ops','@custom':'/api/custom-tournaments','@tickets':'/api/admin/custom-tournaments/tickets','@team':'/api/team-leagues-preview','@uzeflife':'/api/uzeflife'};
export function aiAdminRequestUrl(path:string) {const prefix=Object.keys(AI_ROUTE_PREFIXES).find(key=>path===key||path.startsWith(key+'/'));return prefix?AI_ROUTE_PREFIXES[prefix]+path.slice(prefix.length):'/api/admin'+path;}

export function isPlatformAdminRequest(text:string) {
  const head=text.replace(/"[^"\n]*"|“[^”\n]*”/g,' ').split(/(?:matn|sabab|izoh)\s*:/i)[0].toLowerCase();
  return /\b(?:uzeflife|team|custom|chipta)\b|foydalanuvchi turnir|shaxsiy turnir|oz turnir/.test(head) && /\b(?:yarat\w*|boshla\w*|och\w*|yop\w*|ber\w*|qosh\w*|qaytar\w*|olib tashla|tayinla\w*|yangila\w*|ozgartir\w*|saqla\w*|korsat\w*|tekshir\w*|royxat\w*|holati|bosqich\w*|hisob\w*|natija\w*|tugat\w*|yakunla\w*|pause|resume|start|create|publish|cancel|remove|grant|refund|update|settings|show|list)\b/.test(head);
}
