/**
 * Telegram AI Grounding Service
 *
 * Extracts query entities (leagues, clubs, matches) and pulls verified tournament
 * facts from the Redis read-model.
 * Formats exact positions, scores, and standings server-side with stale disclosures.
 */

import { ReadModelKeys, getFreshKey, getLkgKey, getDirtyKey, ReadModelSnapshot, OwnerNeutralClub } from '../readModel/readModelStore';
import { getAiRedisClient } from './telegramAiDeadline';
import { SEED_COMPETITIONS, SEED_CLUBS } from '../db/seed';
import { Competition, StandingsRow, Fixture, Club } from '../../types';

/** AI reads cached snapshots only; cache misses never trigger Firestore refreshes. */
async function readAiSnapshot<T>(key: string, signal?: AbortSignal): Promise<{ data: T[]; stale: boolean }> {
  const client = getAiRedisClient(signal);
  if (!client || signal?.aborted) return { data: [], stale: true };
  const [freshRaw, dirty] = await client.mget<unknown[]>(getFreshKey(key), getDirtyKey(key));
  const decode = (raw: unknown): ReadModelSnapshot<T[]> | null => {
    const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return snapshot && typeof snapshot === 'object' && Array.isArray(snapshot.data) ? snapshot : null;
  };
  const fresh = decode(freshRaw);
  if (fresh && !dirty) return { data: fresh.data, stale: false };
  const lkg = decode(await client.get(getLkgKey(key)));
  return { data: lkg?.data || fresh?.data || [], stale: true };
}

