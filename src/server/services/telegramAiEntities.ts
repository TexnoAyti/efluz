import type { Club } from '../../types';
import { SEED_CLUBS } from '../db/seed';

/** Normalize spelling, accents and Uzbek apostrophes, preserving word boundaries. */
export function normalizeAiEntity(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[‘’ʻʼ'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function entityRegex(alias: string): RegExp {
  return new RegExp(`(?:^| )(${escapeRegex(normalizeAiEntity(alias))})(?:ning|ni|ga|dan|da)?(?= |$)`, 'gu');
}
export interface AiClubChoice { id: string; name: string; source: string; replacement: string; }
export interface AiClubResolution { clubs: Club[]; clarification?: string; clubChoices?: AiClubChoice[]; }
export function throwAiClubClarification(resolution: AiClubResolution): never {
  throw Object.assign(new Error('CLARIFY:' + resolution.clarification), { clubChoices: resolution.clubChoices });
}
export function containsAiEntity(normalizedQuery: string, alias: string): boolean {
  return !!normalizeAiEntity(alias) && entityRegex(alias).test(normalizedQuery);
}
const ALIASES: Record<string, string[]> = {
  'club-man-city': ['man city', 'manchester siti', 'man siti', 'mancity'],
  'club-man-utd': ['man united', 'man utd', 'manchester yunayted', 'myu'],
  'club-arsenal': ['arsenal', 'арсенал'],
  'club-chelsea': ['chelsi'],
  'club-brighton': ['brighton', 'brayton', 'brighton and hove albion'],
  'club-liverpool': ['liverpul', 'ливерпуль'],
  'club-leverkusen': ['leverkusen', 'leverkuzen'],
  'club-newcastle': ['newcastle', 'nyukasl'],
  'club-tottenham': ['tottenham', 'tottenhem', 'spurs'],
  'club-wolves': ['wolves'],
  'club-west-ham': ['west ham', 'vest hem'],
  'club-aston-villa': ['aston villa'],
  'club-nottm-forest': ['nottingham', 'nottm forest', 'nottingem'],
  'club-ipswich': ['ipswich', 'ipsvich'],
  'club-inter': ['inter', 'internazionale'],
  'club-milan': ['milan', 'ac milan'],
  'club-bayern': ['bayern', 'bavariya', 'bayern munich'],
  'club-psg': ['psg', 'paris', 'parij'],
  'club-real-madrid': ['real madrid'],
  'club-barcelona': ['barcelona', 'barselona', 'barca', 'barsa'],
  'club-atletico-madrid': ['atletico', 'atletiko'],
  'club-heidenheim': ['heidenheim', 'fc heidenheim', '1 fc heidenheim 1846', 'haydenheim', 'haydenhaym', 'xaydenxaym'],
  'club-dortmund': ['dortmund', 'borussiya dortmund'],
  'club-leeds': ['leeds', 'lids'],
  'club-coventry': ['coventry', 'koventri'],
  'club-hull': ['hull'],
  'club-alaves': ['alaves'],
  'club-athletic-club': ['athletic', 'athletic bilbao', 'bilbao'],
  'club-celta-vigo': ['celta', 'celta vigo'],
  'club-mallorca': ['mallorca'],
  'club-rayo-vallecano': ['rayo'],
  'club-real-betis': ['betis'],
  'club-real-sociedad': ['sociedad'],
  'club-verona': ['verona'],
  'club-gladbach': ['gladbach', 'monchengladbach'],
  'club-eintracht-frankfurt': ['frankfurt', 'eintracht'],
  'club-mainz': ['mainz', 'mayns'],
  'club-werder-bremen': ['werder', 'bremen'],
  'club-union-berlin': ['union berlin'],
  'club-brest': ['brest', 'brestois'],
  'club-lyon': ['lyon', 'lion'],
  'club-marseille': ['marseille', 'marsel'],
  'club-rennes': ['rennes', 'renn'],
  'club-reims': ['reims'],
  'club-strasbourg': ['strasbourg', 'strasburg'],
  'club-montpellier': ['montpellier'],
};
function strippedClubName(name: string): string {
  return name.replace(/^(?:\d+\.\s*)?(?:FC|AFC|ACF|AC|AS|SSC|SS|US|SC|SV|RB|RC|RCD|UD|CA|AJ|LOSC|OGC|ESTAC|VfL|VfB|TSG|FSV)\s+/i, '').replace(/\s+(?:FC|CF|CFC|HSC|Calcio|Town|Hotspur)$/i, '').replace(/\s+18\d{2}$/, '');
}
function aliases(club: Club): string[] {
  const stripped = strippedClubName(club.name);
  const seed = SEED_CLUBS.find(c => normalizeAiEntity(c.name) === normalizeAiEntity(club.name) || normalizeAiEntity(strippedClubName(c.name)) === normalizeAiEntity(stripped));
  const family = Object.entries(ALIASES).find(([,names]) => names.some(name => normalizeAiEntity(name) === normalizeAiEntity(club.name) || !seed && !/^(?:paris|real|manchester|borussia)$/.test(normalizeAiEntity(stripped)) && normalizeAiEntity(name) === normalizeAiEntity(stripped)))?.[1];
  return [...new Set([club.name, stripped, ...[club.name,stripped].filter(name=>name.includes(' ')).map(name=>normalizeAiEntity(name).replace(/ /g,'')), ...(ALIASES[club.id] || ALIASES[seed?.id || ''] || family || [])])];
}
function matchClubs(query: string, clubs: Club[]): Club[] {
  // Preserve explicit team separators so “Inter — Milan” cannot collapse into “Inter Milan”.
  const q = normalizeAiEntity(query.replace(/[—–]|\s-\s/g, ' vs '));
  const hits: Array<{ club: Club; start: number; end: number }> = [];
  for (const club of clubs) {
    const names = aliases(club);
    // Common English words such as NEW are codes only when explicitly capitalized.
    if (club.shortName && (new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegex(club.shortName.toUpperCase())}(?=$|[^A-Za-z0-9])`).test(query) || /^(?:PSG|ARS|MCI|MUN|IPS)$/i.test(club.shortName))) names.push(club.shortName);
    for (const name of names) for (const m of q.matchAll(entityRegex(name))) {
      const start = m.index! + (m[0].startsWith(' ') ? 1 : 0);
      hits.push({ club, start, end: start + m[1].length });
    }
  }
  // “Inter Milan” must not also select AC Milan; “Inter va Milan” selects both.
  const maximal = hits.filter(h => !hits.some(other => other.start <= h.start && other.end >= h.end && other.end-other.start > h.end-h.start));
  return [...new Map(maximal.sort((a,b) => a.start - b.start).map(h => [h.club.id, h.club])).values()];
}

/** Keep source spans intact. Mentions and quoted payloads cannot become club choices. */
function unprotectedNameText(query: string): string {
  return query.replace(/@[A-Za-z0-9_]+|\buser-\d+\b|"[^"]*"|“[^”]*”/g, match => ' '.repeat(match.length));
}
function nameTokens(query: string) {
  return [...unprotectedNameText(query).matchAll(/[\p{L}\p{N}]+(?:[’'ʻʼ`][\p{L}]+)*/gu)]
    .map(m => ({ text: m[0], norm: normalizeAiEntity(m[0]), start: m.index!, end: m.index! + m[0].length }));
}
function wordVariants(word: string): Array<{ base: string; suffix: string }> {
  const variants = [{ base: word, suffix: '' }];
  const suffix = /^(.*?)(ning|dan|ga|ni|da)$/.exec(word);
  if (suffix && suffix[1].length >= 5) variants.push({ base: suffix[1], suffix: suffix[2] });
  return variants;
}
function typoDistance(a: string, b: string): number {
  if (a === b) return 0;
  const limit = Math.min(a.length, b.length) >= 8 ? 2 : 1;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > limit) return 99;
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i-1][j] + 1, rows[i][j-1] + 1, rows[i-1][j-1] + Number(a[i-1] !== b[j-1]));
    if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) rows[i][j] = Math.min(rows[i][j], rows[i-2][j-2] + 1);
  }
  return rows[a.length][b.length] <= limit ? rows[a.length][b.length] : 99;
}
function clubNameChoices(query: string, clubs: Club[], typo: boolean): AiClubChoice[] {
  const tokens = nameTokens(query);
  const hits: Array<AiClubChoice & { start: number; end: number; distance: number }> = [];
  for (const club of clubs) for (const alias of aliases(club)) {
    const words = normalizeAiEntity(alias).split(' ');
    if (!words.length || words.length > 4) continue;
    for (let i = 0; i <= tokens.length - words.length; i++) {
      let distance = 0, suffix = '', valid = true;
      for (let j = 0; j < words.length; j++) {
        const variants = j === words.length - 1 ? wordVariants(tokens[i+j].norm) : [{ base: tokens[i+j].norm, suffix: '' }];
        const best = variants.map(v => ({ ...v, distance: typoDistance(v.base, words[j]) })).sort((a,b) => a.distance - b.distance)[0];
        if (best.distance === 99) { valid = false; break; }
        distance += best.distance; suffix = best.suffix;
      }
      if (!valid || (typo ? distance < 1 || distance > 2 : distance !== 0)) continue;
      const start = tokens[i].start, end = tokens[i + words.length - 1].end;
      hits.push({ id: club.id, name: club.name, source: query.slice(start, end), replacement: club.name + suffix, start, end, distance });
    }
  }
  hits.sort((a,b) => a.start - b.start || a.distance - b.distance || (b.end-b.start) - (a.end-a.start));
  const first = hits[0];
  if (!first) return [];
  return [...new Map(hits.filter(h => h.start === first.start && h.end === first.end && h.distance === first.distance).map(h => [h.id, { id: h.id, name: h.name, source: h.source, replacement: h.replacement }])).values()].slice(0, 4);
}
export function replaceAiClubChoice(request: string, choice: AiClubChoice): string | null {
  const text = unprotectedNameText(request);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(choice.source)}(?![\\p{L}\\p{N}_])`, 'giu');
  const hits = [...text.matchAll(pattern)];
  if (hits.length !== 1) return null;
  const start = hits[0].index!;
  return request.slice(0, start) + choice.replacement + request.slice(start + choice.source.length);
}

export function resolveAiClubs(query: string, clubs: Club[], selectedIds: string[] | undefined = undefined, previous: string[] = []): AiClubResolution {
  if (/^(?:kontekstni (?:tozala|unut)|jamoani unut|reset|forget team)\s*[.!]?$/i.test(query.trim())) {
    return { clubs: [], clarification: 'Jamoa konteksti tozalandi. Yangi klub nomini yozishingiz mumkin.' };
  }
  const matched = matchClubs(query, clubs);
  if (matched.length > 1) {
    const q = normalizeAiEntity(query);
    const sharedOnly = matched.every(c => !aliases(c).some(alias => containsAiEntity(q,alias) &&
      !matched.some(other => other.id !== c.id && aliases(other).some(a => normalizeAiEntity(a) === normalizeAiEntity(alias)))));
    if (sharedOnly) return { clubs: [], clubChoices: clubNameChoices(query, matched, false), clarification: `Qaysi jamoani nazarda tutdingiz: ${matched.map(c => c.name).join(' yoki ')}?` };
  }
  // Explicitly named teams missing from the live roster must never resolve to an older team.
  const missing = matchClubs(query, SEED_CLUBS as unknown as Club[]).filter(c => !clubs.some(live => normalizeAiEntity(strippedClubName(live.name)) === normalizeAiEntity(strippedClubName(c.name)) || (ALIASES[c.id] || []).some(alias => normalizeAiEntity(alias) === normalizeAiEntity(live.name))));
  if (missing.length) return { clubs: [], clarification: `${missing.map(c => c.name).join(', ')}: joriy mavsum snapshotida klub ma’lumoti topilmadi. Oldingi jamoa ma’lumotini bunga qo‘llamayman.` };
  const suggestions = clubNameChoices(query, clubs.filter(c=>!matched.some(m=>m.id===c.id)), true);
  if(suggestions.length) return {clubs:[],clubChoices:suggestions,clarification:`Klub nomida yozuv xatosi bo‘lishi mumkin. «${suggestions[0].source}» bilan ${suggestions.map(c=>c.name).join(' yoki ')}ni nazarda tutdingizmi? ${suggestions.length === 1 ? '“Ha” yoki klub nomi bilan javob bering.' : 'Shu klublardan birining nomi yoki ro‘yxatdagi raqamini yozing.'}`};
  if (matched.length) return { clubs: matched };
  const q = normalizeAiEntity(query);
  const ambiguousWord = ['manchester', 'real', 'borussia'].find(word => containsAiEntity(q,word));
  if (ambiguousWord) {
    const candidates = clubs.filter(c => containsAiEntity(normalizeAiEntity(c.name), ambiguousWord));
    if (candidates.length > 1) {
      const token = nameTokens(query).find(t => wordVariants(t.norm).some(v => v.base === ambiguousWord));
      const suffix = token ? wordVariants(token.norm).find(v => v.base === ambiguousWord)?.suffix || '' : '';
      return { clubs: [], clubChoices: candidates.slice(0,4).map(c => ({ id:c.id, name:c.name, source:token?.text || ambiguousWord, replacement:c.name + suffix })), clarification: `Qaysi jamoani nazarda tutdingiz: ${candidates.map(c => c.name).join(' yoki ')}? Klub nomi yoki ro‘yxatdagi raqamini yozing.` };
    }
    if (candidates.length === 1) return { clubs: candidates };
  }
  // Carry the selected team only for a team follow-up, not unrelated league or general tactics questions.
  const contextual = /egasi|kimniki|kim boshqar|nechanchi|nechta|qancha|ochko|g[‘’'`]?alaba|mag[‘’'`]?lub|durang|gol|keyingi|navbatdagi|oxirgi|forma|statistika|kuchli|kuchsiz|uyda|safarda|o[‘’'`]?zaro|raqib|kubok|ucl|uel|yutad|uni(?:ng)?\b|kimga|kimni|tahlil|batafsil|taqqosla|solishtir|подроб|анализ|сравни|detail|analy[sz]|compar|hazil|roast|taktik.*(?:unga|shu)|\bits\b|\bthat team\b|его|владел|очк|мест|следующ|owner|points|position|next match/i.test(query);
  // Proper names before the ownership phrase require explicit lookup/clarification.
  const ownerPrefix = q.match(/^(.*?)\s+(?:egasi|kimniki|owner|nechanchi|keyingi|navbatdagi|haqida|statistikasi|oyini|nechta|nega)\b/);
  if (ownerPrefix && !ownerPrefix[1].split(' ').every(word => /^(?:u|uni|uning|klub|klubning|jamoa|jamoaning|shu|bu|hozir|bugun|oxirgi|keyingi|barcha|hamma|bizning|mening|forma|oyin|oyini|oyinlar|natija|natijalar|jadval|taktika|taktikasi|tahlil|ochko|gollar|galaba|kubok|liga|efl|uz|efootball)$/.test(word))) {
    return { clubs: [], clarification: 'Qaysi klubni nazarda tutdingiz? To‘liq klub nomini yozing; bu nom snapshotda aniqlanmadi.' };
  }
  if (contextual) {
    if (selectedIds !== undefined) return { clubs: clubs.filter(c => selectedIds.includes(c.id)) };
    for (const text of [...previous].reverse()) {
      const old = matchClubs(text,clubs);
      if (old.length) return { clubs: old };
    }
  }
  return { clubs: [] };
}
