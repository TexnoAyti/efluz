import { queryAll, queryGet, queryRun, dbTransaction } from '../db';
import { createNotification } from '../services/notificationService';
import { createAuditLog } from '../services/adminService';

export interface KnockoutMatchNode {
  fixtureId: string;
  roundNumber: number;
  matchIndex: number;
  homeClubId: string | null;
  awayClubId: string | null;
  status: string;
  winnerClubId: string | null;
}

/**
 * Generates an initial knockout bracket structure (R32, R16, QF, SF, Final)
 * with deterministic seeding and round indices.
 */
export function generateKnockoutBracket(
  competitionId: string,
  options: {
    participants?: string[];
    singleLeg?: boolean;
    seedParticipants?: boolean;
  } = {}
): { generated: number; rounds: number } {
  return dbTransaction(() => {
    // 1. Fetch competition & season
    const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!comp) {
      throw new Error(`Competition '${competitionId}' not found.`);
    }

    const existingFixtures = queryGet<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?',
      [competitionId]
    );
    if (existingFixtures && existingFixtures.cnt > 0) {
      return { generated: existingFixtures.cnt, rounds: 0 };
    }

    // 2. Fetch participating clubs
    let clubIds = options.participants;
    if (!clubIds || clubIds.length === 0) {
      const parts = queryAll<{ club_id: string }>(
        'SELECT club_id FROM competition_participants WHERE competition_id = ? ORDER BY seed_number ASC',
        [competitionId]
      );
      clubIds = parts.map((p) => p.club_id);
    }

    // Fallback: If no participants registered, fetch from associated league
    if (clubIds.length === 0 && comp.league_id) {
      const leagueClubs = queryAll<{ club_id: string }>(
        `SELECT slc.club_id 
         FROM season_league_clubs slc 
         JOIN clubs c ON slc.club_id = c.id
         WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1 
         ORDER BY c.name ASC`,
        [comp.league_id, comp.season_id]
      );
      clubIds = leagueClubs.map((c) => c.club_id);
    }

    if (clubIds.length < 2) {
      throw new Error(`Cannot generate knockout bracket with fewer than 2 teams (found ${clubIds.length}).`);
    }

    // Calculate nearest power of 2 (e.g. 2, 4, 8, 16, 32)
    let bracketSize = 2;
    while (bracketSize < clubIds.length) {
      bracketSize *= 2;
    }

    // Determine round names
    const totalRounds = Math.log2(bracketSize);
    const getRoundName = (roundNum: number): string => {
      const remainingTeams = Math.pow(2, totalRounds - roundNum + 1);
      if (remainingTeams === 2) return 'Final';
      if (remainingTeams === 4) return 'Semi-Finals';
      if (remainingTeams === 8) return 'Quarter-Finals';
      if (remainingTeams === 16) return 'Round of 16';
      if (remainingTeams === 32) return 'Round of 32';
      return `Round of ${remainingTeams}`;
    };

    const now = new Date().toISOString();
    let totalGenerated = 0;

    // First round matches
    const firstRoundMatches = bracketSize / 2;
    for (let i = 0; i < firstRoundMatches; i++) {
      const homeClubId = clubIds[i * 2] || null;
      const awayClubId = clubIds[i * 2 + 1] || null;
      const fixtureId = `fix-${competitionId}-r1-m${i}`;
      const roundName = getRoundName(1);

      queryRun(
        `INSERT INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status,
          home_score, away_score, winner_club_id, result_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
        [
          fixtureId,
          comp.season_id,
          competitionId,
          roundName,
          homeClubId || 'TBD',
          awayClubId || 'TBD',
          now,
          now,
          now,
        ]
      );
      totalGenerated++;
    }

    // Subsequent rounds (QF, SF, Final) with TBD placeholders
    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);
      const roundName = getRoundName(round);

      for (let m = 0; m < matchesInRound; m++) {
        const fixtureId = `fix-${competitionId}-r${round}-m${m}`;
        queryRun(
          `INSERT INTO fixtures (
            id, season_id, competition_id, matchday, round_name,
            home_club_id, away_club_id, scheduled_at, status,
            home_score, away_score, winner_club_id, result_confirmed_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'TBD', 'TBD', ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
          [
            fixtureId,
            comp.season_id,
            competitionId,
            round,
            roundName,
            now,
            now,
            now,
          ]
        );
        totalGenerated++;
      }
    }

    queryRun('UPDATE competitions SET status = "active" WHERE id = ?', [competitionId]);

    return { generated: totalGenerated, rounds: totalRounds };
  });
}

