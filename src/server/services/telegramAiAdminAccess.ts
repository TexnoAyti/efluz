import { isPrimaryOwner } from './telegramAiConfigService';
import type { AdminPlan } from './telegramAiAdminCatalog';

// Explicit AI delegation only; this does not grant an application admin role or league permissions.
const DELEGATED_AI_ADMIN_IDS = new Set(['7573478198']);
export function isAiAdminActor(id: string | number | undefined | null): boolean {
  return isPrimaryOwner(id) || DELEGATED_AI_ADMIN_IDS.has(String(id));
}
const LEAGUE_OPERATIONS = new Set([
  'result_edit','result_clear','result_approve','result_reject',
  'fixture_reopen','fixture_deadline','fixture_remind','club_assign','club_release',
  'matchday_control','matchday_advance','matchday_open_now','matchday_override','matchday_timer','matchday_remind',
  'standings_rebuild','cup_preview','cup_generate','cup_advance','cup_reconcile',
  'admin_access','scoped_users','scoped_reviews','scoped_overview',
  'clubs','fixtures','pending_results','submissions','matchday_status','cup_details','cup_health',
]);
export function assertAiAdminActionAllowed(id: number, plan: AdminPlan): void {
  if (!isAiAdminActor(id) || !Number.isSafeInteger(id)) throw new Error('OWNER_ONLY');
  if (!isPrimaryOwner(id) && !LEAGUE_OPERATIONS.has(plan.action))
    throw new Error('CLARIFY:Bu amal faqat asosiy admin uchun. Siz liga va kubok bo‘yicha mavjud admin ruxsatlaringiz doirasida AI buyruqlarini bera olasiz.');
}
