import { queryGet, queryAll, queryRun, dbTransaction } from './index';

interface SeedClub {
  id: string;
  name: string;
  shortName: string;
  country: string;
  leagueId: string;
  logoUrl: string;
}

interface SeedLeague {
  id: string;
  name: string;
  country: string;
  tier: number;
  logoUrl: string;
}

interface SeedCompetition {
  id: string;
  seasonId: string;
  leagueId?: string;
  name: string;
  type: 'LEAGUE' | 'KNOCKOUT' | 'SUPER_CUP' | 'EUROPEAN_LEAGUE_PHASE' | 'EUROPEAN_KNOCKOUT';
  scheduleMode: 'REAL_SCHEDULE' | 'OFFICIAL_IMPORT' | 'GENERATED_SCHEDULE';
  formatConfig: Record<string, any>;
}

export const SEED_SEASON = {
  id: 'season-2026-27',
  name: '2026/27 Season',
  status: 'active',
  startDate: '2026-08-15',
  endDate: '2027-05-30',
};

export const SEED_SEASONS = [
  SEED_SEASON,
];

import { TOP5_LEAGUES, TOP5_CLUBS } from '../../constants/top5Clubs';

export const SEED_LEAGUES: SeedLeague[] = TOP5_LEAGUES as SeedLeague[];
export const SEED_CLUBS: SeedClub[] = TOP5_CLUBS as SeedClub[];

export const SEED_COMPETITIONS: SeedCompetition[] = [
  // --- DOMESTIC LEAGUES (Single Round-Robin Format) ---
  {
    id: 'comp-premier-league-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-premier-league',
    name: 'Premier League',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 19, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'goalDifference', 'goalsFor', 'headToHead'], qualificationSpots: 7, europaQualificationSpots: 7 },
  },
  {
    id: 'comp-la-liga-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-la-liga',
    name: 'La Liga',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 19, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'headToHead', 'goalDifference', 'goalsFor'], qualificationSpots: 7, europaQualificationSpots: 7 },
  },
  {
    id: 'comp-serie-a-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-serie-a',
    name: 'Serie A',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 19, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'headToHead', 'goalDifference', 'goalsFor'], qualificationSpots: 6, europaQualificationSpots: 6 },
  },
  {
    id: 'comp-bundesliga-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-bundesliga',
    name: 'Bundesliga',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 17, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'goalDifference', 'goalsFor', 'headToHead'], qualificationSpots: 6, europaQualificationSpots: 6 },
  },
  {
    id: 'comp-ligue-1-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-ligue-1',
    name: 'Ligue 1',
    type: 'LEAGUE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 17, homeAndAway: false, pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, tieBreakers: ['points', 'goalDifference', 'goalsFor', 'headToHead'], qualificationSpots: 6, europaQualificationSpots: 6 },
  },

  // --- NATIONAL CUPS ---
  {
    id: 'comp-fa-cup-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-premier-league',
    name: 'FA Cup',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 6, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-copa-del-rey-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-la-liga',
    name: 'Copa del Rey',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 6, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-coppa-italia-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-serie-a',
    name: 'Coppa Italia',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-dfb-pokal-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-bundesliga',
    name: 'DFB-Pokal',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true },
  },
  {
    id: 'comp-coupe-de-france-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-ligue-1',
    name: 'Coupe de France',
    type: 'KNOCKOUT',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { rounds: 5, singleLeg: true, extraTime: true, penalties: true },
  },

  // --- SUPER CUPS ---
  {
    id: 'comp-community-shield-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-premier-league',
    name: 'FA Community Shield',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 2, singleLeg: true, penalties: true },
  },
  {
    id: 'comp-supercopa-espana-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-la-liga',
    name: 'Supercopa de España',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 4, format: 'final_four' },
  },
  {
    id: 'comp-supercoppa-italiana-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-serie-a',
    name: 'Supercoppa Italiana',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 4, format: 'final_four' },
  },
  {
    id: 'comp-dfl-supercup-2026',
    seasonId: 'season-2026-27',
    leagueId: 'league-bundesliga',
    name: 'DFL-Supercup',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 2, singleLeg: true },
  },

  // --- EUROPEAN COMPETITIONS (32 Clubs Each) ---
  {
    id: 'comp-champions-league-2026',
    seasonId: 'season-2026-27',
    name: 'UEFA Champions League',
    type: 'EUROPEAN_LEAGUE_PHASE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { leaguePhaseTeams: 32, matchesPerTeam: 8, directQualifiers: 8, playoffTeams: 16, knockoutTeams: 16 },
  },
  {
    id: 'comp-europa-league-2026',
    seasonId: 'season-2026-27',
    name: 'UEFA Europa League',
    type: 'EUROPEAN_LEAGUE_PHASE',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { leaguePhaseTeams: 32, matchesPerTeam: 8, directQualifiers: 8, playoffTeams: 16, knockoutTeams: 16 },
  },
  {
    id: 'comp-uefa-super-cup-2026',
    seasonId: 'season-2026-27',
    name: 'UEFA Super Cup',
    type: 'SUPER_CUP',
    scheduleMode: 'GENERATED_SCHEDULE',
    formatConfig: { teams: 2, singleLeg: true },
  },
];

