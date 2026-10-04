/**
 * Telegram AI Grounding Service
 *
 * Extracts query entities (leagues, clubs, matches) and pulls verified tournament
 * facts from the Redis read-model.
 * Formats exact positions, scores, and standings server-side with stale disclosures.
 */

import {
  getCompetitionsFromReadModel,
  getCompetitionStandingsFromReadModel,
  getCompetitionFixturesFromReadModel,
  getAdminClubsFromReadModel,
} from '../readModel/readModelStore';
import { SEED_COMPETITIONS, SEED_CLUBS } from '../db/seed';
import { Competition, StandingsRow, Fixture, Club } from '../../types';

export interface GroundingContext {
  factsSummary: string;
  hasStaleData: boolean;
  detectedClubs: string[];
  detectedCompetitions: string[];
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

/**
 * Searches and formats grounding data relevant to the user query.
 */
export async function buildAiGroundingContext(
  query: string,
  seasonId = DEFAULT_SEASON_ID,
  options?: { signal?: AbortSignal }
): Promise<GroundingContext> {
  const normalized = query.toLowerCase();
  let hasStaleData = false;
  const detectedClubs: string[] = [];
  const detectedCompetitions: string[] = [];

  try {
    // 1. Fetch available competitions
    let competitions: Competition[] = [];
    try {
      const compsResult = await getCompetitionsFromReadModel(seasonId);
      if (compsResult.stale) hasStaleData = true;
      competitions = compsResult.competitions || [];
    } catch {
      hasStaleData = true;
      competitions = (SEED_COMPETITIONS as any[]) || [];
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
    try {
      const clubsResult = await getAdminClubsFromReadModel();
      allClubs = clubsResult.clubs || [];
    } catch {
      allClubs = (SEED_CLUBS as any[]) || [];
    }

    for (const club of allClubs) {
      const clubNameLower = club.name.toLowerCase();
      if (normalized.includes(clubNameLower) || (club.shortName && normalized.includes(club.shortName.toLowerCase()))) {
        detectedClubs.push(club.name);
        const compId = (club as any).competitionId || (club as any).leagueId;
        if (compId && !detectedCompetitions.includes(compId)) {
          detectedCompetitions.push(compId);
        }
      }
    }

    // Fallback: If no competition detected, load top 2 major competitions by default
    const targetCompIds = detectedCompetitions.length > 0
      ? detectedCompetitions.slice(0, 3)
      : competitions.slice(0, 2).map((c) => c.id);

    const contextSections: string[] = [];

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
        const standingsResult = await getCompetitionStandingsFromReadModel(compId, seasonId);
        if (standingsResult.stale) hasStaleData = true;
        const rows: StandingsRow[] = standingsResult.standings || [];

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
        const fixturesResult = await getCompetitionFixturesFromReadModel(compId, { seasonId });
        if (fixturesResult.stale) hasStaleData = true;
        const fixtures: Fixture[] = fixturesResult.fixtures || [];

        // Filter fixtures: confirmed matches or matches involving detected clubs
        const relevantFixtures = fixtures.filter((f) => {
          const homeName = (f.homeClub?.name || (f as any).homeClubName || f.homeClubId || '').toLowerCase();
          const awayName = (f.awayClub?.name || (f as any).awayClubName || f.awayClubId || '').toLowerCase();
          if (detectedClubs.length > 0) {
            return detectedClubs.some(
              (dc) => homeName.includes(dc.toLowerCase()) || awayName.includes(dc.toLowerCase())
            );
          }
          return f.status === 'CONFIRMED';
        }).slice(-5); // last 5 relevant fixtures

        if (relevantFixtures.length > 0) {
          const fixLines = relevantFixtures.map((f) => {
            const homeName = f.homeClub?.name || (f as any).homeClubName || f.homeClubId || 'Home';
            const awayName = f.awayClub?.name || (f as any).awayClubName || f.awayClubId || 'Away';
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
      hasStaleData,
      detectedClubs,
      detectedCompetitions,
    };
  } catch (err: any) {
    console.warn('[AI GROUNDING] Error building grounding context:', err?.message || err);
    return {
      factsSummary: CORE_RULES_SUMMARY,
      hasStaleData: true,
      detectedClubs: [],
      detectedCompetitions: [],
    };
  }
}
