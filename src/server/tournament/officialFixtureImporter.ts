import { queryAll, queryGet, queryRun, dbTransaction } from '../db';

export interface OfficialFixtureRecord {
  seasonId: string;
  competitionId: string;
  matchday: number;
  homeClubId: string;
  awayClubId: string;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  roundName?: string;
}

export interface ImportValidationResult {
  valid: boolean;
  competitionId: string;
  totalFixtures: number;
  matchdaysCount: number;
  clubCount: number;
  errors: string[];
}

/**
 * Validates an official fixture dataset before database insertion.
 * Enforces:
 * - All clubs must exist in the database and belong to the correct league/competition.
 * - No self fixtures (homeClubId !== awayClubId).
 * - No duplicate pairings across the season.
 * - Correct number of clubs and fixtures according to competition format.
 */
export function validateOfficialFixtures(
  competitionId: string,
  seasonId: string,
  fixtures: OfficialFixtureRecord[]
): ImportValidationResult {
  const errors: string[] = [];

  // 1. Fetch competition & league
  const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
  if (!comp) {
    errors.push(`Competition '${competitionId}' does not exist in database.`);
    return { valid: false, competitionId, totalFixtures: fixtures.length, matchdaysCount: 0, clubCount: 0, errors };
  }

  // 2. Fetch official clubs in this league
  const dbClubs = queryAll<any>('SELECT * FROM clubs WHERE league_id = ?', [comp.league_id]);
  const clubIdSet = new Set<string>(dbClubs.map(c => c.id));
  const expectedClubCount = dbClubs.length;

  if (expectedClubCount === 0) {
    errors.push(`No clubs found in database for league '${comp.league_id}'.`);
  }

  const expectedFixtures = expectedClubCount * (expectedClubCount - 1);
  const expectedMatchdays = (expectedClubCount - 1) * 2;

  const seenPairings = new Set<string>();
  const matchdays = new Set<number>();
  const participatingClubs = new Set<string>();
  const homeCountPerClub = new Map<string, number>();
  const awayCountPerClub = new Map<string, number>();

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const lineNum = i + 1;

    if (f.seasonId !== seasonId) {
      errors.push(`Fixture #${lineNum}: seasonId '${f.seasonId}' does not match expected '${seasonId}'.`);
    }
    if (f.competitionId !== competitionId) {
      errors.push(`Fixture #${lineNum}: competitionId '${f.competitionId}' does not match expected '${competitionId}'.`);
    }

    if (!clubIdSet.has(f.homeClubId)) {
      errors.push(`Fixture #${lineNum}: Home club '${f.homeClubId}' is invalid or does not belong to league '${comp.league_id}'.`);
    }
    if (!clubIdSet.has(f.awayClubId)) {
      errors.push(`Fixture #${lineNum}: Away club '${f.awayClubId}' is invalid or does not belong to league '${comp.league_id}'.`);
    }

    if (f.homeClubId === f.awayClubId) {
      errors.push(`Fixture #${lineNum}: Self-fixture detected for club '${f.homeClubId}'.`);
    }

    const pairKey = `${f.homeClubId}->${f.awayClubId}`;
    if (seenPairings.has(pairKey)) {
      errors.push(`Fixture #${lineNum}: Duplicate fixture pairing '${pairKey}' detected.`);
    }
    seenPairings.add(pairKey);

    matchdays.add(f.matchday);
    participatingClubs.add(f.homeClubId);
    participatingClubs.add(f.awayClubId);

    homeCountPerClub.set(f.homeClubId, (homeCountPerClub.get(f.homeClubId) || 0) + 1);
    awayCountPerClub.set(f.awayClubId, (awayCountPerClub.get(f.awayClubId) || 0) + 1);
  }

  // Validate totals
  if (fixtures.length !== expectedFixtures) {
    errors.push(
      `Fixture count mismatch for ${comp.name}: Received ${fixtures.length} fixtures, expected exactly ${expectedFixtures} (${expectedClubCount} teams).`
    );
  }

  if (matchdays.size !== expectedMatchdays) {
    errors.push(
      `Matchdays count mismatch for ${comp.name}: Received ${matchdays.size} matchdays, expected exactly ${expectedMatchdays}.`
    );
  }

  // Validate home/away distribution per club
  const expectedPerClub = expectedClubCount - 1;
  for (const clubId of dbClubs.map(c => c.id)) {
    const home = homeCountPerClub.get(clubId) || 0;
    const away = awayCountPerClub.get(clubId) || 0;
    if (home !== expectedPerClub) {
      errors.push(`Club '${clubId}' has ${home} home fixtures, expected exactly ${expectedPerClub}.`);
    }
    if (away !== expectedPerClub) {
      errors.push(`Club '${clubId}' has ${away} away fixtures, expected exactly ${expectedPerClub}.`);
    }
  }

  return {
    valid: errors.length === 0,
    competitionId,
    totalFixtures: fixtures.length,
    matchdaysCount: matchdays.size,
    clubCount: participatingClubs.size,
    errors,
  };
}

/**
 * Imports validated official fixtures into the database safely.
 * Sets fixture_source = 'official_2026_27'.
 * Does not overwrite or delete unrelated user data, memberships, or active match results.
 */
export function importOfficialFixtures(
  competitionId: string,
  seasonId: string,
  fixtures: OfficialFixtureRecord[]
): { imported: number; competitionId: string } {
  const validation = validateOfficialFixtures(competitionId, seasonId, fixtures);
  if (!validation.valid) {
    throw new Error(
      `Official fixture validation failed for '${competitionId}':\n${validation.errors.join('\n')}`
    );
  }

  const now = new Date().toISOString();

  return dbTransaction(() => {
    // Only remove unplayed / scheduled fixtures for this specific domestic competition
    queryRun(
      'DELETE FROM fixtures WHERE competition_id = ? AND season_id = ? AND status = "SCHEDULED"',
      [competitionId, seasonId]
    );

    let importedCount = 0;
    for (const f of fixtures) {
      const fixtureId = `fix-${f.competitionId}-md${f.matchday}-${f.homeClubId}-${f.awayClubId}`.replace(/club-/g, '');
      const roundName = f.roundName || `Matchday ${f.matchday}`;
      
      let scheduledAt: string | null = null;
      if (f.scheduledDate) {
        scheduledAt = f.scheduledTime ? `${f.scheduledDate}T${f.scheduledTime}:00Z` : `${f.scheduledDate}T15:00:00.000Z`;
      }

      queryRun(
        `INSERT OR REPLACE INTO fixtures (
          id, season_id, competition_id, matchday, round_name,
          home_club_id, away_club_id, scheduled_at, status, fixture_source,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', 'official_2026_27', ?, ?)`,
        [
          fixtureId,
          f.seasonId,
          f.competitionId,
          f.matchday,
          roundName,
          f.homeClubId,
          f.awayClubId,
          scheduledAt,
          now,
          now,
        ]
      );
      importedCount++;
    }

    return { imported: importedCount, competitionId };
  });
}
