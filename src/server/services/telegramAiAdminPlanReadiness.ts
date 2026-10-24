import { type AdminPlan, AI_ADMIN_ACTIONS } from './telegramAiAdminCatalog';
import { resolveAdminScore } from './telegramAiNaturalAdminPlanner';
import { normalizeAiEntity, resolveAiClubs } from './telegramAiEntities';
import { createAiTournamentReader } from './telegramAiDataService';
import { detectAiCupStage, fixtureMatchesAiCupStage } from './telegramAiCupStage';
import { requestedMatchday, findConversationCompetitions } from './telegramAiConversationCommands';

const required: Record<string,string[]> = {
  ai_test_query:['query'], custom_create:['name','format','leagueScope','maxParticipants'], custom_review:['action'],
  custom_result:['homeScore','awayScore'], custom_correct:['homeScore','awayScore'], custom_assistant:['assistantUserId'],
  ticket_grant:['targetUserId','amount'], ticket_refund:['targetUserId','tournamentId'],
  team_save:['id','name','members','captainMemberId','version'], team_league_save:['id','name','teamIds','starterCount','rounds','version'], team_league_action:['action','version'],
  discipline_issue:['seasonId','color','reason','note','requestId'], discipline_revoke:['seasonId','reason'],
  admission_league:['seasonId','leagueId','open'], fixture_schedule:['seasonId','expected'],
  results_bulk_apply:['seasonId','fromMatchday','toMatchday','homeScore','awayScore','previewHash','expectedCount'],
  result_edit:['homeScore','awayScore'], result_approve:['homeScore','awayScore'], fixture_delete:['reason'], fixture_deadline:['deadlineAt'],
  club_assign:['targetUserId'], user_role:['isAdmin'], user_suspend:['isSuspended'], dispute_resolve:['action'],
  matchday_control:['action','matchday'], matchday_override:['overrideStatus'],
  matchday_remind:['matchday'],
  fixtures_generate:['competitionId'], fixtures_restore:['competitionId'], fixtures_reset:['competitionId','confirmation'], knockout_generate:['competitionId'],
  cup_generate:['confirmation','drawSeed'], cup_round:['roundNumber','action'], european_apply:['previewToken','confirmation'],
  notification_message:['visibility'], notification_type:['visible'], notification_item:['visibility'], broadcast:['title','body','targetAudience'],
  admission_advance:['expectedStage'], no_show_resolve:['action'], match_dispute_resolve:['action'],
  season_rollover:['confirmation'], season_archive:['seasonId','confirmation'], premium_grant:['userId'], premium_revoke:['userId'],
};
const names: Record<string,string> = {homeScore:'uy jamoasi hisobi',awayScore:'safar jamoasi hisobi',reason:'sabab',deadlineAt:'sana/vaqt va vaqt zonasi',targetUserId:'foydalanuvchi @username yoki ID',isAdmin:'admin berish yoki olib tashlash',isSuspended:'bloklash yoki blokdan chiqarish',action:'amal turi',matchday:'tur raqami',competitionId:'turnir',drawSeed:'server bergan qura kodi',previewToken:'server bergan oldindan ko‘rish kodi',title:'sarlavha',body:'xabar matni',targetAudience:'qabul qiluvchilar',userId:'foydalanuvchi ID',seasonId:'mavsum ID',confirmation:'shu amal uchun aniq tasdiq',roundNumber:'bosqich raqami'};
export function assertAdminPlanReady(plan: AdminPlan) {
  if (['dispute_resolve','match_dispute_resolve'].includes(plan.action) && plan.body.action === 'MANUAL_SCORE' && ['manualHomeScore','manualAwayScore'].some(key => !Number.isInteger(plan.body[key]) || Number(plan.body[key]) < 0)) throw new Error('CLARIFY:Nizoni qo‘lda hal qilish uchun ikkala jamoa hisobini aniq yozing.');
  if (plan.action === 'ai_config') {
    if (!Object.keys(plan.body).some(k => ['enabled','allowedChatId','allowedThreadId','rateLimitUserPerMin','rateLimitTopicPerMin','maxDailyRequests'].includes(k))) throw new Error('CLARIFY:Qaysi AI sozlamasini o‘zgartiray?');
    for (const [key,min,max] of [['rateLimitUserPerMin',1,20],['rateLimitTopicPerMin',1,60],['maxDailyRequests',10,5000]] as const) {
      const n = plan.body[key];
      if (n !== undefined && (!Number.isInteger(n) || Number(n) < min || Number(n) > max)) throw new Error(`CLARIFY:${key} ${min}–${max} orasidagi butun son bo‘lsin.`);
    }
  }
  if (plan.body.homePenaltyScore != null || plan.body.awayPenaltyScore != null) {
    const b=plan.body;
    if (plan.action !== 'result_edit' || b.homeScore !== b.awayScore || ![b.homePenaltyScore,b.awayPenaltyScore].every(n=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<=99) || b.homePenaltyScore===b.awayPenaltyScore) throw new Error('CLARIFY:Penalti faqat durang kubok natijasi uchun, ikkala tomon va g‘olib bilan kiritiladi.');
  }
  if(plan.action==='discipline_issue'&&(!['YELLOW','RED'].includes(String(plan.body.color))||!['ABUSE','DELAY','NO_SHOW','OTHER'].includes(String(plan.body.reason))||typeof plan.body.note!=='string'||plan.body.note.trim().length<3))throw new Error('CLARIFY:Kartochka rangi va aniq sababini yozing.');
  if(plan.action==='discipline_revoke'&&(!plan.secondaryId||typeof plan.body.reason!=='string'||plan.body.reason.trim().length<3))throw new Error('CLARIFY:Qaysi kartochka va bekor qilish sababini yozing.');
  if(plan.action==='admission_league'&&(typeof plan.body.open!=='boolean'||!Object.hasOwn(plan.body,'expectedRevision')))throw new Error('CLARIFY:Klub tanlash uchun joriy holat va ochish/yopishni aniqlang.');
  if(plan.action==='fixture_schedule'&&(!Array.isArray(plan.body.expected)||!plan.body.expected.length||!Object.hasOwn(plan.body,'scheduledAt')))throw new Error('CLARIFY:Avval o‘yinlar vaqtini oldindan ko‘rish kerak.');
  const missing = (required[plan.action] || []).filter(key => plan.body[key] === undefined || plan.body[key] === null || plan.body[key] === '');
  if (missing.length) throw new Error('CLARIFY:Reja uchun quyidagini aniqlang: ' + missing.map(k => names[k] || k).join(', ') + '.');
  for (const key of ['homeScore','awayScore','matchday','roundNumber']) if (plan.body[key] !== undefined && (!Number.isInteger(plan.body[key]) || Number(plan.body[key]) < (key.includes('Score') ? 0 : 1))) throw new Error('CLARIFY:' + (names[key] || key) + ' uchun to‘g‘ri butun son yozing.');
  for (const key of ['isAdmin','isSuspended','visible','enabled']) if (plan.body[key] !== undefined && typeof plan.body[key] !== 'boolean') throw new Error('CLARIFY:' + (names[key] || key) + ' holatini aniq belgilang.');
  if (plan.action === 'matchday_remind' && plan.body.fromMatchday !== undefined && (!Number.isInteger(plan.body.fromMatchday) || Number(plan.body.fromMatchday) < 1 || Number(plan.body.fromMatchday) > Number(plan.body.matchday))) throw new Error('CLARIFY:Eslatma tur oralig‘i noto‘g‘ri.');
  if (plan.action === 'user_role' && plan.body.isAdmin === true) {
    const p = plan.body.adminPermissions as any;
    if (!p || !['ALL','LEAGUES'].includes(p.scope) || !Array.isArray(p.leagueIds) || p.scope === 'LEAGUES' && !p.leagueIds.length)
      throw new Error('CLARIFY:Admin qaysi liga yoki ligalarni boshqarsin?');
  }
}

