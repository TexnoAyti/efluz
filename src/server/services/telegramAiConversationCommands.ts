import { detectNaturalAdminAction, assertSingleNaturalAdminRequest } from './telegramAiAdminLanguage';
import { normalizeAiEntity, resolveAiClubs } from './telegramAiEntities';
import { createAiTournamentReader, matchesAiCompetition } from './telegramAiDataService';
import { detectAiCupStage } from './telegramAiCupStage';
import type { Competition, Club } from '../../types';
import type { AdminPlan } from './telegramAiAdminCatalog';

export type ConversationIntent = 'standings'|'fixtures'|'admin'|'confirm'|'cancel'|'help'|'chat';
export function isRemainingFixturesQuestion(text: string): boolean {
  const q = normalizeAiEntity(text);
  return /\b(?:oynalmagan\w*|otkazilmagan\w*|yakunlanmagan\w*|tugamagan\w*|unplayed|unfinished)\b/.test(q) ||
    /\b(?:oyin\w*|uchrashuv\w*|match\w*|fixtures)\b/.test(q) && /\b(?:qoldi\w*|qolgan\w*|qolib ket\w*|remaining|hali oynal\w*)\b/.test(q);
}
export function getConversationIntent(text: string): ConversationIntent {
  const q = normalizeAiEntity(text);
  if (/^(?:tasdiqlayman|tasdiqla|bajar|bajaring|ha bajar|xa bajar)$/.test(q)) return 'confirm';
  if (/^(?:bekor qil|bekor qiling|bekor qilish|cancel)$/.test(q)) return 'cancel';
  if (/^(?:yordam|buyruqlar|nima qila olasan|help)$/.test(q)) return 'help';
  if (/\b(?:nechanchi|qaysi\s+orinda|nima\s+uchun|nega|tahlil|taxmin|kim\s+yutadi)\b/.test(q)) return 'chat';
  if (detectNaturalAdminAction(text)) return 'admin';
  if (isSimpleConversationClubAssignmentRequest(text)) return 'admin';
  if (isRemainingFixturesQuestion(text)) return 'fixtures';
  const nouns = /\b(?:liga\w*|tur\w*|matchday|natija\w*|hisob\w*|oyin\w*|uchrashuv\w*|klub\w*|jamoa\w*|admin\w*|premium|xabarnoma\w*|xabar\w*|qura\w*|kubok\w*|mavsum\w*|deadline|muddat\w*)\b/;
  const writes = /\b(?:qulfla(?:ng)?|yop(?:ing)?|och(?:ing)?|ochib ber|ochir(?:ing)?|olib tashla(?:ng)?|biriktir(?:ing)?|biriktirib ber|tasdiqla(?:ng)?|rad et(?:ing)?|qayta boshla(?:ng)?|uzaytir(?:ing)?|blokla(?:ng)?|blokdan chiqar(?:ing)?|jonat(?:ing)?|yubor(?:ing)?|generatsiya qil|qura tashla|admin qil|premium ber)\b/;
  if (/\b\d{1,2}\s*[:\-]\s*\d{1,2}\s+(?:qil|qiling|qoy|qoying|saqla)\b/.test(q)) return 'admin';
  const destructive = /\b(?:ochir(?:ing)?|qulfla(?:ng)?|yop(?:ing)?|biriktir(?:ing)?|tasdiqla(?:ng)?|rad et|blokla(?:ng)?)\b/.test(q);
  if ((nouns.test(q) || /\b(?:biriktir(?:ing)?|blokla(?:ng)?|blokdan chiqar(?:ing)?|admin qil|premium ber)\b/.test(q)) && writes.test(q) && !(/\b(?:jadval\w*|table|standings|oyinlar\w*|uchrashuvlar\w*)\b/.test(q) && !destructive)) return 'admin';
  if (/\b(?:jadval\w*|table|standings|tablica|таблица)\b/.test(q))
    return /\b(?:oyinlar\w*|uchrashuvlar\w*|fixtures|matchday|tur(?:ni|dagi|da)?)\b/.test(q) || detectAiCupStage(text) ? 'fixtures' : 'standings';
  if (/\b(?:osha|shu)\s+(?:oyin|uchrashuv)\w*\b/.test(q) && /korsat|tashla|ber/.test(q))return 'fixtures';
  if (/\b(?:oyinlar\w*|uchrashuvlar\w*|fixtures|schedule|taqvim\w*)\b/.test(q) && /\b(?:tashla\w*|yubor\w*|korsat\w*|ber|chiqar\w*)\b/.test(q)) return 'fixtures';
  if (/^\/(?:jadval|table|standings)\b/i.test(text)) return 'standings';
  if (/^\/(?:matches|fixtures|matchday)\b/i.test(text)) return 'fixtures';
  // Route unfamiliar action phrasing to the grounded semantic planner. This
  // only selects planning; it cannot grant authority or execute a mutation.
  if (!/\b(?:hazil|roast|taktika\w*|maslahat\w*)\b/.test(q) &&
      /@|\b(?:bola\w*|akkaunt\w*|foydalanuvchi\w*|user|owner|club|team|score|round|match|klub\w*|jamoa\w*|liga\w*|tur\w*|natija\w*|hisob\w*|oyin\w*|admin\w*|premium\w*|команд\w*|игрок\w*|матч\w*)\b/.test(text.toLowerCase()) &&
      (/\b(?:yoz\w*|tayinla\w*|ber\w*|ula\w*|otkaz\w*|almashtir\w*|tuzat\w*|saqla\w*|kirit\w*|qil\w*|assign|release|remove|delete|update|set|change|give)\b/.test(q) || /(?:^|\s)(?:назнач|удал|убер|освобод|постав|измени)[\p{L}]*/u.test(q))) return 'admin';
  return 'chat';
}
export const requestedMatchday = (text: string): number|undefined => {
  const m = normalizeAiEntity(text).match(/\b(\d{1,3})\s*(?:tur(?:ni|ga|da|dagi)?|matchday)\b|\b(?:tur|matchday)\s*(\d{1,3})\b/);
  return m ? Number(m[1] || m[2]) : undefined;
};
const countries: Record<string, string> = { angliya: 'comp-premier-league-', ispaniya: 'comp-la-liga-', italiya: 'comp-serie-a-', germaniya: 'comp-bundesliga-', fransiya: 'comp-ligue-1-' };
export function findConversationCompetitions(text: string, comps: Competition[]): Competition[] {
  const named = comps.filter(c => matchesAiCompetition(text, c));
  if (named.length) return named;
  const q = normalizeAiEntity(text);
  return comps.filter(c => c.type === 'LEAGUE' && Object.entries(countries).some(([word, prefix]) => c.id.startsWith(prefix) && new RegExp(`\\b${word}\\b`).test(q)));
}
export interface ConversationScope { previousUserQueries?: string[]; selectedClubIds?: string[]; selectedCompetitionIds?: string[]; selectedFixtureIds?: string[]; }
export async function resolveConversationCompetition(text: string, scope: ConversationScope, signal?: AbortSignal) {
  const reader = createAiTournamentReader(signal);
  const catalog: any = await reader.read({ dataset: 'competitions', limit: 30 });
  const comps = (catalog.data || []) as Competition[];
  let found = findConversationCompetitions(text, comps);
  let clarification:string|undefined;
  let clubIds:string[]=[];
  if(!found.length){
    const page:any=await reader.read({dataset:'clubs',limit:30});
    const all:Club[]=[...(page.data||[])];
    for(let offset=30;offset<(page.total||0);offset+=30)all.push(...((await reader.read({dataset:'clubs',offset,limit:30}) as any).data||[]));
    const explicit=resolveAiClubs(text,all);
    clarification=explicit.clarification;
    clubIds=explicit.clubs.map(c=>c.id);
    if(explicit.clubs.length)found=comps.filter(c=>c.type==='LEAGUE'&&explicit.clubs.some(club=>club.leagueId===c.leagueId));
    const prefix=normalizeAiEntity(text).match(/^(.*?)\s+(?:liga\w*|kubok\w*)\b/);
    if(explicit.clubs.length&&!found.length&&!clarification)clarification='Bu klubning ligasi joriy snapshotda aniqlanmadi. Boshqa ligaga o‘tib ketmayman.';
    if(!found.length&&!clarification&&prefix&&prefix[1].split(' ').some(word=>!/^(?:shu|osha|uning|bu|endi|jadval|jadvalni)$/.test(word)))clarification='Qaysi liga yoki kubok? Bu nom joriy bazada aniqlanmadi.';
    if(!found.length&&!clarification){
      if(scope.selectedCompetitionIds!==undefined)found=comps.filter(c=>scope.selectedCompetitionIds!.includes(c.id));
      else for(const previous of [...(scope.previousUserQueries||[])].reverse()){
        found=findConversationCompetitions(previous,comps);if(found.length)break;
      }
      if(found.length)clubIds=all.filter(c=>(scope.selectedClubIds||[]).includes(c.id)&&found.some(comp=>comp.leagueId===c.leagueId)).map(c=>c.id);
      if(!found.length){
        const selected=resolveAiClubs(text,all,scope.selectedClubIds,scope.previousUserQueries);
        clarification=selected.clarification;
        clubIds=selected.clubs.map(c=>c.id);
        found=comps.filter(c=>c.type==='LEAGUE'&&selected.clubs.some(club=>c.leagueId===club.leagueId));
      }
    }
  }
  return { reader, catalog, competitions: found, clarification, clubIds };
}

