import { queryAll, queryGet, queryRun, dbTransaction } from '../db';
import { Fixture, ResultSubmission } from '../../types';
import { generateRoundRobinSchedule, generateUCL24LeaguePhaseSchedule, calculateMatchdayDate } from '../tournament/fixtureEngine';
import { generateKnockoutBracket } from '../tournament/knockoutEngine';

export function generateCompetitionFixtures(competitionId: string, options: { force?: boolean } = {}): { generated: number; matchdays: number } {
  return dbTransaction(() => {
    // 1. Fetch competition details
    const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!comp) {
      throw new Error(`Competition '${competitionId}' not found.`);
    }

    if (comp.type === 'KNOCKOUT' || comp.type === 'SUPER_CUP' || comp.type === 'EUROPEAN_KNOCKOUT') {
      const res = generateKnockoutBracket(competitionId, options);
      return { generated: res.generated, matchdays: res.rounds };
    }

    if (comp.schedule_mode === 'OFFICIAL_IMPORT') {
      throw new Error(
        `Competition '${comp.name}' (${comp.id}) is configured for OFFICIAL_IMPORT. Please import official fixtures.`
      );
    }

    // 2. Check if fixtures already generated
    const existingCount = queryGet<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?',
      [competitionId]
    );

    if (existingCount && existingCount.cnt > 0) {
      if (options.force) {
        // Delete existing unconfirmed submissions and fixtures to regenerate clean schedule
        queryRun(
          'DELETE FROM result_submissions WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id = ?)',
          [competitionId]
        );
        queryRun('DELETE FROM fixtures WHERE competition_id = ?', [competitionId]);
      } else {
        const maxMatchday = queryGet<{ max_md: number }>(
          'SELECT MAX(matchday) as max_md FROM fixtures WHERE competition_id = ?',
          [competitionId]
        );
        return { generated: existingCount.cnt, matchdays: maxMatchday?.max_md || 0 };
      }
    }

    const season = queryGet<any>('SELECT * FROM seasons WHERE id = ?', [comp.season_id]);
    const seasonStartDate = season?.start_date || new Date().toISOString();

    // 3. Fetch clubs
    let clubs = queryAll<{ club_id: string }>(
      'SELECT club_id FROM competition_participants WHERE competition_id = ? ORDER BY seed_number ASC',
      [competitionId]
    );

    if (clubs.length === 0 && comp.league_id) {
      const leagueClubs = queryAll<{ club_id: string }>(
        `SELECT slc.club_id 
         FROM season_league_clubs slc 
         JOIN clubs c ON slc.club_id = c.id
         WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
         ORDER BY c.name ASC`,
        [comp.league_id, comp.season_id]
      );
      clubs = leagueClubs;
    }

    const clubIds = clubs.map((c) => c.club_id);
    if (clubIds.length < 2) {
      throw new Error(`Competition needs at least 2 clubs to generate fixtures (found ${clubIds.length}).`);
    }

    // 4. Generate schedule with appropriate algorithm
    let matchups;
    if (comp.type === 'EUROPEAN_LEAGUE_PHASE' && clubIds.length === 24) {
      matchups = generateUCL24LeaguePhaseSchedule(clubIds);
    } else {
      matchups = generateRoundRobinSchedule(clubIds, { homeAndAway: true });
    }
    const now = new Date().toISOString();

    let maxMatchday = 0;
    for (const m of matchups) {
      const fixtureId = `fix-${comp.id}-md${m.matchday}-${m.homeClubId.replace('club-', '')}-vs-${m.awayClubId.replace('club-', '')}`;
      const scheduledDate = calculateMatchdayDate(seasonStartDate, m.matchday, 7);

      if (m.matchday > maxMatchday) {
        maxMatchday = m.matchday;
      }

      queryRun(
        `INSERT INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status,
          home_score, away_score, winner_club_id, result_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
        [
          fixtureId,
          comp.season_id,
          comp.id,
          m.matchday,
          `Matchday ${m.matchday}`,
          m.homeClubId,
          m.awayClubId,
          scheduledDate,
          now,
          now,
        ]
      );
    }

    // Update competition status to active
    queryRun('UPDATE competitions SET status = "active" WHERE id = ?', [competitionId]);

    return { generated: matchups.length, matchdays: maxMatchday };
  });
}

export function resetCompetitionFixtures(competitionId: string): { deleted: number; generated: number; matchdays: number } {
  return dbTransaction(() => {
    // Delete any existing submissions for fixtures in this competition
    queryRun(
      'DELETE FROM result_submissions WHERE fixture_id IN (SELECT id FROM fixtures WHERE competition_id = ?)',
      [competitionId]
    );
    // Delete fixtures
    const delRes = queryRun('DELETE FROM fixtures WHERE competition_id = ?', [competitionId]);
    // Reset competition status
    queryRun('UPDATE competitions SET status = "upcoming" WHERE id = ?', [competitionId]);

    // Now generate fixtures
    const genRes = generateCompetitionFixtures(competitionId);
    return { deleted: delRes.changes, generated: genRes.generated, matchdays: genRes.matchdays };
  });
}

export function getFixtures(filter: {
  competitionId?: string;
  seasonId?: string;
  matchday?: number;
  clubId?: string;
  userId?: string;
  status?: string;
  limit?: number;
}): Fixture[] {
  let sql = `
    SELECT f.*,
           comp.name as competition_name,
           hc.name as home_name, hc.short_name as home_short, hc.logo_url as home_logo,
           ac.name as away_name, ac.short_name as away_short, ac.logo_url as away_logo,
           hcm.user_id as home_owner_id,
           acm.user_id as away_owner_id
    FROM fixtures f
    JOIN competitions comp ON f.competition_id = comp.id
    LEFT JOIN clubs hc ON f.home_club_id = hc.id
    LEFT JOIN clubs ac ON f.away_club_id = ac.id
    LEFT JOIN club_memberships hcm ON hc.id = hcm.club_id AND hcm.season_id = f.season_id AND hcm.status = 'active'
    LEFT JOIN club_memberships acm ON ac.id = acm.club_id AND acm.season_id = f.season_id AND acm.status = 'active'
    WHERE 1=1
  `;

  const params: any[] = [];

  if (filter.competitionId) {
    sql += ' AND f.competition_id = ?';
    params.push(filter.competitionId);
  }
  if (filter.seasonId) {
    sql += ' AND f.season_id = ?';
    params.push(filter.seasonId);
  }
  if (filter.matchday) {
    sql += ' AND f.matchday = ?';
    params.push(filter.matchday);
  }
  if (filter.status) {
    sql += ' AND f.status = ?';
    params.push(filter.status);
  }
  if (filter.clubId) {
    sql += ' AND (f.home_club_id = ? OR f.away_club_id = ?)';
    params.push(filter.clubId, filter.clubId);
  }
  if (filter.userId) {
    sql += ' AND (hcm.user_id = ? OR acm.user_id = ?)';
    params.push(filter.userId, filter.userId);
  }

  sql += ' ORDER BY f.matchday ASC, f.scheduled_at ASC';

  if (filter.limit) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
  }

  const rows = queryAll<any>(sql, params);

  return rows.map((r) => {
    const isHomeTbd = !r.home_club_id || r.home_club_id === 'TBD';
    const isAwayTbd = !r.away_club_id || r.away_club_id === 'TBD';

    return {
      id: r.id,
      seasonId: r.season_id,
      competitionId: r.competition_id,
      competitionName: r.competition_name,
      matchday: r.matchday,
      roundName: r.round_name,
      homeClubId: r.home_club_id,
      awayClubId: r.away_club_id,
      homeClub: {
        id: r.home_club_id || 'TBD',
        name: r.home_name || (isHomeTbd ? 'TBD' : r.home_club_id),
        shortName: r.home_short || (isHomeTbd ? 'TBD' : r.home_club_id),
        country: '',
        leagueId: '',
        logoUrl: r.home_logo || '',
        active: true,
        createdAt: '',
      },
      awayClub: {
        id: r.away_club_id || 'TBD',
        name: r.away_name || (isAwayTbd ? 'TBD' : r.away_club_id),
        shortName: r.away_short || (isAwayTbd ? 'TBD' : r.away_club_id),
        country: '',
        leagueId: '',
        logoUrl: r.away_logo || '',
        active: true,
        createdAt: '',
      },
      homeOwnerId: r.home_owner_id || undefined,
      awayOwnerId: r.away_owner_id || undefined,
      scheduledAt: r.scheduled_at,
      status: r.status,
      homeScore: r.home_score,
      awayScore: r.away_score,
      winnerClubId: r.winner_club_id,
      resultConfirmedAt: r.result_confirmed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export function getFixtureById(fixtureId: string, currentUserId?: string): Fixture | null {
  const row = queryGet<any>(
    `SELECT f.*,
            comp.name as competition_name,
            hc.name as home_name, hc.short_name as home_short, hc.logo_url as home_logo,
            ac.name as away_name, ac.short_name as away_short, ac.logo_url as away_logo,
            hcm.user_id as home_owner_id,
            acm.user_id as away_owner_id
     FROM fixtures f
     JOIN competitions comp ON f.competition_id = comp.id
     LEFT JOIN clubs hc ON f.home_club_id = hc.id
     LEFT JOIN clubs ac ON f.away_club_id = ac.id
     LEFT JOIN club_memberships hcm ON hc.id = hcm.club_id AND hcm.season_id = f.season_id AND hcm.status = 'active'
     LEFT JOIN club_memberships acm ON ac.id = acm.club_id AND acm.season_id = f.season_id AND acm.status = 'active'
     WHERE f.id = ?`,
    [fixtureId]
  );

  if (!row) return null;

  // Submissions
  const submissions = queryAll<any>(
    'SELECT * FROM result_submissions WHERE fixture_id = ?',
    [fixtureId]
  );

  let userSub: ResultSubmission | null = null;
  let opponentSub: ResultSubmission | null = null;

  for (const s of submissions) {
    const formatted: ResultSubmission = {
      id: s.id,
      fixtureId: s.fixture_id,
      submittedByUserId: s.submitted_by_user_id,
      clubId: s.club_id,
      homeScore: s.home_score,
      awayScore: s.away_score,
      proofUrl: s.proof_url || undefined,
      createdAt: s.created_at,
    };
    if (currentUserId && s.submitted_by_user_id === currentUserId) {
      userSub = formatted;
    } else {
      opponentSub = formatted;
    }
  }

  const isHomeTbd = !row.home_club_id || row.home_club_id === 'TBD';
  const isAwayTbd = !row.away_club_id || row.away_club_id === 'TBD';

  return {
    id: row.id,
    seasonId: row.season_id,
    competitionId: row.competition_id,
    competitionName: row.competition_name,
    matchday: row.matchday,
    roundName: row.round_name,
    homeClubId: row.home_club_id,
    awayClubId: row.away_club_id,
    homeClub: {
      id: row.home_club_id || 'TBD',
      name: row.home_name || (isHomeTbd ? 'TBD' : row.home_club_id),
      shortName: row.home_short || (isHomeTbd ? 'TBD' : row.home_club_id),
      country: '',
      leagueId: '',
      logoUrl: row.home_logo || '',
      active: true,
      createdAt: '',
    },
    awayClub: {
      id: row.away_club_id || 'TBD',
      name: row.away_name || (isAwayTbd ? 'TBD' : row.away_club_id),
      shortName: row.away_short || (isAwayTbd ? 'TBD' : row.away_club_id),
      country: '',
      leagueId: '',
      logoUrl: row.away_logo || '',
      active: true,
      createdAt: '',
    },
    homeOwnerId: row.home_owner_id || undefined,
    awayOwnerId: row.away_owner_id || undefined,
    scheduledAt: row.scheduled_at,
    status: row.status,
    homeScore: row.home_score,
    awayScore: row.away_score,
    winnerClubId: row.winner_club_id,
    resultConfirmedAt: row.result_confirmed_at,
    submissionsCount: submissions.length,
    userSubmission: userSub,
    opponentSubmission: opponentSub,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
