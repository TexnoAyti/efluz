import { queryAll, queryGet } from '../db';
import { StandingsRow } from '../../types';

interface ClubRaw {
  id: string;
  name: string;
  short_name: string;
  logo_url: string;
  manager_username?: string | null;
}

interface ConfirmedFixtureRaw {
  id: string;
  matchday: number;
  home_club_id: string;
  away_club_id: string;
  home_score: number;
  away_score: number;
  result_confirmed_at: string;
}

export function calculateCompetitionStandings(competitionId: string): StandingsRow[] {
  // 1. Fetch competition details
  const comp = queryGet<{ season_id: string; format_config_json: string }>(
    'SELECT season_id, format_config_json FROM competitions WHERE id = ?',
    [competitionId]
  );

  const seasonId = comp?.season_id || 'season-2026-27';

  let formatConfig: any = {};
  if (comp?.format_config_json) {
    try {
      formatConfig = JSON.parse(comp.format_config_json);
    } catch {
      formatConfig = {};
    }
  }

  const pointsForWin = formatConfig.pointsForWin ?? 3;
  const pointsForDraw = formatConfig.pointsForDraw ?? 1;
  const pointsForLoss = formatConfig.pointsForLoss ?? 0;
  const tieBreakers = formatConfig.tieBreakers ?? ['points', 'goalDifference', 'goalsFor', 'headToHead'];

  // 2. Fetch all participating clubs for this competition with active owner
  const clubs = queryAll<ClubRaw>(
    `SELECT c.id, c.name, c.short_name, c.logo_url, u.username as manager_username
     FROM competition_participants cp
     JOIN clubs c ON cp.club_id = c.id
     LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE cp.competition_id = ?
     ORDER BY c.name ASC`,
    [seasonId, competitionId]
  );

  // If no competition_participants defined, fallback to clubs from the league
  let clubList = clubs;
  if (clubList.length === 0) {
    clubList = queryAll<ClubRaw>(
      `SELECT c.id, c.name, c.short_name, c.logo_url, u.username as manager_username
       FROM competitions comp
       JOIN season_league_clubs slc ON comp.league_id = slc.league_id AND comp.season_id = slc.season_id AND slc.is_active = 1
       JOIN clubs c ON slc.club_id = c.id
       LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = comp.season_id AND cm.status = 'active'
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE comp.id = ?
       ORDER BY c.name ASC`,
      [competitionId]
    );
  }

  // 3. Fetch all CONFIRMED fixtures for this competition
  const confirmedFixtures = queryAll<ConfirmedFixtureRaw>(
    `SELECT id, matchday, home_club_id, away_club_id, home_score, away_score, result_confirmed_at
     FROM fixtures
     WHERE competition_id = ? AND status = 'CONFIRMED' AND home_score IS NOT NULL AND away_score IS NOT NULL
     ORDER BY matchday ASC, result_confirmed_at ASC`,
    [competitionId]
  );

  // 4. Accumulate stats per club
  const statsMap = new Map<
    string,
    {
      clubId: string;
      clubName: string;
      shortName: string;
      logoUrl: string;
      managerUsername?: string;
      played: number;
      won: number;
      drawn: number;
      lost: number;
      goalsFor: number;
      goalsAgainst: number;
      goalDifference: number;
      points: number;
      form: Array<'W' | 'D' | 'L'>;
    }
  >();

  for (const c of clubList) {
    statsMap.set(c.id, {
      clubId: c.id,
      clubName: c.name,
      shortName: c.short_name,
      logoUrl: c.logo_url,
      managerUsername: c.manager_username || undefined,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [],
    });
  }

  for (const fix of confirmedFixtures) {
    const home = statsMap.get(fix.home_club_id);
    const away = statsMap.get(fix.away_club_id);

    if (home) {
      home.played += 1;
      home.goalsFor += fix.home_score;
      home.goalsAgainst += fix.away_score;

      if (fix.home_score > fix.away_score) {
        home.won += 1;
        home.points += pointsForWin;
        home.form.push('W');
      } else if (fix.home_score === fix.away_score) {
        home.drawn += 1;
        home.points += pointsForDraw;
        home.form.push('D');
      } else {
        home.lost += 1;
        home.points += pointsForLoss;
        home.form.push('L');
      }
    }

    if (away) {
      away.played += 1;
      away.goalsFor += fix.away_score;
      away.goalsAgainst += fix.home_score;

      if (fix.away_score > fix.home_score) {
        away.won += 1;
        away.points += pointsForWin;
        away.form.push('W');
      } else if (fix.away_score === fix.home_score) {
        away.drawn += 1;
        away.points += pointsForDraw;
        away.form.push('D');
      } else {
        away.lost += 1;
        away.points += pointsForLoss;
        away.form.push('L');
      }
    }
  }

  // Calculate goal difference & limit form to last 5
  const rows = Array.from(statsMap.values()).map((row) => {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.form = row.form.slice(-5);
    return row;
  });

  // Helper for Head-to-Head points between two clubs
  function getH2HPoints(clubAId: string, clubBId: string): number {
    let pts = 0;
    for (const f of confirmedFixtures) {
      if (f.home_club_id === clubAId && f.away_club_id === clubBId) {
        if (f.home_score > f.away_score) pts += pointsForWin;
        else if (f.home_score === f.away_score) pts += pointsForDraw;
      } else if (f.home_club_id === clubBId && f.away_club_id === clubAId) {
        if (f.away_score > f.home_score) pts += pointsForWin;
        else if (f.away_score === f.home_score) pts += pointsForDraw;
      }
    }
    return pts;
  }

  // 5. Multi-criteria Sorting based on tieBreakers configuration
  rows.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }

    for (const criteria of tieBreakers) {
      if (criteria === 'goalDifference') {
        if (b.goalDifference !== a.goalDifference) {
          return b.goalDifference - a.goalDifference;
        }
      } else if (criteria === 'goalsFor') {
        if (b.goalsFor !== a.goalsFor) {
          return b.goalsFor - a.goalsFor;
        }
      } else if (criteria === 'headToHead') {
        const h2hA = getH2HPoints(a.clubId, b.clubId);
        const h2hB = getH2HPoints(b.clubId, a.clubId);
        if (h2hB !== h2hA) {
          return h2hB - h2hA;
        }
      }
    }

    // Alphabetical fallback
    return a.clubName.localeCompare(b.clubName);
  });

  return rows.map((r, index) => ({
    position: index + 1,
    clubId: r.clubId,
    clubName: r.clubName,
    shortName: r.shortName,
    logoUrl: r.logoUrl,
    managerUsername: r.managerUsername,
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDifference: r.goalDifference,
    points: r.points,
    form: r.form,
  }));
}