/** Model plans must use real cached public IDs; private IDs must be explicit or resolved by the protected record tool. */
export async function validateModelAdminPlan(plan: AdminPlan, request: string, signal: AbortSignal, verifiedTargets: ReadonlySet<string> = new Set()) {
  assertAdminPlanReady(plan);
  const q = normalizeAiEntity(request);
  if (plan.action === 'fixture_delete' && /\b(?:natija\w*|hisob\w*)\b/.test(q)) throw new Error('CLARIFY:Faqat natijani o‘chirasizmi yoki uchrashuvning o‘zini? Natija o‘chirilsa uchrashuv saqlanadi.');
  if (plan.action === 'user_role' && (plan.body.adminPermissions as any)?.scope === 'ALL' && !/barcha|hamma|asosiy admin/.test(q))
    throw new Error('CLARIFY:Admin qaysi ligalarni boshqarsin? Barcha ruxsatlarni o‘zimizdan qo‘shmayman.');
  for (const token of ['drawSeed','previewToken']) if (plan.body[token] && !request.includes(String(plan.body[token])))
    throw new Error('CLARIFY:Avval admin panelda oldindan ko‘rishni bajaring va server bergan kodni yuboring: ' + (names[token] || token) + '.');
  const reader = createAiTournamentReader(signal);
  const check = async (id: string, dataset: 'clubs'|'competitions'|'fixtures') => {
    const found: any = await reader.read({ dataset, ...(dataset === 'clubs' ? {club:id} : dataset === 'competitions' ? {competition:id} : {fixtureId:id}), limit:30 });
    if (!(found.data || []).some((row:any) => row.id === id)) throw new Error('CLARIFY:So‘ralgan ' + ({clubs:'klub',competitions:'turnir',fixtures:'o‘yin'})[dataset] + ' bazada aniq topilmadi. Nom, tur/bosqich yoki IDni aniqlashtiring.');
  };
  if (plan.targetId) {
    if (/^club_/.test(plan.action)) await check(plan.targetId, 'clubs');
    else if (/^(?:fixture_|result_|cup_winner)/.test(plan.action)) await check(plan.targetId, 'fixtures');
    else if (/^(?:matchday_|cup_|standings_)/.test(plan.action)) await check(plan.targetId, 'competitions');
    else if (!request.includes(plan.targetId) && !verifiedTargets.has(`${plan.action}:${plan.targetId}`)) throw new Error('CLARIFY:Bu yopiq ma’lumot uchun aniq IDni yozing; uni taxmin qilmayman.');
  }
  if (plan.action === 'matchday_remind' && (plan.body.fixtureIds !== undefined || plan.body.fromMatchday !== (/\b\d{1,3}\s*turgacha\b/.test(q) ? 1 : undefined))) throw new Error('CLARIFY:Eslatma doirasi siz yozgan so‘rovga mos kelmadi.');
  if (plan.targetId && plan.action.startsWith('matchday_')) {
    const competitions:any = await reader.read({dataset:'competitions',limit:30});
    if (competitions.error || competitions.complete === false || competitions.nextOffset) throw new Error('CLARIFY:Turnirlar holati to‘liq o‘qilmadi.');
    const named = findConversationCompetitions(request, competitions.data || []);
    const round = requestedMatchday(request);
    if (named.length !== 1 || named[0].id !== plan.targetId || round && Number(plan.body.matchday ?? plan.body.currentMatchday) !== round)
      throw new Error('CLARIFY:Rejadagi liga yoki tur siz yozgan so‘rovga mos kelmadi. Turnir va turni aniqlashtiring.');
  }
  if (plan.targetId && /^club_|^fixture_|^result_/.test(plan.action)) {
    const roster: any[] = [];
    for (let offset = 0; offset < 300; offset += 30) {
      const page: any = await reader.read({ dataset: 'clubs', offset, limit: 30 });
      if (page.error) throw new Error('CLARIFY:Klublar ro‘yxati o‘qilmadi. Klub yoki o‘yin nomini tekshiring.');
      roster.push(...(page.data || []));
      if (roster.length >= page.total || !page.data?.length) break;
    }
    const selected = resolveAiClubs(request, roster);
    if (selected.clarification) throw new Error('CLARIFY:' + selected.clarification);
    if (/^club_/.test(plan.action) && selected.clubs.length && !selected.clubs.some(club => club.id === plan.targetId))
      throw new Error('CLARIFY:Rejadagi klub siz yozgan klubga mos kelmadi. Klub nomini aniqlashtiring.');
    if (/^fixture_|^result_/.test(plan.action)) {
      const found: any = await reader.read({ dataset: 'fixtures', fixtureId: plan.targetId, limit: 1 });
      const fixture = found.data?.[0];
      const round = requestedMatchday(request);
      const competitions: any = await reader.read({ dataset: 'competitions', limit: 30 });
      if (competitions.error || !Array.isArray(competitions.data)) throw new Error('CLARIFY:Turnirlar manbasi o‘qilmadi. Amal nishonini tekshirib bo‘lmadi.');
      const namedCompetitions = findConversationCompetitions(request, competitions.data);
      const stage = detectAiCupStage(request);
      if (namedCompetitions.length > 1 || namedCompetitions.length === 1 && fixture?.competitionId !== namedCompetitions[0].id || stage && fixture && !fixtureMatchesAiCupStage(fixture, stage))
        throw new Error('CLARIFY:Rejadagi o‘yin siz yozgan turnir yoki bosqichga mos kelmadi. Turnir va bosqichni aniqlashtiring.');
      if (!fixture || selected.clubs.some(club => ![fixture.homeClubId, fixture.awayClubId].includes(club.id)) || round && Number(fixture.matchday) !== round)
        throw new Error('CLARIFY:Rejadagi o‘yin jamoalar yoki turga mos kelmadi. O‘yinni aniqlashtiring.');
    }
  }
  if (['result_edit','result_approve'].includes(plan.action)) {
    const fixtureResult:any = await reader.read({dataset:'fixtures',fixtureId:plan.targetId,limit:1});
    const allClubs:any[] = [];
    for(let offset=0;offset<10000;offset+=30){
      const page:any=await reader.read({dataset:'clubs',offset,limit:30});
      if(page.error || !page.data?.length)throw new Error('CLARIFY:Klublar ro‘yxati to‘liq o‘qilmadi. Hisobni taxmin qilmayman.');
      allClubs.push(...page.data);
      if(allClubs.length >= page.total || page.data.length < 30)break;
    }
    const selected=resolveAiClubs(request,allClubs);
    if(selected.clarification)throw new Error('CLARIFY:'+selected.clarification);
    const score=resolveAdminScore(request,selected.clubs,fixtureResult.data[0]);
    // The language model cannot override score orientation from explicit club names.
    delete plan.body.homePenaltyScore; delete plan.body.awayPenaltyScore; delete plan.body.homeExtraTimeScore; delete plan.body.awayExtraTimeScore;
    Object.assign(plan.body,score);
    if ((score.homePenaltyScore != null || score.homeExtraTimeScore != null) && plan.action === 'result_approve') { plan.action = 'result_edit'; plan.body.status = 'CONFIRMED'; }
  }
  if (plan.body.competitionId) await check(String(plan.body.competitionId), 'competitions');
  if (plan.secondaryId) {
    if(plan.action.startsWith('custom_')) {if(!request.includes(plan.secondaryId))throw new Error('CLARIFY:Turnirdagi aniq o‘yin yoki ishtirokchi IDni yozing.');}
    else await check(plan.secondaryId, 'fixtures');
  }
  if (AI_ADMIN_ACTIONS[plan.action].method === 'GET') return;
  // Batch reset/migration and season transitions need an explicit request, never a guessed repair.
  if (['fixtures_reset','migrate','season_archive','season_rollover'].includes(plan.action) && !/reset|barcha.*ochir|migratsiya|migrate|arxiv|keyingi mavsum|yangi mavsum/.test(q))
    throw new Error('CLARIFY:Bu keng o‘zgarish uchun amalni aniq yozing va admin paneldagi holatni tekshiring.');
}
