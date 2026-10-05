/**
 * Telegram AI Grounding Service
 *
 * Extracts query entities (leagues, clubs, matches) and pulls verified tournament
 * facts from the Redis read-model.
 * Formats exact positions, scores, and standings server-side with stale disclosures.
 */

import { ReadModelKeys, OwnerNeutralClub } from '../readModel/readModelStore';
import { createAiSnapshotReader } from './telegramAiSnapshotReader';
import { matchesAiCompetition } from './telegramAiDataService';
import { filterRetiredFixtures } from './retiredFixtureService';
import { SEED_COMPETITIONS, SEED_CLUBS } from '../db/seed';
import { Competition, StandingsRow, Fixture, Club } from '../../types';
import { sortSeasonFixtures } from '../../lib/fixtureOrder';
import { withSeasonQualificationPolicy } from '../../lib/seasonQualificationPolicy';
import { detectAiCupStage, fixtureMatchesAiCupStage, AI_CUP_STAGE_LABELS, formatAiCupStageFixture } from './telegramAiCupStage';
import { resolveAiClubs, normalizeAiEntity, containsAiEntity } from './telegramAiEntities';
import { communityFacts, communitySmallTalkAnswer, communityFallback } from './telegramAiCommunitySources';

export interface GroundingContext {
  factsSummary: string;
  hasStaleData: boolean;
  detectedClubs: string[];
  detectedCompetitions: string[];
  ownershipAnswer?: string;
  factualAnswer?: string;
  fallbackFacts?: string;
  communityAnswer?: string;
  selectedClubIds: string[];
  dataDiagnostics?: { missingDatasets: string[]; failedDatasets: string[]; durationMs: number; fixturesCount: number };
}

export interface TestGroundingOverride {
  competitions?: Competition[];
  clubs?: OwnerNeutralClub[];
  clubsStale?: boolean;
  standings?: Record<string, StandingsRow[]>;
  fixtures?: Record<string, Fixture[]>;
}

let testGroundingOverride: TestGroundingOverride | null = null;

export function setTestGroundingOverride(override: TestGroundingOverride | null): void {
  testGroundingOverride = override;
}

const DEFAULT_SEASON_ID = 'season-2026-27';

const CORE_RULES_SUMMARY = `EFL UZ — eFootball turniri; real futbol statistikasi bilan aralashtirmang.
- Faqat CONFIRMED natijalar yakuniy. Tasdiqlanmagan hisoblarni aytmang.
- Liga ochkolari musobaqaning formatConfig sozlamalariga bog‘liq.
- Natija ishtirokchilar tomonidan kiritiladi; mos kelmagan natija ko‘rib chiqiladi. Dalil havolasi ixtiyoriy.
- Klub olish imkoniyati foydalanuvchining amaldagi ruxsatiga bog‘liq. Barcha foydalanuvchiga ikkinchi klub va’da qilmang.
- Tur muddati va ochiqligi musobaqa sozlamalaridan olinadi; ma’lumot bo‘lmasa soat yoki deadline to‘qimang.`;

const LEAGUE_KEYWORDS: Record<string, string[]> = {
  'comp-premier-league': ['premier league', 'apl', 'angliya'],
  'comp-la-liga': ['la liga', 'laliga', 'ispaniya'],
  'comp-serie-a': ['serie a', 'italiya'],
  'comp-bundesliga': ['bundesliga', 'germaniya'],
  'comp-ligue-1': ['ligue 1', 'liga 1', 'fransiya'],
  'comp-champions-league': ['champions league', 'chempionlar ligasi', 'ucl', 'yechl'],
  'comp-europa-league': ['europa league', 'yevropa ligasi', 'uel'],
  'comp-fa-cup': ['fa cup', 'angliya kubogi'],
  'comp-copa-del-rey': ['copa del rey', 'ispaniya kubogi'],
  'comp-coppa-italia': ['coppa italia', 'italiya kubogi'],
  'comp-dfb-pokal': ['dfb pokal', 'germaniya kubogi'],
  'comp-coupe-de-france': ['coupe de france', 'fransiya kubogi'],
};

export function isClubOwnershipQuestion(query: string): boolean {
  return /egasi|kimniki|kimga\s+biriktiril|kim\s+boshqar|owner|manager|владел|менеджер|кто\s+(?:играет|управляет)/i.test(query);
}