/**
 * Generates UEFA Champions League Knockout Phase (Play-offs -> R16 -> QF -> SF -> Final)
 * based on the 24-team single league table standings.
 */
export function generateUCLKnockoutBracket(
  competitionId: string,
  rankedClubIds: string[]
): { generated: number; playoffFixtures: number; r16Fixtures: number } {
  return dbTransaction(() => {
    if (rankedClubIds.length < 24) {
      throw new Error(`UCL Knockout Phase requires 24 ranked clubs (found ${rankedClubIds.length}).`);
    }

    const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!comp) {
      throw new Error(`Competition '${competitionId}' not found.`);
    }

    const now = new Date().toISOString();
    let totalGenerated = 0;

    // Direct qualifiers: Top 8 (indices 0..7)
    const directQualifiers = rankedClubIds.slice(0, 8);
    // Playoff qualifiers: Rank 9..24 (indices 8..23)
    const playoffClubs = rankedClubIds.slice(8, 24);

    // 1. Generate 8 Play-off Matches (Matchday / Round 9)
    // 9v24, 10v23, 11v22, 12v21, 13v20, 14v19, 15v18, 16v17
    for (let i = 0; i < 8; i++) {
      const seededClubId = playoffClubs[i]; // rank 9+i
      const unseededClubId = playoffClubs[15 - i]; // rank 24-i
      const fixtureId = `fix-${competitionId}-po-m${i}`;

      queryRun(
        `INSERT INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status,
          home_score, away_score, winner_club_id, result_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 9, 'Knockout Play-offs', ?, ?, ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
        [fixtureId, comp.season_id, competitionId, unseededClubId, seededClubId, now, now, now]
      );
      totalGenerated++;
    }

    // 2. Generate Round of 16 Matches (Round 10)
    // Seeded direct qualifiers vs TBD playoff winners
    for (let i = 0; i < 8; i++) {
      const directClubId = directQualifiers[i];
      const fixtureId = `fix-${competitionId}-r16-m${i}`;

      queryRun(
        `INSERT INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status,
          home_score, away_score, winner_club_id, result_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 10, 'Round of 16', ?, 'TBD', ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
        [fixtureId, comp.season_id, competitionId, directClubId, now, now, now]
      );
      totalGenerated++;
    }

    // 3. Generate Quarter-Finals (Round 11)
    for (let i = 0; i < 4; i++) {
      const fixtureId = `fix-${competitionId}-qf-m${i}`;
      queryRun(
        `INSERT INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status,
          home_score, away_score, winner_club_id, result_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 11, 'Quarter-Finals', 'TBD', 'TBD', ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
        [fixtureId, comp.season_id, competitionId, now, now, now]
      );
      totalGenerated++;
    }

    // 4. Generate Semi-Finals (Round 12)
    for (let i = 0; i < 2; i++) {
      const fixtureId = `fix-${competitionId}-sf-m${i}`;
      queryRun(
        `INSERT INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status,
          home_score, away_score, winner_club_id, result_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, 12, 'Semi-Finals', 'TBD', 'TBD', ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
        [fixtureId, comp.season_id, competitionId, now, now, now]
      );
      totalGenerated++;
    }

    // 5. Generate Final (Round 13)
    const finalFixtureId = `fix-${competitionId}-final-m0`;
    queryRun(
      `INSERT INTO fixtures (
        id, season_id, competition_id, matchday, round_name,
        home_club_id, away_club_id, scheduled_at, status,
        home_score, away_score, winner_club_id, result_confirmed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, 13, 'Final', 'TBD', 'TBD', ?, 'SCHEDULED', NULL, NULL, NULL, NULL, ?, ?)`,
      [finalFixtureId, comp.season_id, competitionId, now, now, now]
    );
    totalGenerated++;

    return { generated: totalGenerated, playoffFixtures: 8, r16Fixtures: 8 };
  });
}