/** Boot catalog is insert-only: existing tournament state is never reconciled. */
export function seedMissingStaticCatalog(): void {
  dbTransaction(() => {
    const now = new Date().toISOString();
    queryRun('INSERT OR IGNORE INTO seasons (id,name,status,start_date,end_date,created_at) VALUES (?,?,?,?,?,?)',
      [SEED_SEASON.id, SEED_SEASON.name, SEED_SEASON.status, SEED_SEASON.startDate, SEED_SEASON.endDate, now]);
    for (const l of SEED_LEAGUES) queryRun('INSERT OR IGNORE INTO leagues (id,name,country,tier,logo_url,created_at) VALUES (?,?,?,?,?,?)',
      [l.id,l.name,l.country,l.tier,l.logoUrl,now]);
    for (const c of SEED_CLUBS) {
      queryRun('INSERT OR IGNORE INTO clubs (id,name,short_name,country,league_id,logo_url,active,created_at) VALUES (?,?,?,?,?,?,1,?)',
        [c.id,c.name,c.shortName,c.country,c.leagueId,c.logoUrl,now]);
      queryRun('INSERT OR IGNORE INTO season_league_clubs (id,season_id,league_id,club_id,is_active,created_at) VALUES (?,?,?,?,1,?)',
        [`slc-${SEED_SEASON.id}-${c.id}`,SEED_SEASON.id,c.leagueId,c.id,now]);
    }
    for (const c of SEED_COMPETITIONS) queryRun('INSERT OR IGNORE INTO competitions (id,season_id,league_id,name,type,schedule_mode,status,format_config_json,created_at) VALUES (?,?,?,?,?,?,?, ?,?)',
      [c.id,c.seasonId,c.leagueId || null,c.name,c.type,c.scheduleMode,'upcoming',JSON.stringify(c.formatConfig),now]);
  });
}