export interface GroundingContext {
  factsSummary: string;
  hasStaleData: boolean;
  detectedClubs: string[];
  detectedCompetitions: string[];
  ownershipAnswer?: string;
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

const CORE_RULES_SUMMARY =
`EFL UZ ASOSIY QOIDALARI:
- Mavsum: 2026/27 (Top 5 Yevropa ligalari, milliy kuboklar va Chempionlar Ligasi).
- Har bir o'yinchiga faqat 1 ta klub biriktiriladi.
- Uchrashuvlar muddati (matchday): odatda 30 soat.
- Natijani kiritish: O'yin tugagach, har ikki ishtirokchi eFootball hisobini skrinshot bilan tasdiqlaydi.
- Faqat CONFIRMED (tasdiqlangan) holatdagi natijalar yakuniy hisoblanadi.
- Ochkolar: G'alaba - 3 ochko, Durang - 1 ochko, Mag'lubiyat - 0 ochko.`;

// League keywords mapping
const LEAGUE_KEYWORDS: Record<string, string[]> = {
  'comp-premier-league': ['premier league', 'apl', 'angliya', 'arsenal', 'chelsea', 'liverpool', 'man city', 'manchester united', 'tottenham'],
  'comp-la-liga': ['la liga', 'laliga', 'ispaniya', 'real madrid', 'barcelona', 'atletico', 'valencia', 'sevilla'],
  'comp-serie-a': ['serie a', 'italiya', 'inter', 'milan', 'juventus', 'roma', 'napoli', 'lazio'],
  'comp-bundesliga': ['bundesliga', 'germaniya', 'bayern', 'bavariya', 'dortmund', 'leipzig', 'leverkusen'],
  'comp-ligue-1': ['ligue 1', 'fransiya', 'psg', 'marseille', 'monaco', 'lyon', 'lille'],
  'comp-ucl': ['champions league', 'chempionlar ligasi', 'ucl', 'yechl'],
};

export function isClubOwnershipQuestion(query: string): boolean {
  return /egasi|kimniki|kimga\s+biriktiril|kim\s+boshqar|owner|manager|владел|менеджер|кто\s+(?:играет|управляет)/i.test(query);
}

function matchClubs(query: string, clubs: Club[]): Club[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return clubs.filter(club => query.toLowerCase().includes(club.name.toLowerCase()) ||
    Boolean(club.shortName && words.includes(club.shortName.toLowerCase())));
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

/**
 * Searches and formats grounding data relevant to the user query.
 */
export async function buildAiGroundingContext(
  query: string,
  seasonId = DEFAULT_SEASON_ID,
  options?: { signal?: AbortSignal; previousUserQueries?: string[] }
): Promise<GroundingContext> {
  const normalized = query.toLowerCase();
  let hasStaleData = false;
  const detectedClubs: string[] = [];
  const detectedCompetitions: string[] = [];

  try {
    // 1. Fetch available competitions
    let competitions: Competition[] = [];
    if (testGroundingOverride?.competitions) {
      competitions = testGroundingOverride.competitions;
    } else {
      try {
        const compsResult = await readAiSnapshot<Competition>(ReadModelKeys.competitions(seasonId), options?.signal);
        if (compsResult.stale) hasStaleData = true;
        competitions = compsResult.data.length ? compsResult.data : SEED_COMPETITIONS as unknown as Competition[];
      } catch {
        hasStaleData = true;
        competitions = (SEED_COMPETITIONS as any[]) || [];
      }
    }

    // Match competitions from query
    for (const comp of competitions) {
      const compNameLower = comp.name.toLowerCase();
      if (normalized.includes(compNameLower)) {
        detectedCompetitions.push(comp.id);
        continue;
      }
      const keywords = LEAGUE_KEYWORDS[comp.id] || [];
      if (keywords.some((k) => normalized.includes(k))) {
        detectedCompetitions.push(comp.id);
      }
    }

    // 2. Fetch clubs to detect club mentions (covers bottom/mid-table clubs as well)
    let allClubs: Club[] = [];
    let ownershipAvailable = false;
    let ownershipStale = true;
    try {
      if (testGroundingOverride?.clubs) {
        allClubs = testGroundingOverride.clubs;
        ownershipAvailable = true;
        ownershipStale = Boolean(testGroundingOverride.clubsStale);
      } else {
      const clubsResult = await readAiSnapshot<Club>(ReadModelKeys.clubsWithOwners(seasonId), options?.signal);
      ownershipAvailable = clubsResult.data.length > 0;
      ownershipStale = clubsResult.stale;
      if (clubsResult.stale) hasStaleData = true;
      allClubs = clubsResult.data.length ? clubsResult.data : SEED_CLUBS as unknown as Club[];
      }
    } catch {
      hasStaleData = true;
      allClubs = (SEED_CLUBS as any[]) || [];
    }

    let matchedClubs = matchClubs(query, allClubs);
    const refersBack = /\buni(?:ng)?\b|\bu\b|\bits\b|\bthat\b|его|этого/i.test(query) || /^\s*(?:klubning\s+)?egasi\s+kim\s*[?!.]*\s*$/i.test(query);
    if (!matchedClubs.length && refersBack) {
      for (const previous of [...(options?.previousUserQueries || [])].reverse()) {
        const matches = matchClubs(previous, allClubs);
        if (matches.length) { matchedClubs = matches; break; }
      }
    }
    for (const club of matchedClubs) {
        detectedClubs.push(club.name);
        const matchingComp = competitions.find(
          (c) => c.id === (club as any).competitionId || (c as any).leagueId === club.leagueId || c.id === club.leagueId
        );
        const compId = matchingComp ? matchingComp.id : ((club as any).competitionId || club.leagueId);
        if (compId && !detectedCompetitions.includes(compId)) {
          detectedCompetitions.push(compId);
        }
    }

    const ownershipLines = matchedClubs.map(club => ownershipLine(club, ownershipAvailable, ownershipStale));
    const ownershipAnswer = isClubOwnershipQuestion(query)
      ? ownershipLines.length ? ownershipLines.join('\n')
        : 'Qaysi klubning egasini so‘rayapsiz? Klub nomini yozing; tasdiqlangan egasi ma’lumotini tekshiraman.'
      : undefined;

    // Fallback: If no competition detected, load top 2 major competitions by default
    const targetCompIds = detectedCompetitions.length > 0
      ? detectedCompetitions.slice(0, 3)
      : competitions.slice(0, 2).map((c) => c.id);

    const contextSections: string[] = [];
    if (ownershipLines.length) contextSections.push(`KLUB EGALARI (faqat snapshotdagi faktlar):\n${ownershipLines.join('\n')}`);

    // General platform rules snippet
    contextSections.push(
`EFL UZ ASOSIY QOIDALARI:
- Mavsum: 2026/27 (Top 5 Yevropa ligalari, milliy kuboklar va Chempionlar Ligasi).
- Har bir o'yinchiga faqat 1 ta klub biriktiriladi.
- Uchrashuvlar muddati (matchday): odatda 30 soat.
- Natijani kiritish: O'yin tugagach, har ikki ishtirokchi eFootball hisobini skrinshot bilan tasdiqlaydi.
- Faqat CONFIRMED (tasdiqlangan) holatdagi natijalar yakuniy hisoblanadi.
- Ochkolar: G'alaba - 3 ochko, Durang - 1 ochko, Mag'lubiyat - 0 ochko.`);

    // 3. Retrieve and format standings & confirmed fixtures for target competitions
    for (const compId of targetCompIds) {
      if (options?.signal?.aborted) break;
      const comp = competitions.find((c) => c.id === compId);
      const compTitle = comp?.name || compId;

      try {
        let rows: StandingsRow[] = [];
        if (testGroundingOverride?.standings?.[compId]) {
          rows = testGroundingOverride.standings[compId];
        } else if (testGroundingOverride?.standings) {
          const matchKey = Object.keys(testGroundingOverride.standings).find(
            (k) => compId.includes(k) || k.includes(compId)
          );
          if (matchKey) rows = testGroundingOverride.standings[matchKey];
        } else {
          const standingsResult = await readAiSnapshot<StandingsRow>(ReadModelKeys.standings(compId, seasonId), options?.signal);
          if (standingsResult.stale) hasStaleData = true;
          rows = standingsResult.data;
        }

        if (rows.length > 0) {
          // If specific clubs were detected, include them specifically, plus top 3
          let relevantRows: StandingsRow[] = [];
          if (detectedClubs.length > 0) {
            relevantRows = rows.filter((r) =>
              detectedClubs.some((dc) => r.clubName.toLowerCase().includes(dc.toLowerCase()))
            );
          }
          // Always ensure top 3 are visible for reference
          const top3 = rows.slice(0, 3);
          const combined = Array.from(new Set([...top3, ...relevantRows]));
          combined.sort((a, b) => a.position - b.position);

          const tableLines = combined.map(
            (r) => `${r.position}-o'rin: ${r.clubName} — ${r.points} ochko (O':${r.played}, G':${r.won}, D:${r.drawn}, M:${r.lost}, T/F:${r.goalsFor}-${r.goalsAgainst})`
          );

          contextSections.push(`TURNIR JADVALI (${compTitle}):\n${tableLines.join('\n')}`);
        }
      } catch {}

      try {
        let fixtures: Fixture[] = [];
        if (testGroundingOverride?.fixtures?.[compId]) {
          fixtures = testGroundingOverride.fixtures[compId];
        } else if (testGroundingOverride?.fixtures) {
          const matchKey = Object.keys(testGroundingOverride.fixtures).find(
            (k) => compId.includes(k) || k.includes(compId)
          );
          if (matchKey) fixtures = testGroundingOverride.fixtures[matchKey];
        } else {
          let fixturesResult = await readAiSnapshot<Fixture>(ReadModelKeys.competitionFixtures(compId, seasonId), options?.signal);
          if (!fixturesResult.data.length) {
            const adminSnapshot = await readAiSnapshot<Fixture>(ReadModelKeys.adminFixtures(seasonId), options?.signal);
            fixturesResult = { data: adminSnapshot.data.filter(f => f.competitionId === compId), stale: adminSnapshot.stale };
          }
          if (fixturesResult.stale) hasStaleData = true;
          fixtures = fixturesResult.data;
        }

        // Filter fixtures: confirmed matches or matches involving detected clubs
        const relevantFixtures = fixtures.filter((f) => {
          const homeName = (f.homeClub?.name || (f as any).homeClubName || allClubs.find(c => c.id === f.homeClubId)?.name || f.homeClubId || '').toLowerCase();
          const awayName = (f.awayClub?.name || (f as any).awayClubName || allClubs.find(c => c.id === f.awayClubId)?.name || f.awayClubId || '').toLowerCase();
          if (detectedClubs.length > 0) {
            return detectedClubs.some(
              (dc) => homeName.includes(dc.toLowerCase()) || awayName.includes(dc.toLowerCase())
            );
          }
          return f.status === 'CONFIRMED';
        }).slice(-5); // last 5 relevant fixtures

        if (relevantFixtures.length > 0) {
          const fixLines = relevantFixtures.map((f) => {
            const homeName = f.homeClub?.name || (f as any).homeClubName || allClubs.find(c => c.id === f.homeClubId)?.name || f.homeClubId || 'Home';
            const awayName = f.awayClub?.name || (f as any).awayClubName || allClubs.find(c => c.id === f.awayClubId)?.name || f.awayClubId || 'Away';
            if (f.status === 'CONFIRMED') {
              return `[CONFIRMED] MD ${f.matchday}: ${homeName} ${f.homeScore} - ${f.awayScore} ${awayName}`;
            }
            return `[${f.status}] MD ${f.matchday}: ${homeName} vs ${awayName} (Kutilmoqda)`;
          });
          contextSections.push(`UCHRASHUVLAR VA NATIJALAR (${compTitle}):\n${fixLines.join('\n')}`);
        }
      } catch {}
    }

    if (hasStaleData) {
      contextSections.push(
        "[DIQQAT: Ushbu ma'lumotlar vaqtinchalik keshdan/eskirgan snapshotdan olindi. Natijalar yangilanishi davom etmoqda.]"
      );
    }

    return {
      factsSummary: contextSections.join('\n\n'),
      ownershipAnswer,
      hasStaleData,
      detectedClubs,
      detectedCompetitions,
    };
  } catch (err: any) {
    console.warn('[AI GROUNDING] Error building grounding context:', err?.message || err);
    return {
      factsSummary: CORE_RULES_SUMMARY,
      ownershipAnswer: isClubOwnershipQuestion(query) ? 'Klub egasi haqida tasdiqlangan ma’lumotni hozir tekshirib bo‘lmadi.' : undefined,
      hasStaleData: true,
      detectedClubs: [],
      detectedCompetitions: [],
    };
  }
}
