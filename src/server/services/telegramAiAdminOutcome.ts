import type { AdminPlan } from './telegramAiAdminCatalog';

/** Interpret the server receipt, including durable queued writes. Result routes already
 * read the stored fixture back; compare that receipt without another Firestore query. */
export function inspectAiAdminOutcome(plan: AdminPlan, data: any): { state: 'queued' | 'verified' | 'accepted' | 'unverified'; message: string } {
  if(plan.action==='club_selection_ban'){
    if(data?.success!==true||data?.ban?.userId!==plan.targetId||data.ban.isBanned!==plan.body.isBanned||!Number.isInteger(data.ban.revision))return {state:'unverified',message:'Ban saqlangani tasdiqlanmadi. Holatni tekshiring.'};
    return {state:'verified',message:data.ban.isBanned?'Klub tanlashga ban saqlandi. Foydalanuvchi boshqa klub tanlay olmaydi.':'Klub tanlash bani olib tashlandi.'};
  }
  if (data?.pendingSync === true || data?.fixture?.pendingSync === true || data?.result?.pendingSync === true || data?.result?.fixture?.pendingSync === true) return {
    state: 'queued', message: 'Amal sinxronlash navbatiga saqlandi. Asosiy bazaga yozilishi hali tasdiqlanmagan; qayta yuborish shart emas.',
  };
  if (data?.authoritative === false || data?.isFallback === true) return {
    state: 'unverified', message: 'Server zaxira holatni qaytardi. Asosiy bazadagi yakuniy holat tasdiqlanmadi; qayta avtomatik bajarilmaydi.',
  };
  if(['team_ticket_grant','team_ticket_revoke'].includes(plan.action)){const receipt=data?.data,account=receipt?.account;return receipt?.transactionId&&account?.userId===plan.body.targetUserId&&Number.isSafeInteger(account.balance)&&account.balance>=0?{state:'verified',message:`Team ticketi ${plan.action==='team_ticket_grant'?'berildi':'qaytarib olindi'}. Balans: ${account.balance}.`}:{state:'unverified',message:'Team ticketining saqlangan holati tasdiqlanmadi. Balansni tekshiring; avtomatik takrorlanmaydi.'};}
  if(['discipline_issue','discipline_revoke'].includes(plan.action)) {
    const card=data?.card;
    const matches=card?.userId===plan.targetId&&card?.seasonId===plan.body.seasonId&&(plan.action==='discipline_issue'
      ? card.id==='card-'+plan.body.requestId&&card.status==='ACTIVE'&&card.color===plan.body.color&&card.reason===plan.body.reason&&card.note===plan.body.note&&card.incidentFixtureId===plan.body.incidentFixtureId&&(!Object.hasOwn(plan.body,'expectedSuspensionFixtureId')||card.suspensionFixtureId===plan.body.expectedSuspensionFixtureId)
      : data.success===true&&card.id===plan.secondaryId&&card.status==='REVOKED'&&card.revokeReason===plan.body.reason);
    return matches?{state:'verified',message:plan.action==='discipline_revoke'?'Kartochka bekor qilindi. Saqlangan holati tekshirildi.':card.color==='RED'?`Qizil kartochka saqlandi. ${card.suspensionFixtureId?'Bir o‘yinlik chetlatish bog‘landi.':'Chetlatish keyingi mos o‘yinga bog‘lanadi.'}`:'Sariq kartochka saqlandi — ogohlantirish.'}:{state:'unverified',message:'Kartochka javobi tasdiqlangan rejaga mos kelmadi. Intizom bo‘limini tekshiring; avtomatik takrorlanmaydi.'};
  }
  if(plan.action==='admission_league')return data?.admission?.leagueOverrides?.[String(plan.body.leagueId)]===plan.body.open?{state:'verified',message:`Klub tanlash ${plan.body.open?'ochildi':'yopildi'}. Saqlangan holati tekshirildi.`}:{state:'unverified',message:'Klub tanlashning yakuniy holati tasdiqlanmadi; avtomatik takrorlanmaydi.'};
  if(plan.action==='fixture_schedule')return data?.success===true&&data?.partial===false&&data?.updated===(plan.body.expected as any[])?.length&&data?.scheduledAt===(plan.body.scheduledAt||'')&&(plan.body.venue===undefined||data.venue===plan.body.venue)?{state:'verified',message:`${data.updated} ta o‘yin vaqti/stadioni yangilandi.`}:{state:'unverified',message:'Jadval qisman o‘zgargan yoki javob rejaga mos kelmadi. Holatini tekshiring; avtomatik takrorlanmaydi.'};
  if (plan.action === 'results_bulk_apply') {
    const matches = data?.authoritative === true && data?.success === true && data?.appliedCount === plan.body.expectedCount &&
      data?.competitionId === plan.targetId && ['seasonId','fromMatchday','toMatchday','homeScore','awayScore','previewHash'].every(k => data[k] === plan.body[k]);
    return matches ? {state:'verified',message:`${data.appliedCount} ta o‘yinga ${data.homeScore}:${data.awayScore} natija saqlandi. Jadval va xabarnomalar yangilanmoqda.`}
      : {state:'unverified',message:'Ommaviy natija javobi rejaga mos kelmadi. Auditni tekshiring; amal avtomatik takrorlanmaydi.'};
  }
  if (['matchday_control','matchday_advance','matchday_open_now'].includes(plan.action)) {
    const expectedRound = plan.action === 'matchday_advance' && Number.isInteger(plan.body.expectedCurrentMatchday)
      ? Number(plan.body.expectedCurrentMatchday) + 1 : plan.body.matchday;
    const round = data?.matchday ?? data?.currentMatchday;
    const locked = plan.body.action === 'LOCK';
    if (data?.success !== true || data?.competitionId !== plan.targetId || expectedRound != null && round !== expectedRound || typeof data?.isMatchdayOpen !== 'boolean' || data.isMatchdayOpen === locked)
      return {state:'unverified',message:'Server qaytargan tur holati rejaga mos kelmadi. Admin panelni tekshiring; amal avtomatik takrorlanmaydi.'};
    return {state:'verified',message:`${round}-tur ${locked ? 'yopildi' : 'ochildi'}.${data.nextMatchdayOpenAt ? ` Muddat: ${new Intl.DateTimeFormat('uz-UZ',{timeZone:'Asia/Tashkent',dateStyle:'short',timeStyle:'short'}).format(new Date(data.nextMatchdayOpenAt))}.` : ''} Bildirishnoma yetkazilgani bu javob bilan tasdiqlanmaydi.`};
  }
  if (plan.action === 'matchday_remind') {
    if (data?.success !== true || data?.competitionId !== plan.targetId || data?.matchday !== plan.body.matchday || plan.body.fromMatchday !== undefined && data?.fromMatchday !== plan.body.fromMatchday || !['queued','skipped','outstandingPlayers'].every(k => Number.isInteger(data?.[k]) && data[k] >= 0))
      return {state:'unverified',message:'Eslatma javobi to‘liq yoki rejaga mos emas. Avtomatik qayta yuborilmaydi.'};
    return {state:'queued',message:`${data.fromMatchday && data.fromMatchday !== data.matchday ? data.fromMatchday+"–"+data.matchday+"-turlar" : data.matchday+"-tur"}: ${data.outstandingPlayers} ta yetishmayotgan natija uchun ${data.queued} ta eslatma navbatga qo‘yildi. ${data.skipped} ta o‘tkazib yuborildi, ${data.failed || 0} ta navbatga qo‘yilmadi. Bu yetkazilgan xabarlar soni emas.`};
  }
  if (plan.action === 'broadcast') {
    const total = data?.broadcast?.metrics?.totalRecipients;
    if (data?.success !== true || !data?.broadcast?.id || !Number.isInteger(total) || total < 0)
      return {state:'unverified',message:'Xabar navbatining tasdig‘i to‘liq qaytmadi. Holatini tekshiring; avtomatik qayta yuborilmaydi.'};
    return {state:'queued',message:`Xabar ${total} ta qabul qiluvchi uchun navbatga qo‘yildi. Yetkazilganini xabarlar tarixidan tekshirish mumkin. Xabar ID: ${data.broadcast.id}`};
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
  if(data?.success===false||data?.ok===false||data?.partial===true||data?.error)return {state:'unverified',message:'Server amalning to‘liq bajarilganini tasdiqlamadi. Holatini tekshiring; avtomatik takrorlanmaydi.'};
  return { state: 'accepted', message: 'Bajarildi.' };
}