/** Exact table/list formatting, no Gemini call and no Firestore reads. */
export async function buildConversationTableReply(text: string, intent: 'standings'|'fixtures', scope: ConversationScope, signal?: AbortSignal): Promise<{ text: string; competitionIds: string[]; fixtureIds?:string[]; clubIds?:string[] }> {
  const resolved = await resolveConversationCompetition(text, scope, signal);
  const { reader, catalog } = resolved;
  if(resolved.clarification)return {text:resolved.clarification,competitionIds:[],fixtureIds:[]};
  if(intent==='fixtures' && /^(?:endi\s+)?(?:osha|shu)\s+(?:oyin|uchrashuv)\w*\s+(?:korsat\w*|tashla\w*|ber)$/.test(normalizeAiEntity(text))){
    const ids=[...new Set(scope.selectedFixtureIds||[])];
    if(ids.length!==1)return {text:'Qaysi o‘yin? Jamoalar va turni yozing.',competitionIds:[],fixtureIds:[]};
    const f:any=await reader.read({dataset:'fixtures',fixtureId:ids[0],limit:1});
    if(f.error||f.data?.length!==1)return {text:'Oldingi o‘yin hozir bazada aniqlanmadi. Jamoalar va turni qayta yozing.',competitionIds:[],fixtureIds:[]};
    const row=f.data[0];
    return {text:`${row.home} ${row.homeScore!==null?row.homeScore+':'+row.awayScore:'—'} ${row.away} · ${row.competition} · ${row.roundName||row.matchday+'-tur'} · ${row.status}${f.stale?'\nOxirgi saqlangan ma’lumot.':''}`,competitionIds:[row.competitionId],fixtureIds:[row.id],clubIds:[row.homeClubId,row.awayClubId].filter(Boolean)};
  }
  let competitions = resolved.competitions;
  if (intent === 'standings' && competitions.length > 1 && !findConversationCompetitions(text, catalog.data || []).length) { const league = competitions.filter(c => c.type === 'LEAGUE'); if (league.length === 1) competitions = league; }
  const ids = competitions.map(c => c.id);
  if (!catalog.data?.length) return { text: 'Musobaqalar jadvali hozir o‘qilmadi. Qayta urinib ko‘ring.', competitionIds: [] };
  if (competitions.length !== 1) return { text: competitions.length ? 'Qaysi birining jadvalini yuboray: ' + competitions.map(c => c.name).join(', ') + '?' : 'Qaysi liga yoki kubok jadvalini yuboray? Masalan: “La Liga jadvalini tashla”.', competitionIds: [] };
  const comp = competitions[0];
  if (intent === 'fixtures' && isRemainingFixturesQuestion(text)) {
    const round = requestedMatchday(text);
    const allSeason = /\b(?:butun mavsum|mavsum boyicha|barcha turlar|all season)\b/.test(normalizeAiEntity(text));
    const upper = round || (allSeason ? undefined : comp.currentMatchday);
    if (!allSeason && (!Number.isInteger(upper) || upper! < 1 || upper! > 100))
      return { text: `${comp.name}: joriy tur aniqlanmadi. Qaysi turgacha bo‘lgan o‘yinlarni ko‘rsatishim kerak?`, competitionIds: ids };
    const query = { dataset: 'fixtures', competition: comp.id, fixtureState: 'unfinished', ...(round ? { matchday: round } : upper ? { matchdayTo: upper } : {}), limit: 30 };
    const result: any = await reader.read(query);
    if (result.error) return { text: `${comp.name}: o‘yinlar ro‘yxatini o‘qib bo‘lmadi.`, competitionIds: ids };
    const games: any[] = [...(result.data || [])];
    let next = result.nextOffset;
    while (Number.isInteger(next) && games.length < 1000) {
      const page: any = await reader.read({ ...query, offset: next });
      if (page.error || page.offset !== next || !page.data?.length) { result.complete = false; break; }
      games.push(...page.data); result.stale ||= page.stale; result.complete &&= page.complete; next = page.nextOffset;
    }
    if (Number.isInteger(next)) result.complete = false;
    const unplayed = games.filter(f => ['SCHEDULED', 'POSTPONED'].includes(f.status));
    const pending = games.filter(f => f.status === 'PENDING_CONFIRMATION');
    const disputed = games.filter(f => f.status === 'DISPUTED');
    const range = round ? `${round}-tur` : allSeason ? 'butun mavsum' : `1–${upper}-turlar, joriy turgacha`;
    const sections = [
      { title: 'O‘ynalmagan', rows: unplayed },
      { title: 'Natijasi tasdiq kutilmoqda', rows: pending },
      { title: 'Natijasi bahsli', rows: disputed },
      { title: 'Boshqa yakunlanmagan holat', rows: games.filter(f => !['SCHEDULED', 'POSTPONED', 'PENDING_CONFIRMATION', 'DISPUTED'].includes(f.status)) },
    ];
    let body = `${comp.name} — ${range}\nO‘ynalmagan: ${unplayed.length} ta${!result.complete ? ' (mavjud nusxada)' : ''}. Tasdiq kutilmoqda: ${pending.length} ta. Bahsli: ${disputed.length} ta.\n`;
    let shown = 0;
    for (const section of sections) {
      if (!section.rows.length) continue;
      body += `\n${section.title}:\n`;
      for (const f of section.rows) {
        const line = `${f.matchday}-tur: ${f.home} — ${f.away}${f.status === 'POSTPONED' ? ' (qoldirilgan)' : ''}\n`;
        if (body.length + line.length > 3400) break;
        body += line; shown++;
      }
    }
    if (!games.length) body += result.complete ? '\nBu oraliqda yakunlanmagan o‘yin qolmagan.' : '\nSaqlangan nusxada o‘yin topilmadi; hammasi o‘ynalgan deb tasdiqlay olmayman.';
    if (shown < games.length) body += `\nJuftliklardan ${shown}/${games.length} tasi ko‘rsatildi. To‘liqroq ro‘yxat uchun tur raqamini yozing.`;
    if (!result.complete) body += '\nO‘yinlar manbasi to‘liq o‘qilmadi; ro‘yxat to‘liq bo‘lmasligi mumkin.';
    if (result.stale) body += '\nOxirgi saqlangan ma’lumot; joriy holat qayta tekshirilmagan.';
    return { text: body.trim(), competitionIds: ids, fixtureIds: [], clubIds: [] };
  }
  const standings = intent === 'standings' && ['LEAGUE', 'EUROPEAN_LEAGUE_PHASE'].includes(comp.type);
  const round = requestedMatchday(text), stage = detectAiCupStage(text);
  const query = standings ? { dataset: 'standings', competition: comp.id, limit: 30 } : { dataset: 'fixtures', competition: comp.id, matchday: round ?? (stage ? undefined : comp.currentMatchday), stage: stage || undefined, limit: 30 };
  const result: any = await reader.read(query);
  if (result.error) return { text: 'Bu jadvalni o‘qib bo‘lmadi. Liga yoki kubok nomini aniqroq yozing.', competitionIds: ids };
  if (!result.data?.length) return { text: `${comp.name}: ${standings ? 'turnir jadvali' : 'so‘ralgan o‘yinlar'} saqlangan ma’lumotda topilmadi.`, competitionIds: ids };
  if (standings) for (let offset = result.data.length; offset < result.total && offset < 100; offset += 30) { const page: any = await reader.read({ ...query, offset }); result.data.push(...(page.data || [])); }
  const lines = standings ? result.data.map((r: any) => `${r.position}. ${r.clubName} — ${r.points} ochko | O‘:${r.played} | TF:${r.goalDifference > 0 ? '+' : ''}${r.goalDifference}`)
    : result.data.map((f: any) => `${f.home} ${f.homeScore !== null && f.awayScore !== null ? `${f.homeScore}:${f.awayScore}` : '—'} ${f.away}${f.roundName ? ' · ' + f.roundName : ' · ' + f.matchday + '-tur'}${f.status === 'CONFIRMED' ? '' : ' · ' + (({SCHEDULED:'rejalashtirilgan',POSTPONED:'qoldirilgan',DISPUTED:'bahsli',PENDING_CONFIRMATION:'tasdiq kutilmoqda'} as any)[f.status] || f.status)}`);
  const header = `${comp.name} — ${standings ? 'turnir jadvali' : round ? round + '-tur' : 'uchrashuvlar'}\n`;
  let body = header;
  let shown = 0;
  for (const line of lines) { if (body.length + line.length > 3600) break; body += line + '\n'; shown++; }
  if (shown < result.total) body += `\n${shown}/${result.total} ta ko‘rsatildi. Aniq tur yoki bosqichni yozing.\n`;
  if (result.stale) body += '\nOxirgi saqlangan ma’lumot; joriy holat qayta tekshirilmagan.';
  return { text: body.trim(), competitionIds: ids, clubIds:resolved.clubIds, fixtureIds:!standings&&result.total===1?[result.data[0].id]:[] };
}

