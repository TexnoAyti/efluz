import type { AdminPlan } from './telegramAiAdminCatalog';

/** Interpret the server receipt, including durable queued writes. Result routes already
 * read the stored fixture back; compare that receipt without another Firestore query. */
export function inspectAiAdminOutcome(plan: AdminPlan, data: any): { state: 'queued' | 'verified' | 'accepted' | 'unverified'; message: string } {
  if (data?.pendingSync === true || data?.fixture?.pendingSync === true || data?.result?.pendingSync === true || data?.result?.fixture?.pendingSync === true) return {
    state: 'queued', message: 'Amal sinxronlash navbatiga saqlandi. Asosiy bazaga yozilishi hali tasdiqlanmagan; qayta yuborish shart emas.',
  };
  if (data?.authoritative === false || data?.isFallback === true) return {
    state: 'unverified', message: 'Server zaxira holatni qaytardi. Asosiy bazadagi yakuniy holat tasdiqlanmadi; qayta avtomatik bajarilmaydi.',
  };
  if (['result_edit', 'result_approve', 'result_clear'].includes(plan.action)) {
    const fixture = data?.fixture;
    if (!fixture) return { state: 'accepted', message: 'Server amalni qabul qildi. Saqlangan o‘yin holati javobda qaytmadi; yakuniy holat qayta tekshirilmagan.' };
    const matches = fixture.id === plan.targetId && (plan.action === 'result_clear'
      ? fixture.homeScore == null && fixture.awayScore == null && fixture.status === 'SCHEDULED'
      : fixture.homeScore === plan.body.homeScore && fixture.awayScore === plan.body.awayScore && fixture.status === (plan.action === 'result_approve' ? 'CONFIRMED' : plan.body.status || 'CONFIRMED'));
    if (!matches) return { state: 'unverified', message: 'Server qaytargan o‘yin holati tasdiqlangan rejaga mos kelmadi. Natijani admin panelda tekshiring; amal avtomatik takrorlanmaydi.' };
    return { state: 'verified', message: 'Bajarildi. Server qaytargan saqlangan natija reja bilan mosligi tekshirildi.' };
  }
  return { state: 'accepted', message: 'Bajarildi.' };
}