export function seedDatabase(): {
  seasonsCreated: number;
  leaguesCreated: number;
  clubsCreated: number;
  competitionsCreated: number;
  skipped: number;
} {
  return dbTransaction(() => {
    let seasonsCreated = 0;
    let leaguesCreated = 0;
    let clubsCreated = 0;
    let competitionsCreated = 0;
    let skipped = 0;

    const now = new Date().toISOString();

    // 1. Season
    const existingSeason = queryGet('SELECT id FROM seasons WHERE id = ?', [SEED_SEASON.id]);
    if (!existingSeason) {
      queryRun(
        'INSERT INTO seasons (id, name, status, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [SEED_SEASON.id, SEED_SEASON.name, SEED_SEASON.status, SEED_SEASON.startDate, SEED_SEASON.endDate, now]
      );
      seasonsCreated++;
    } else {
      queryRun(
        'UPDATE seasons SET name = ?, status = ?, start_date = ?, end_date = ? WHERE id = ?',
        [SEED_SEASON.name, SEED_SEASON.status, SEED_SEASON.startDate, SEED_SEASON.endDate, SEED_SEASON.id]
      );
    }

    // 2. Leagues
    for (const league of SEED_LEAGUES) {
      const existingLeague = queryGet('SELECT id FROM leagues WHERE id = ?', [league.id]);
      if (!existingLeague) {
        queryRun(
          'INSERT INTO leagues (id, name, country, tier, logo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [league.id, league.name, league.country, league.tier, league.logoUrl, now]
        );
        leaguesCreated++;
      } else {
        skipped++;
      }
    }

    // 3. Clubs
    const activeClubIds = new Set(SEED_CLUBS.map((c) => c.id));
    for (const club of SEED_CLUBS) {
      const existingClub = queryGet('SELECT id FROM clubs WHERE id = ?', [club.id]);
      if (!existingClub) {
        queryRun(
          'INSERT INTO clubs (id, name, short_name, country, league_id, logo_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
          [club.id, club.name, club.shortName, club.country, club.leagueId, club.logoUrl, now]
        );
        clubsCreated++;
      } else {
        queryRun(
          'UPDATE clubs SET name = ?, short_name = ?, country = ?, league_id = ?, logo_url = ?, active = 1 WHERE id = ?',
          [club.name, club.shortName, club.country, club.leagueId, club.logoUrl, club.id]
        );
      }

      // Ensure membership in season_league_clubs for 2026/27
      const slcId = `slc-${SEED_SEASON.id}-${club.id}`;
      queryRun(
        `INSERT INTO season_league_clubs (id, season_id, league_id, club_id, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(season_id, club_id) DO UPDATE SET league_id = excluded.league_id, is_active = 1`,
        [slcId, SEED_SEASON.id, club.leagueId, club.id, now]
      );
    }

    // Deactivate any clubs not in the 2026/27 top flights
    const allDbClubs = queryAll<{ id: string }>('SELECT id FROM clubs');
    for (const c of allDbClubs) {
      if (!activeClubIds.has(c.id)) {
        queryRun('UPDATE clubs SET active = 0 WHERE id = ?', [c.id]);
        queryRun(
          'UPDATE season_league_clubs SET is_active = 0 WHERE club_id = ? AND season_id = ?',
          [c.id, SEED_SEASON.id]
        );
        // Remove from 2026/27 competition participants
        queryRun(
          'DELETE FROM competition_participants WHERE club_id = ? AND season_id = ?',
          [c.id, SEED_SEASON.id]
        );
      }
    }

    // 4. Competitions
    for (const comp of SEED_COMPETITIONS) {
      const existingComp = queryGet<{ id: string }>('SELECT id FROM competitions WHERE id = ?', [comp.id]);
      if (!existingComp) {
        queryRun(
          'INSERT INTO competitions (id, season_id, league_id, name, type, schedule_mode, status, format_config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, "upcoming", ?, ?)',
          [
            comp.id,
            comp.seasonId,
            comp.leagueId || null,
            comp.name,
            comp.type,
            comp.scheduleMode,
            JSON.stringify(comp.formatConfig),
            now,
          ]
        );
        competitionsCreated++;
      } else {
        queryRun(
          'UPDATE competitions SET schedule_mode = ?, format_config_json = ? WHERE id = ?',
          [comp.scheduleMode, JSON.stringify(comp.formatConfig), comp.id]
        );
        skipped++;
      }

      // Sync active participants for leagues and domestic cups
      if ((comp.type === 'LEAGUE' || comp.type === 'KNOCKOUT') && comp.leagueId) {
        // Clean out any stale participants not belonging to the active league
        queryRun(
          `DELETE FROM competition_participants 
           WHERE competition_id = ? AND club_id NOT IN (
             SELECT club_id FROM season_league_clubs WHERE league_id = ? AND season_id = ? AND is_active = 1
           )`,
          [comp.id, comp.leagueId, comp.seasonId]
        );

        const leagueClubs = queryAll<{ club_id: string }>(
          `SELECT slc.club_id 
           FROM season_league_clubs slc 
           JOIN clubs c ON slc.club_id = c.id
           WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
           ORDER BY c.name ASC`,
          [comp.leagueId, comp.seasonId]
        );

        for (let i = 0; i < leagueClubs.length; i++) {
          const clubId = leagueClubs[i].club_id;
          const partId = `part-${comp.id}-${clubId}`;
          queryRun(
            `INSERT INTO competition_participants (id, competition_id, club_id, season_id, seed_number, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(competition_id, club_id) DO UPDATE SET seed_number = excluded.seed_number`,
            [partId, comp.id, clubId, comp.seasonId, i + 1, now]
          );
        }
      }
    }

    console.log(
      ` [SEED] Done: Created ${seasonsCreated} season, ${leaguesCreated} leagues, ${clubsCreated} clubs, ${competitionsCreated} competitions. Skipped ${skipped} existing records.`
    );

    return { seasonsCreated, leaguesCreated, clubsCreated, competitionsCreated, skipped };
  });
}

/**
 * Authoritative 2026/27 Roster Safe Repair Migration
 *
 * It must:
 * 1. Load authoritative 2026/27 roster.
 * 2. Set all existing season-2026-27 season_league_clubs records to inactive / synchronize with active roster.
 * 3. Insert/activate ONLY the correct 2026/27 clubs.
 * 4. Preserve the global clubs table.
 * 5. Preserve users.
 * 6. Preserve Telegram accounts.
 * 7. Preserve historical seasons.
 * 8. Preserve historical ownership.
 * 9. Preserve audit logs.
 */
/** Compatibility entry point: roster reconciliation is no longer destructive.
 * Existing clubs, participants, competitions, fixtures and results are preserved.
 */
export function repairSeason202627Roster(): { activatedClubs: number; deactivatedClubs: number; totalActive: number } {
  seedMissingStaticCatalog();
  return { activatedClubs: 0, deactivatedClubs: 0,
    totalActive: queryGet<{ n: number }>('SELECT count(*) n FROM clubs WHERE active = 1')?.n || 0 };
}