/** Common matchday commands work without the model; ambiguous requests ask one question. */
export async function parseConversationMatchdayPlan(text: string, scope: ConversationScope, signal?: AbortSignal): Promise<AdminPlan|null> {
  const q = normalizeAiEntity(text);
  const action = /\b(?:qulfla(?:ng)?|yop(?:ing)?)\b/.test(q) ? 'LOCK' : /\b(?:och(?:ing)?|ochib ber)\b/.test(q) ? 'OPEN' : /\buzaytir(?:ing)?\b/.test(q) ? 'EXTEND' : /\bqayta boshla(?:ng)?\b/.test(q) ? 'RESTART' : null;
  if (!action || !/\btur\w*\b|matchday/.test(q)) return null;
  const round = requestedMatchday(text);
  if (!round || round > 100) throw new Error('CLARIFY:Qaysi turni boshqaray? Tur raqamini yozing.');
  const { competitions } = await resolveConversationCompetition(text, {}, signal);
  if (competitions.length !== 1) throw new Error('CLARIFY:Qaysi liga yoki kubok? Masalan: “La Liga 10-turni qulflang”.');
  const hours = q.match(/\b(\d+)\s*soat(?:ga)?\b/);
  if (action === 'EXTEND' && (!hours || Number(hours[1]) < 1)) throw new Error('CLARIFY:Necha soatga uzaytiray? Masalan: “La Liga 10-turni 24 soatga uzaytir”.');
  const comp = competitions[0];
  if (!['LEAGUE', 'EUROPEAN_LEAGUE_PHASE'].includes(comp.type) && ['OPEN','LOCK'].includes(action)) return { action: 'cup_round', targetId: comp.id, body: { roundNumber: round, action } };
  return { action: 'matchday_control', targetId: comp.id, body: { action, matchday: round, ...(hours ? { durationHours: Number(hours[1]) } : {}) } };
}

