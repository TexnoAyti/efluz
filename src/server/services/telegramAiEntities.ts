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
export function containsAiEntity(normalizedQuery: string, alias: string): boolean {
  return !!normalizeAiEntity(alias) && entityRegex(alias).test(normalizedQuery);
}
const ALIASES: Record<string, string[]> = {
  'club-man-city': ['man city', 'manchester siti', 'man siti', 'mancity'],
  'club-man-utd': ['man united', 'man utd', 'manchester yunayted', 'myu'],
  'club-ipswich': ['ipswich', 'ipsvich'],
  'club-inter': ['inter', 'internazionale'],
  'club-milan': ['milan', 'ac milan'],
  'club-bayern': ['bayern', 'bavariya', 'bayern munich'],
  'club-psg': ['psg', 'paris', 'parij'],
  'club-real-madrid': ['real madrid'],
  'club-barcelona': ['barcelona', 'barselona', 'barca', 'barsa'],
  'club-atletico-madrid': ['atletico', 'atletiko'],
  'club-dortmund': ['dortmund', 'borussiya dortmund'],
};
function aliases(club: Club): string[] {
  const stripped = club.name.replace(/^(?:FC|AFC|AC|AS|SSC|SC|SV|RB)\s+/i, '').replace(/\s+(?:FC|CF|Town|Hotspur)$/i, '');
  const seed = SEED_CLUBS.find(c => normalizeAiEntity(c.name) === normalizeAiEntity(club.name));
  return [...new Set([club.name, stripped, ...(ALIASES[club.id] || ALIASES[seed?.id || ''] || [])])];
}
function matchClubs(query: string, clubs: Club[]): Club[] {
  const q = normalizeAiEntity(query);
  const hits: Array<{ club: Club; start: number; end: number }> = [];
  for (const club of clubs) {
    const names = aliases(club);
    // Common English words such as NEW are codes only when explicitly capitalized.
    if (club.shortName && (query.includes(club.shortName.toUpperCase()) || /^(?:PSG|UCL|ARS|MCI|MUN|IPS)$/i.test(club.shortName))) names.push(club.shortName);
    for (const name of names) for (const m of q.matchAll(entityRegex(name))) {
      const start = m.index! + (m[0].startsWith(' ') ? 1 : 0);
      hits.push({ club, start, end: start + m[1].length });
    }
  }
  // “Inter Milan” must not also select AC Milan; “Inter va Milan” selects both.
  const maximal = hits.filter(h => !hits.some(other => other.start <= h.start && other.end >= h.end && other.end-other.start > h.end-h.start));
  return [...new Map(maximal.map(h => [h.club.id, h.club])).values()];
}

export function resolveAiClubs(query: string, clubs: Club[], selectedIds: string[] | undefined = undefined, previous: string[] = []): {
  clubs: Club[]; clarification?: string;
} {
  if (/^(?:kontekstni (?:tozala|unut)|jamoani unut|reset|forget team)\s*[.!]?$/i.test(query.trim())) {
    return { clubs: [], clarification: 'Jamoa konteksti tozalandi. Yangi klub nomini yozishingiz mumkin.' };
  }
  const matched = matchClubs(query, clubs);
  if (matched.length > 1) {
    const q = normalizeAiEntity(query);
    const sharedOnly = matched.every(c => !aliases(c).some(alias => containsAiEntity(q,alias) &&
      !matched.some(other => other.id !== c.id && aliases(other).some(a => normalizeAiEntity(a) === normalizeAiEntity(alias)))));
    if (sharedOnly) return { clubs: [], clarification: `Qaysi jamoani nazarda tutdingiz: ${matched.map(c => c.name).join(' yoki ')}?` };
  }
  if (matched.length) return { clubs: matched };
  const q = normalizeAiEntity(query);
  const ambiguousWord = ['manchester', 'real', 'borussia'].find(word => containsAiEntity(q,word));
  if (ambiguousWord) {
    const candidates = clubs.filter(c => containsAiEntity(normalizeAiEntity(c.name), ambiguousWord));
    if (candidates.length > 1) return { clubs: [], clarification: `Qaysi jamoani nazarda tutdingiz: ${candidates.map(c => c.name).join(' yoki ')}?` };
    if (candidates.length === 1) return { clubs: candidates };
  }
  // Explicitly named teams missing from the live roster must never resolve to an older team.
  const missing = matchClubs(query, SEED_CLUBS as unknown as Club[]).filter(c => !clubs.some(live => normalizeAiEntity(live.name) === normalizeAiEntity(c.name)));
  if (missing.length) return { clubs: [], clarification: `${missing.map(c => c.name).join(', ')}: joriy mavsum snapshotida klub ma’lumoti topilmadi. Oldingi jamoa ma’lumotini bunga qo‘llamayman.` };
  // Carry the selected team only for a team follow-up, not unrelated league or general tactics questions.
  const contextual = /egasi|kimniki|kim boshqar|nechanchi|nechta|qancha|ochko|g[‘’'`]?alaba|mag[‘’'`]?lub|durang|gol|keyingi|navbatdagi|oxirgi|forma|statistika|kuchli|kuchsiz|uyda|safarda|o[‘’'`]?zaro|raqib|kubok|ucl|uel|yutad|uni(?:ng)?\b|kimga|kimni|tahlil|hazil|roast|taktik.*(?:unga|shu)|\bits\b|\bthat team\b|его|владел|очк|мест|следующ|owner|points|position|next match/i.test(query);
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
