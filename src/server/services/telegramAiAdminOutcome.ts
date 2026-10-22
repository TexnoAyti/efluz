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
  if (plan.action === 'results_bulk_apply') {
    const matches = data?.authoritative === true && data?.success === true && data?.appliedCount === plan.body.expectedCount &&
      data?.competitionId === plan.targetId && ['seasonId','fromMatchday','toMatchday','homeScore','awayScore','previewHash'].every(k => data[k] === plan.body[k]);
    return matches ? {state:'verified',message:`${data.appliedCount} ta o‘yinga ${data.homeScore}:${data.awayScore} natija saqlandi. Jadval va xabarnomalar yangilanmoqda.`}
      : {state:'unverified',message:'Ommaviy natija javobi rejaga mos kelmadi. Auditni tekshiring; amal avtomatik takrorlanmaydi.'};
  }
  if (['result_edit', 'result_approve', 'result_clear'].includes(plan.action)) {
    const fixture = data?.fixture;
    if (!fixture) return { state: 'accepted', message: 'Server amalni qabul qildi. Saqlangan o‘yin holati javobda qaytmadi; yakuniy holat qayta tekshirilmagan.' };
    const matches = fixture.id === plan.targetId && (plan.action === 'result_clear'
      ? fixture.homeScore == null && fixture.awayScore == null && fixture.status === 'SCHEDULED'
      : (plan.body.homeExtraTimeScore == null || fixture.homeExtraTimeScore === plan.body.homeExtraTimeScore && fixture.awayExtraTimeScore === plan.body.awayExtraTimeScore) && fixture.homeScore === plan.body.homeScore && fixture.awayScore === plan.body.awayScore && (plan.body.homePenaltyScore == null || fixture.homePenaltyScore === plan.body.homePenaltyScore && fixture.awayPenaltyScore === plan.body.awayPenaltyScore && fixture.winnerClubId === (Number(plan.body.homePenaltyScore) > Number(plan.body.awayPenaltyScore) ? fixture.homeClubId : fixture.awayClubId)) && fixture.status === (plan.action === 'result_approve' ? 'CONFIRMED' : plan.body.status || 'CONFIRMED'));
    if (!matches) return { state: 'unverified', message: 'Server qaytargan o‘yin holati tasdiqlangan rejaga mos kelmadi. Natijani admin panelda tekshiring; amal avtomatik takrorlanmaydi.' };
    return { state: 'verified', message: 'Bajarildi. Server qaytargan saqlangan natija reja bilan mosligi tekshirildi.' };
  }
  return { state: 'accepted', message: 'Bajarildi.' };
}