export function isSimpleConversationMatchdayRequest(text: string): boolean { const q = normalizeAiEntity(text); return /\btur\w*\b|matchday/.test(q) && /\b(?:qulfla(?:ng)?|yop(?:ing)?|och(?:ing)?|ochib ber|uzaytir(?:ing)?|qayta boshla(?:ng)?)\b/.test(q); }

/** Owner assignments are exact, single-target plans, never model guesses. */
export function isSimpleConversationClubAssignmentRequest(text: string): boolean {
  return detectNaturalAdminAction(text) === 'club_assign';
}
export function clubAssignmentPlanFromRoster(text: string, clubs: Club[]): AdminPlan|null {
  if (!isSimpleConversationClubAssignmentRequest(text)) return null;
  assertSingleNaturalAdminRequest(text);
  const request = text.replace(/^\/ai_admin(?:@[A-Za-z0-9_]+)?\s*/i, '');
  const mentions = [...request.matchAll(/@\s*([A-Za-z0-9_]+)/g)];
  const ids = [...request.matchAll(/\buser-\d+\b/g)];
  if (mentions.length + ids.length !== 1 || mentions.length && (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(mentions[0][1]) || /[\p{L}\p{N}_-]/u.test(request.charAt(mentions[0].index! + mentions[0][0].length))))
    throw new Error('CLARIFY:Kimga biriktiray? Bitta Telegram @username yozing. Masalan: “@username Heidenheim klubiga biriktir”.');
  // A username such as @inter_fan is not a club name. Never carry an old club into a mutation.
  const query = request.replace(/@\s*[A-Za-z0-9_]+|\buser-\d+\b/g, ' ');
  const q = normalizeAiEntity(query);
  if (/\b(?:ochir(?:ing)?|olib tashla|blokla|admin qil|premium ber|qulfla|yop|och)\b/.test(q))
    throw new Error('CLARIFY:Bir vaqtning o‘zida bitta amalni bajaraylik. Hozir faqat klub biriktirishni yozing.');
  if (!clubs.length) throw new Error('CLARIFY:Klublarning saqlangan ro‘yxati hozir o‘qilmadi. Hech narsa o‘zgarmadi; qayta urinib ko‘ring.');
  const resolved = resolveAiClubs(query, clubs);
  if (resolved.clubs.length !== 1)
    throw new Error('CLARIFY:' + (resolved.clarification || (resolved.clubs.length > 1
      ? 'Qaysi bitta klubni biriktiray: ' + resolved.clubs.map(c => c.name).join(' yoki ') + '?'
      : 'Qaysi klubga biriktiray? Klub nomini yozing. Masalan: “@username Heidenheim klubiga biriktir”.')));
  return { action: 'club_assign', targetId: resolved.clubs[0].id, body: { targetUserId: ids.length ? ids[0][0] : '@' + mentions[0][1] } };
}
export async function parseConversationClubAssignmentPlan(text: string, signal?: AbortSignal): Promise<AdminPlan|null> {
  if (!isSimpleConversationClubAssignmentRequest(text)) return null;
  const reader = createAiTournamentReader(signal);
  const first: any = await reader.read({ dataset: 'clubs', limit: 30 });
  const clubs: Club[] = [...(first.data || [])];
  for (let offset = 30; offset < (first.total || 0); offset += 30)
    clubs.push(...((await reader.read({ dataset: 'clubs', offset, limit: 30 }) as any).data || []));
  return clubAssignmentPlanFromRoster(text, clubs);
}