/** Ownership is formatted by the server; the model never chooses a username. */
function ownershipLine(club: Club, authoritative: boolean, stale: boolean): string {
  const record = club as OwnerNeutralClub;
  if (!authoritative || !Object.prototype.hasOwnProperty.call(record, 'ownerUserId')) {
    return `${club.name}: klub egasi haqida tasdiqlangan ma’lumot yo‘q.`;
  }
  let answer: string;
  if (!record.ownerUserId) {
    answer = `${club.name}: snapshotda klub hech kimga biriktirilmagan.`;
  } else {
    const username = record.ownerUsername?.replace(/^@+/, '').trim();
    const valid = username && /^[a-zA-Z0-9_]{5,32}$/.test(username) && !/^(tg_|user_)/i.test(username);
    answer = valid ? `${club.name} egasi: @${username}.`
      : `${club.name}: klub biriktirilgan, lekin egasining Telegram username’i ko‘rsatilmagan.`;
  }
  return stale ? `${answer} Ma’lumot eski snapshotdan; hozirgi egasi tasdiqlanmagan.` : answer;
}

/** Reads bounded public read models. Never exposes private users, payments or disputes. */
export async function buildAiGroundingContext(
  query: string,
  seasonId = DEFAULT_SEASON_ID,
  options?: { signal?: AbortSignal; previousUserQueries?: string[]; selectedClubIds?: string[]; replyVariation?: number }
): Promise<GroundingContext> {
  let hasStaleData = false;
  const ownerOnly=isClubOwnershipQuestion(query) && !/nechanchi|ochko|o[‘’'`]?rin|natija|forma|statistika|yut|gol|o[‘’'`]?yin|keyingi|navbatdagi|kubok|ucl|uel|tahlil|hazil|qachon|qancha|nega/i.test(query);
  const started=Date.now();
  const reader=createAiSnapshotReader(options?.signal);
  const tombstoneKey=`efluz:v1:season:${seasonId}:fixture-tombstones`;
  if(!testGroundingOverride)await reader.load([ReadModelKeys.competitions(seasonId),ReadModelKeys.clubsWithOwners(seasonId),...(ownerOnly?[]:[ReadModelKeys.adminFixtures(seasonId),tombstoneKey])]);
  const read=<T>(key:string)=>reader.read<T>(key);
  const [compSnapshot, clubSnapshot] = await Promise.all([
    testGroundingOverride?.competitions ? Promise.resolve({ data: testGroundingOverride.competitions, stale: false })
      : read<Competition>(ReadModelKeys.competitions(seasonId)),
    testGroundingOverride?.clubs ? Promise.resolve({ data: testGroundingOverride.clubs, stale: Boolean(testGroundingOverride.clubsStale) })
      : read<OwnerNeutralClub>(ReadModelKeys.clubsWithOwners(seasonId)),
  ]);
  hasStaleData = compSnapshot.stale || clubSnapshot.stale;
  const competitions = (compSnapshot.data.length ? compSnapshot.data : SEED_COMPETITIONS as unknown as Competition[])
    .filter(c => !c.seasonId || c.seasonId === seasonId).map(c => withSeasonQualificationPolicy(c, seasonId));
  const clubs = (clubSnapshot.data.length ? clubSnapshot.data : SEED_CLUBS as unknown as Club[])
    .filter(c => !(c as Club & { seasonId?: string }).seasonId || (c as Club & { seasonId?: string }).seasonId === seasonId);
  const requestedStage=detectAiCupStage(query);
  const finalistQuestion = /finalchi|finalist|finalga\s+(?:kim|qaysi\s+jamoa)|finalga\s+chiq/i.test(query);
  const selection = resolveAiClubs(query, clubs, options?.selectedClubIds, options?.previousUserQueries);
  const matched = selection.clubs;
  if(ownerOnly){
    const answer=selection.clarification || (matched.length ? matched.map(c=>ownershipLine(c,clubSnapshot.data.length>0,clubSnapshot.stale)).join('\n') : 'Qaysi klubning egasini so‘rayapsiz? Klub nomini yozing; tasdiqlangan egasi ma’lumotini tekshiraman.');
    return {factsSummary:CORE_RULES_SUMMARY+'\n'+answer,hasStaleData:clubSnapshot.stale,detectedClubs:matched.map(c=>c.name),detectedCompetitions:[],
      selectedClubIds:selection.clarification?[]:matched.map(c=>c.id),ownershipAnswer:answer,factualAnswer:answer,
      dataDiagnostics:{missingDatasets:reader.missingKeys(),failedDatasets:reader.failedKeys(),durationMs:Date.now()-started,fixturesCount:0}};
  }
  const ids = new Set(matched.map(c => c.id));
  const normalized = normalizeAiEntity(query);
  let explicitCompetitions = competitions.filter(c => matchesAiCompetition(query, c) || containsAiEntity(normalized, c.name) ||
    Object.entries(LEAGUE_KEYWORDS).some(([prefix, words]) => (c.id === prefix || c.id.startsWith(prefix + '-')) &&
      words.some(word => containsAiEntity(normalized, word))));
  if(requestedStage || finalistQuestion){
    explicitCompetitions=explicitCompetitions.filter(c=>c.type!=='LEAGUE');
    if(!explicitCompetitions.length){
      for(const previous of [...(options?.previousUserQueries||[])].reverse()){
        const previousQuery=normalizeAiEntity(previous);
        const found=competitions.filter(c=>c.type!=='LEAGUE' && (containsAiEntity(previousQuery,c.name)||Object.entries(LEAGUE_KEYWORDS).some(([prefix,words])=>(c.id===prefix||c.id.startsWith(prefix+'-'))&&words.some(word=>containsAiEntity(previousQuery,word)))));
        if(found.length){explicitCompetitions=found;break;}
      }
    }
  }
  const isLeagueForClub = (c: Competition, club: Club) => c.type === 'LEAGUE' &&
    (c.id === (club as Club & { competitionId?: string }).competitionId || c.id === club.leagueId || c.leagueId === club.leagueId);
  // The season-wide fixture snapshot also discovers cups and European participation by club ID.
  let seasonFixtures = testGroundingOverride
    ? { data: Object.values(testGroundingOverride.fixtures || {}).flat(), stale: false }
    : await read<Fixture>(ReadModelKeys.adminFixtures(seasonId));
  const related=competitions.filter(c=>explicitCompetitions.some(e=>e.id===c.id) || matched.some(club=>c.leagueId===club.leagueId || isLeagueForClub(c,club)) ||
    matched.length && (c.type==='EUROPEAN_LEAGUE_PHASE'||c.type==='EUROPEAN_KNOCKOUT') || /barcha|hamma|turnirlar|ligalar|chempionatlar/i.test(query));
  if(!testGroundingOverride){
    await reader.load(related.flatMap(c=>[ReadModelKeys.competitionFixtures(c.id,seasonId),...(['LEAGUE','EUROPEAN_LEAGUE_PHASE'].includes(c.type)?[ReadModelKeys.standings(c.id,seasonId)]:[])]));
    const admin=await read<Fixture>(ReadModelKeys.adminFixtures(seasonId));
    for(const comp of related){
      const cached=await read<Fixture>(ReadModelKeys.competitionFixtures(comp.id,seasonId));
      const adminHas=seasonFixtures.data.some(f=>f.competitionId===comp.id);
      if(cached.available && (!adminHas || (Date.parse(cached.snapshotAt)||0)>=(Date.parse(admin.snapshotAt)||0))){
        seasonFixtures={data:[...seasonFixtures.data.filter(f=>f.competitionId!==comp.id),...cached.data.filter(f=>f.competitionId===comp.id)],stale:seasonFixtures.stale||cached.stale};
      }
    }
    const tombstones=await read<{fixtureId:string;restoredAt?:string}>(tombstoneKey);
    const deleted=new Set(tombstones.data.filter(t=>!t.restoredAt).map(t=>t.fixtureId));
    seasonFixtures.data=filterRetiredFixtures(seasonFixtures.data.filter(f=>!deleted.has(f.id)),seasonId);
  }
  const validFixtures = seasonFixtures.data.filter(f => (!f.seasonId || f.seasonId === seasonId) && f.status !== 'CANCELLED');
  const target = competitions.filter(c => explicitCompetitions.some(e => e.id === c.id) ||
    matched.some(club => isLeagueForClub(c, club)) || explicitCompetitions.some(e=>e.id===c.id) || validFixtures.some(f => f.competitionId === c.id &&
      (ids.has(f.homeClubId || '') || ids.has(f.awayClubId || ''))));
  // No arbitrary top-two league fallback. General league questions can use all public competitions.
  const broad = /barcha|hamma|turnirlar|ligalar|chempionatlar/i.test(query);
  const targets = target.length ? target : matched.length || selection.clarification ? [] : broad ? competitions : explicitCompetitions;
  const overrideRows = <T>(map: Record<string, T[]> | undefined, id: string): T[] => {
    if (!map) return [];
    return map[id] || map[Object.keys(map).find(k => id === k || id.startsWith(k + '-')) || ''] || [];
  };
  const data = await Promise.all(targets.map(async comp => {
    const [table, fixtureSnapshot] = await Promise.all([
      testGroundingOverride ? Promise.resolve({ data: overrideRows(testGroundingOverride.standings, comp.id), stale: false })
        : ['LEAGUE','EUROPEAN_LEAGUE_PHASE'].includes(comp.type) ? read<StandingsRow>(ReadModelKeys.standings(comp.id, seasonId)) : Promise.resolve({data:[] as StandingsRow[],stale:false}),
      testGroundingOverride ? Promise.resolve({ data: overrideRows(testGroundingOverride.fixtures, comp.id), stale: false })
        : Promise.resolve({ data: validFixtures.filter(f => f.competitionId === comp.id), stale: seasonFixtures.stale }),
    ]);
    const fixtures = fixtureSnapshot.data.filter(f => (!f.seasonId || f.seasonId === seasonId) && f.status !== 'CANCELLED');
    return { comp, rows: table.data, fixtures, stale: table.stale || fixtureSnapshot.stale, fixturesStale: fixtureSnapshot.stale };
  }));
  hasStaleData ||= data.some(d => d.stale);
  const allFixtures = [...new Map(data.flatMap(d => d.fixtures).map(f => [f.id, f])).values()];
  const confirmed = allFixtures.filter(isConfirmedAiFixture).sort(compareConfirmed);
  const clubName = (id: string | null, embedded?: Club | null) => clubs.find(c => c.id === id)?.name || embedded?.name || 'Raqib aniqlanmagan';
  const fixtureLine = (f: Fixture) => `[${f.status}] MD ${f.matchday}: ${clubName(f.homeClubId, f.homeClub)} ${isConfirmedAiFixture(f) ? `${f.homeScore} - ${f.awayScore}` : 'vs'} ${clubName(f.awayClubId, f.awayClub)} (${competitions.find(c => c.id === f.competitionId)?.name || f.competitionId}${f.roundName ? ', ' + f.roundName : ''})${isConfirmedAiFixture(f) && f.winnerClubId ? '; tasdiqlangan g‘olib: ' + clubName(f.winnerClubId) : ''}`;
  const involves = (f: Fixture, id: string) => f.homeClubId === id || f.awayClubId === id ||
    Boolean(clubs.find(c => c.id === id && (normalizeAiEntity(c.name) === normalizeAiEntity(f.homeClub?.name || '') || normalizeAiEntity(c.name) === normalizeAiEntity(f.awayClub?.name || ''))));
  const ownershipLines = matched.map(c => ownershipLine(c, clubSnapshot.data.length > 0, clubSnapshot.stale));
  const sections = [CORE_RULES_SUMMARY, `MAVSUM: ${seasonId}.`, `SUHBATDAGI JAMOALAR: ${matched.map(c => c.name).join(', ') || 'tanlanmagan'}.`];
  let communityAnswer: string | undefined;
  if (!testGroundingOverride) {
    const community = await communityFacts(query, options?.signal);
    if (community) sections.push(community);
    communityAnswer = communityFallback(query, community);
  }
  if (selection.clarification) sections.push('ANIQLASHTIRISH KERAK: ' + selection.clarification);
  if (ownershipLines.length) sections.push('KLUB EGALARI (server faktlari):\n' + ownershipLines.join('\n'));
  const wantsAvailable = /bo[‘’'`]?sh|biriktirilmagan|available|unclaimed/i.test(query);
  if (wantsAvailable) {
    const scope = explicitCompetitions.length ? clubs.filter(c => explicitCompetitions.some(comp => isLeagueForClub(comp, c))) : clubs;
    const free = scope.filter(c => Object.hasOwn(c, 'ownerUserId') && !(c as OwnerNeutralClub).ownerUserId);
    sections.push(clubSnapshot.data.length ? `SNAPSHOTDA BO‘SH KLUBLAR (${free.length}): ${free.map(c => c.name).join(', ') || 'yo‘q'}. Bu ro‘yxat klub olish kafolati emas.` : 'Bo‘sh klublar ro‘yxati tekshirilmagan.');
  }
  for (const { comp, rows, fixtures, fixturesStale } of data) {
    const config = comp.formatConfig || {};
    sections.push(`MUSOBAQA: ${comp.name}; holat: ${comp.status}; joriy tur: ${comp.currentMatchday ?? 'noma’lum'}; tur ochiq: ${comp.isMatchdayOpen === undefined ? 'noma’lum' : comp.isMatchdayOpen ? 'ha' : 'yo‘q'}; muddat: ${comp.matchdayDurationHours ?? 'noma’lum'} soat; keyingi ochilish: ${comp.nextMatchdayOpenAt || 'belgilanmagan'}; ochkolar G/D/M: ${config.pointsForWin ?? 'noma’lum'}/${config.pointsForDraw ?? 'noma’lum'}/${config.pointsForLoss ?? 'noma’lum'}; UCL joy: ${config.qualificationSpots ?? 'noma’lum'}; UEL joy: ${config.europaQualificationSpots ?? 'noma’lum'}.`);
    if(['LEAGUE','EUROPEAN_LEAGUE_PHASE'].includes(comp.type))sections.push(`TURNIR JADVALI (${comp.name}):\n` + (rows.length ? [...rows].sort((a,b) => a.position-b.position).map(r =>
      `${r.position}-o'rin: ${r.clubName} — ${r.points} ochko (O':${r.played}, G':${r.won}, D:${r.drawn}, M:${r.lost}, T/F:${r.goalsFor}-${r.goalsAgainst}, farq:${r.goalDifference})`).join('\n') : 'Jadval ma’lumoti mavjud emas.'));
    if (comp.type === 'LEAGUE' && Number.isInteger(config.qualificationSpots) && Number.isInteger(config.europaQualificationSpots)) {
      sections.push(`${comp.name} saralash zonalari: UCL 1–${config.qualificationSpots}; UEL ${config.qualificationSpots!+1}–${config.qualificationSpots!+config.europaQualificationSpots!}. Bu hozirgi jadval zonasi, mavsum yakunidagi kafolat emas.`);
    }
    for (const club of matched) {
      const clubGames = fixtures.filter(f => involves(f,club.id));
      const results = clubGames.filter(isConfirmedAiFixture).sort(compareConfirmed);
      const pending = sortSeasonFixtures(clubGames.filter(f => f.status !== 'CONFIRMED'));
      sections.push(`MUSOBAQADAGI KLUB (${comp.name}, ${club.name}): ${results.length} tasdiqlangan o‘yin; ${pending.length} yakunlanmagan o‘yin.\n${[...results.slice(-3), ...pending.slice(0,3)].map(fixtureLine).join('\n') || 'uchrashuv ma’lumoti yo‘q'}. Kubokdan chiqish yoki keyingi bosqichga o‘tishni faqat tasdiqlangan g‘olib va bosqich ma’lumotidan aniqlang; yetishmasa taxmin qilmang.`);
    }
    if (fixturesStale) sections.push(`${comp.name} uchrashuvlari eski yoki mavjud emas; joriy natija deb ko‘rsatmang.`);
  }
  for (const club of matched) {
    const games = confirmed.filter(f => involves(f, club.id));
    const form = games.slice(-5).map(f => {
      const delta = f.homeClubId === club.id ? f.homeScore! - f.awayScore! : f.awayScore! - f.homeScore!;
      return delta > 0 ? 'G‘alaba' : delta < 0 ? 'Mag‘lubiyat' : 'Durang';
    });
    const next = sortSeasonFixtures(allFixtures.filter(f => involves(f, club.id) && f.status !== 'CONFIRMED'));
    const gf = games.reduce((n,f) => n + (f.homeClubId === club.id ? f.homeScore! : f.awayScore!), 0);
    const ga = games.reduce((n,f) => n + (f.homeClubId === club.id ? f.awayScore! : f.homeScore!), 0);
    sections.push(`KLUB PROFILI: ${club.name}; barcha mavjud turnirlarda tasdiqlangan o‘yin: ${games.length}; urgan/o‘tkazgan gol: ${gf}/${ga}. Bu yig‘indi faqat yuklangan uchrashuvlardan; liga jadvalini almashtirmaydi.\nOXIRGI FORMA (eskidan yangiga): ${form.join(', ') || 'tasdiqlangan o‘yin yo‘q'}.\nOXIRGI NATIJALAR:\n${games.slice(-5).map(fixtureLine).join('\n') || 'mavjud emas'}\nKEYINGI UCHRASHUVLAR (mavsumning belgilangan ketma-ketligida, ochiq o‘yin degani emas):\n${next.slice(0,3).map(fixtureLine).join('\n') || 'ro‘yxatda topilmadi'}`);
    const margin = (f: Fixture) => f.homeClubId === club.id ? f.homeScore!-f.awayScore! : f.awayScore!-f.homeScore!;
    const sorted = [...games].sort((a,b) => margin(b)-margin(a));
    sections.push(`ENG YIRIK G‘ALABA: ${sorted[0] && margin(sorted[0]) > 0 ? fixtureLine(sorted[0]) : 'tasdiqlangan g‘alaba yo‘q'}; ENG YIRIK MAG‘LUBIYAT: ${sorted.at(-1) && margin(sorted.at(-1)!) < 0 ? fixtureLine(sorted.at(-1)!) : 'tasdiqlangan mag‘lubiyat yo‘q'}.`);
    for (const side of ['home','away'] as const) {
      const sideGames = games.filter(f => side === 'home' ? f.homeClubId === club.id : f.awayClubId === club.id);
      sections.push(`${club.name} ${side === 'home' ? 'UYDA' : 'SAFARDA'}: ${sideGames.length} tasdiqlangan o‘yin; G/D/M: ${sideGames.filter(f => margin(f)>0).length}/${sideGames.filter(f => margin(f)===0).length}/${sideGames.filter(f => margin(f)<0).length}.`);
    }
  }
  if (matched.length === 2) {
    const h2h = confirmed.filter(f => ids.has(f.homeClubId || '') && ids.has(f.awayClubId || ''));
    sections.push(`O‘ZARO UCHRASHUVLAR (${h2h.length} tasdiqlangan):\n${h2h.slice(-10).map(fixtureLine).join('\n') || 'hali tasdiqlangan o‘zaro o‘yin yo‘q'}`);
  }
  if (!matched.length) {
    const round = query.match(/(?:\b(\d{1,2})\s*(?:-\s*)?(?:tur|matchday)\b|(?:tur|matchday)\s*(\d{1,2}))/i);
    const games = requestedStage ? allFixtures.filter(f=>fixtureMatchesAiCupStage(f,requestedStage)) : round ? allFixtures.filter(f => f.matchday === Number(round[1] || round[2])) : confirmed.slice(-10);
    sections.push('UCHRASHUVLAR VA NATIJALAR:\n' + (games.slice(0,25).map(fixtureLine).join('\n') || 'mavjud emas'));
  }
  if (hasStaleData) sections.push('[ESKI YOKI TO‘LIQ EMAS: snapshot joriy holatni tasdiqlamaydi. Har bir tegishli javobda buni ayting. Ma’lumot yo‘qligi o‘yin o‘tkazilmaganini isbotlamaydi.]');
  // A question about losses or a specific round must see more than the last five games.
  const requestedRound = query.match(/(?:\b(\d{1,2})\s*(?:-\s*)?(?:tur|matchday)\b|(?:tur|matchday)\s*(\d{1,2}))/i);
  for (const club of matched) {
    const margin = (f: Fixture) => f.homeClubId === club.id ? f.homeScore! - f.awayScore! : f.awayScore! - f.homeScore!;
    let relevant = allFixtures.filter(f => involves(f,club.id) && (!explicitCompetitions.length || explicitCompetitions.some(c => c.id === f.competitionId)));
    if (requestedRound) relevant = relevant.filter(f => f.matchday === Number(requestedRound[1] || requestedRound[2]));
    else if (/kimga|yutqaz|mag[‘’'`]?lub/i.test(query)) relevant = relevant.filter(f => isConfirmedAiFixture(f) && margin(f)<0);
    else if (/kimni|yutgan|g[‘’'`]?alaba/i.test(query)) relevant = relevant.filter(f => isConfirmedAiFixture(f) && margin(f)>0);
    else continue;
    sections.push(`SAVOLGA MOS UCHRASHUVLAR (${club.name}, ${relevant.length}):\n${relevant.slice(0,30).map(fixtureLine).join('\n') || 'snapshotda topilmadi'}${relevant.length>30 ? '\nFaqat dastlabki 30 ta; qolgan o‘yinlar kiritilmadi.' : ''}`);
  }
  const ownershipAnswer = isClubOwnershipQuestion(query) ? ownershipLines.length ? ownershipLines.join('\n') : selection.clarification || 'Qaysi klubning egasini so‘rayapsiz? Klub nomini yozing; tasdiqlangan egasi ma’lumotini tekshiraman.' : undefined;
  const leagueData = data.filter(d => matched.some(c => isLeagueForClub(d.comp,c)) &&
    (!explicitCompetitions.length || explicitCompetitions.some(c => c.id === d.comp.id)));
  // Finalist questions are factual lookups and must not depend on Gemini availability.
  // A semifinal result can identify one finalist even while the other tie is pending.
  let finalistAnswer: string | undefined;
  if (finalistQuestion) {
    const cupData = data.filter(d => d.comp.type !== 'LEAGUE' &&
      (explicitCompetitions.length ? explicitCompetitions.some(c => c.id === d.comp.id) : true));
    const lines = cupData.flatMap(({ comp, fixtures }) => {
      const semi = fixtures.filter(f => fixtureMatchesAiCupStage(f, 'semi') && isConfirmedAiFixture(f));
      const winners = semi.map(f => {
        if (f.winnerClubId && [f.homeClubId, f.awayClubId].includes(f.winnerClubId)) return { fixture: f, clubId: f.winnerClubId };
        if (f.homeScore! === f.awayScore!) return null;
        return { fixture: f, clubId: f.homeScore! > f.awayScore! ? f.homeClubId : f.awayClubId };
      }).filter((x): x is { fixture: Fixture; clubId: string | null } => Boolean(x?.clubId));
      if (!winners.length) return [];
      const names = winners.map(({ fixture, clubId }) => clubName(clubId, clubId === fixture.homeClubId ? fixture.homeClub : fixture.awayClub));
      return [`${comp.name}: aniqlangan finalchilar — ${[...new Set(names)].join(', ')}. ${names.length === 1 ? 'Snapshotda bitta finalchi tasdiqlangan.' : ''}`];
    });
    finalistAnswer = !cupData.length ? 'Qaysi kubok? Kubok nomini yozing.' : lines.length ? lines.join('\n') : 'Snapshotda tasdiqlangan yarim final g‘olibi topilmadi; hozirgi finalchini tasdiqlay olmayman.';
    if (hasStaleData && cupData.length) finalistAnswer += '\nOxirgi saqlangan ma’lumot bo‘yicha; joriy holat qayta tekshirilmagan.';
  }
  let stageAnswer:string|undefined;
  if(requestedStage){
    const requestedCups=explicitCompetitions.length?explicitCompetitions:targets.filter(c=>c.type!=='LEAGUE');
    const stageSections=requestedCups.map(comp=>{
      // An explicit cup-stage query covers the complete stage, regardless of an older selected team.
      const games=allFixtures.filter(f=>f.competitionId===comp.id&&fixtureMatchesAiCupStage(f,requestedStage)).sort((a,b)=>a.id.localeCompare(b.id));
      return `${comp.name} — ${AI_CUP_STAGE_LABELS[requestedStage]}:\n${games.length?games.map(f=>formatAiCupStageFixture(f,clubName)).join('\n'):'Bu bosqich o‘yinlari olingan snapshotda topilmadi; bu jadval hali yaratilmaganini isbotlamaydi.'}`;
    });
    if(!stageSections.length)stageSections.push(`Qaysi kubokning ${AI_CUP_STAGE_LABELS[requestedStage].toLowerCase()} bosqichini so‘rayapsiz? Kubok nomini yozing.`);
    sections.push('SO‘RALGAN BOSQICH (SCHEDULED ham jadvalda mavjud o‘yin):\n'+stageSections.join('\n\n'));
    stageAnswer=stageSections.join('\n\n')+(hasStaleData&&requestedCups.length?'\nOxirgi saqlangan jadval bo‘yicha; joriy holat qayta tekshirilmagan.':'');
  }
  const facts: string[] = [];
  // Exact identity and simple statistical lookups bypass the model. Analytical questions use grounded Gemini.
  const analytical = /nega|nima uchun|tahlil|o[‘’'`]?ylay|yutadimi|kim yut|yutadi|taxmin|prediction|qanday yaxsh|taktik|hazil|yumor|roast/i.test(query);
  if (!analytical && matched.length) {
    if (ownershipAnswer) facts.push(ownershipAnswer);
    if (!/eng yirik|eng katta|oxirgi|kimga|kimni|uyda|safarda/i.test(query) && /nechanchi|o[‘’'`]?rin|ochko|g[‘’'`]?alaba|mag[‘’'`]?lub|nechta.*(?:durang|gol|o[‘’'`]?yin)|statistika|standing|points|position/i.test(query)) {
      for (const club of matched) for (const {comp,rows,stale} of leagueData) {
        const row = rows.find(r => r.clubId === club.id || normalizeAiEntity(r.clubName) === normalizeAiEntity(club.name));
        if (row) facts.push(`${club.name} (${comp.name}): ${row.position}-o‘rin, ${row.points} ochko. ${row.played} o‘yin: ${row.won} g‘alaba, ${row.drawn} durang, ${row.lost} mag‘lubiyat. Gollar: ${row.goalsFor}:${row.goalsAgainst}, farq ${row.goalDifference}.${stale ? ' Ma’lumot eski snapshotdan; joriy holat tasdiqlanmagan.' : ''}`);
      }
    }
    if (/keyingi|navbatdagi|next match/i.test(query) && !/ochil|qachon/i.test(query)) {
      for (const club of matched) {
        const next = sortSeasonFixtures(allFixtures.filter(f => involves(f,club.id) && f.status !== 'CONFIRMED' && (!explicitCompetitions.length || explicitCompetitions.some(c => c.id === f.competitionId))))[0];
        facts.push(next ? `${club.name} uchun navbatdagi: ${fixtureLine(next)}. Bu mavsum tartibidagi o‘yin; hozir o‘ynash ruxsati tasdiqlanmagan.` : `${club.name}: navbatdagi o‘yin snapshotda topilmadi; jadval to‘liqligi tasdiqlanmagan.`);
      }
    }
  }
  // Bound prompt size at section boundaries, keeping team-specific facts ahead of broad tables.
  const teamSections = sections.filter(s => !s.startsWith('TURNIR JADVALI')).sort((a,b)=>Number(b.startsWith('SO‘RALGAN BOSQICH'))-Number(a.startsWith('SO‘RALGAN BOSQICH')));
  const tableSections = sections.filter(s => s.startsWith('TURNIR JADVALI'));
  let summary = '';
  for (const section of [...teamSections, ...tableSections]) {
    if (summary.length + section.length > 24000) { hasStaleData = true; summary += '\n[Qo‘shimcha faktlar hajm sabab kiritilmadi; yetishmagan faktni taxmin qilmang.]'; break; }
    summary += section + '\n\n';
  }
  const dataDiagnostics={missingDatasets:reader.missingKeys(),failedDatasets:reader.failedKeys(),durationMs:Date.now()-started,fixturesCount:allFixtures.length};
  // Public, server-formatted evidence for provider outages; never send the raw prompt packet.
  const fallbackLines: string[] = [];
  for (const club of matched.slice(0, 2)) {
    for (const { comp, rows } of leagueData) {
      const row = rows.find(r => r.clubId === club.id || normalizeAiEntity(r.clubName) === normalizeAiEntity(club.name));
      if (row) fallbackLines.push(`${club.name} (${comp.name}): ${row.position}-o‘rin, ${row.points} ochko; ${row.played} o‘yin, ${row.won} g‘alaba, ${row.drawn} durang, ${row.lost} mag‘lubiyat.`);
    }
    const last = confirmed.filter(f => involves(f, club.id)).at(-1);
    if (last) fallbackLines.push(`Oxirgi tasdiqlangan natija: ${fixtureLine(last)}.`);
  }
  const fallbackBody = stageAnswer || (fallbackLines.length ? fallbackLines.join('\n') : undefined);
  const fallbackFacts = fallbackBody ? (hasStaleData ? 'Oxirgi saqlangan ma’lumot; joriy holat qayta tasdiqlanmagan.\n' : '') + fallbackBody : undefined;
  if(!testGroundingOverride)console.info('[AI_GROUNDING]',JSON.stringify({durationMs:dataDiagnostics.durationMs,clubs:matched.length,competitions:targets.length,fixtures:allFixtures.length,missing:dataDiagnostics.missingDatasets.length,failed:dataDiagnostics.failedDatasets.length}));
  return { dataDiagnostics, factsSummary: summary, fallbackFacts, communityAnswer, hasStaleData, detectedClubs: matched.map(c => c.name),
    selectedClubIds: selection.clarification ? [] : matched.length ? matched.map(c => c.id) : options?.selectedClubIds || [], detectedCompetitions: targets.map(c => c.id),
    ownershipAnswer, factualAnswer: communitySmallTalkAnswer(query, options?.replyVariation) || selection.clarification || finalistAnswer || (!analytical && stageAnswer ? stageAnswer : undefined) || (facts.length ? facts.join('\n') + (hasStaleData && !(facts.length === 1 && facts[0] === ownershipAnswer) && !facts.some(f => /eski snapshot/.test(f)) ? '\nMa’lumot eski yoki to‘liq bo‘lmagan snapshotdan; joriy holat tasdiqlanmagan.' : '') : !analytical ? ownershipAnswer : undefined) };
}

function isConfirmedAiFixture(f: Fixture): boolean {
  return f.status === 'CONFIRMED' && Number.isInteger(f.homeScore) && Number.isInteger(f.awayScore) && f.homeScore! >= 0 && f.awayScore! >= 0;
}
function compareConfirmed(a: Fixture, b: Fixture): number {
  const time = (f: Fixture) => Date.parse(f.resultConfirmedAt || f.updatedAt || '') || 0;
  const delta = time(a)-time(b);
  if (delta || a.id === b.id) return delta;
  return sortSeasonFixtures([a,b])[0].id === a.id ? -1 : 1;
}