/**
 * Automatically advances winner of a confirmed knockout fixture to the next bracket round
 */
export function advanceKnockoutWinner(fixtureId: string): { advanced: boolean; targetFixtureId?: string; winnerClubId?: string } {
  return dbTransaction(() => {
    const fixture = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
    if (!fixture || fixture.status !== 'CONFIRMED' || !fixture.winner_club_id) {
      return { advanced: false };
    }

    const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [fixture.competition_id]);
    if (!comp || (comp.type !== 'KNOCKOUT' && comp.type !== 'SUPER_CUP' && comp.type !== 'EUROPEAN_KNOCKOUT')) {
      return { advanced: false };
    }

    // Parse round and match index from fixture ID or matchday
    // Typical ID pattern: fix-{comp}-r{round}-m{matchIndex}
    const match = fixture.id.match(/-r(\d+)-m(\d+)$/);
    if (!match) {
      return { advanced: false };
    }

    const currentRound = parseInt(match[1], 10);
    const currentMatchIndex = parseInt(match[2], 10);
    const nextRound = currentRound + 1;
    const nextMatchIndex = Math.floor(currentMatchIndex / 2);
    const isHomeSlot = currentMatchIndex % 2 === 0;

    const nextFixtureId = `fix-${comp.id}-r${nextRound}-m${nextMatchIndex}`;
    const nextFixture = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [nextFixtureId]);

    if (!nextFixture) {
      // This was the Final! We have crowned the champion!
      const championClub = queryGet<any>('SELECT * FROM clubs WHERE id = ?', [fixture.winner_club_id]);
      if (championClub) {
        createAuditLog(
          'system',
          'TOURNAMENT_CHAMPION_CROWNED',
          'competitions',
          comp.id,
          null,
          { championClubId: championClub.id, championName: championClub.name }
        );

        // Notify champion club owner
        const owner = queryGet<{ user_id: string }>(
          'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
          [championClub.id, comp.season_id]
        );
        if (owner) {
          createNotification(
            owner.user_id,
            'TOURNAMENT_CHAMPION',
            `🏆 Champion of ${comp.name}!`,
            `Congratulations! ${championClub.name} has won the ${comp.name} title!`
          );
        }
      }
      return { advanced: true, winnerClubId: fixture.winner_club_id };
    }

    const now = new Date().toISOString();
    const updateColumn = isHomeSlot ? 'home_club_id' : 'away_club_id';

    queryRun(
      `UPDATE fixtures SET ${updateColumn} = ?, updated_at = ? WHERE id = ?`,
      [fixture.winner_club_id, now, nextFixtureId]
    );

    // Check if next fixture now has both teams ready
    const updatedNext = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [nextFixtureId]);
    if (updatedNext.home_club_id !== 'TBD' && updatedNext.away_club_id !== 'TBD') {
      // Notify both participants
      const homeOwner = queryGet<{ user_id: string }>(
        'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
        [updatedNext.home_club_id, comp.season_id]
      );
      const awayOwner = queryGet<{ user_id: string }>(
        'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
        [updatedNext.away_club_id, comp.season_id]
      );

      const notifMsg = `Your next match in ${comp.name} (${updatedNext.round_name}) is scheduled!`;
      if (homeOwner) createNotification(homeOwner.user_id, 'NEXT_ROUND_MATCH', `Next Round in ${comp.name}`, notifMsg);
      if (awayOwner) createNotification(awayOwner.user_id, 'NEXT_ROUND_MATCH', `Next Round in ${comp.name}`, notifMsg);
    }

    createAuditLog(
      'system',
      'KNOCKOUT_ADVANCE',
      'fixtures',
      nextFixtureId,
      { previousFixtureId: fixture.id },
      { round: nextRound, slot: isHomeSlot ? 'HOME' : 'AWAY', advancedClubId: fixture.winner_club_id }
    );

    return { advanced: true, targetFixtureId: nextFixtureId, winnerClubId: fixture.winner_club_id };
  });
}
