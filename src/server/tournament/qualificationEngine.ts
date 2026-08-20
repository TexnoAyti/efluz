import { queryAll, queryGet, queryRun, dbTransaction } from '../db';
import { calculateCompetitionStandings } from './standingsEngine';
import { createAuditLog } from '../services/adminService';
import { createNotification } from '../services/notificationService';

export interface QualificationResult {
  seasonId: string;
  sourceCompetitionId: string;
  sourceCompetitionName: string;
  targetCompetitionId: string;
  targetCompetitionName: string;
  clubId: string;
  clubName: string;
  ownerUserId: string | null;
  rank: number;
  reason: string;
}

/**
 * Evaluates European & Super Cup qualification rules across all competitions in a season.
 * Creates permanent, immutable participant snapshots with:
 * - season_id
 * - competition_id
 * - club_id
 * - owner_user_id (current club owner snapshot)
 * - source_competition_id
 * - source_position
 * - qualification_reason
 * - qualification_timestamp
 */
export function evaluateSeasonQualifications(seasonId: string): {
  success: boolean;
  qualifications: QualificationResult[];
  participantsAdded: number;
} {
  return dbTransaction(() => {
    const qualifications: QualificationResult[] = [];
    let participantsAdded = 0;
    const now = new Date().toISOString();

    // 1. Fetch all league competitions for this season
    const leagues = queryAll<any>(
      "SELECT * FROM competitions WHERE season_id = ? AND type = 'LEAGUE'",
      [seasonId]
    );

    // Target European competitions
    const uclComp = queryGet<any>(
      "SELECT * FROM competitions WHERE season_id = ? AND type = 'EUROPEAN_LEAGUE_PHASE' AND name LIKE '%Champions League%'",
      [seasonId]
    );
    const uelComp = queryGet<any>(
      "SELECT * FROM competitions WHERE season_id = ? AND type = 'EUROPEAN_LEAGUE_PHASE' AND name LIKE '%Europa League%'",
      [seasonId]
    );
    const ueclComp = queryGet<any>(
      "SELECT * FROM competitions WHERE season_id = ? AND type = 'EUROPEAN_LEAGUE_PHASE' AND name LIKE '%Conference League%'",
      [seasonId]
    );

    for (const league of leagues) {
      const standings = calculateCompetitionStandings(league.id);
      if (standings.length === 0) continue;

      let formatConfig: any = {};
      try {
        formatConfig = JSON.parse(league.format_config_json || '{}');
      } catch {
        formatConfig = {};
      }

      // Custom 24-Team European Qualification Allocation:
      // Premier League (20): Top 5 to UCL (pos 1-5), 6th to UEL, 7th to UECL
      // La Liga (20): Top 5 to UCL (pos 1-5), 6th to UEL, 7th to UECL
      // Serie A (20): Top 5 to UCL (pos 1-5), 6th to UEL, 7th to UECL
      // Bundesliga (18): Top 5 to UCL (pos 1-5), 6th to UEL, 7th to UECL
      // Ligue 1 (18): Top 4 to UCL (pos 1-4), 5th to UEL, 6th to UECL
      // Total UCL Participants = 5 + 5 + 5 + 5 + 4 = 24 clubs
      const isLigue1 = league.id.includes('ligue-1') || league.name.toLowerCase().includes('ligue 1');
      const uclSpots = isLigue1 ? 4 : (formatConfig.qualificationSpots || 5);
      const uelSpots = 1;
      const ueclSpots = 1;

      // 1. Qualify top N for UEFA Champions League
      if (uclComp) {
        for (let i = 0; i < Math.min(uclSpots, standings.length); i++) {
          const row = standings[i];
          const owner = queryGet<{ user_id: string }>(
            'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
            [row.clubId, seasonId]
          );

          const reason = `${league.name} Rank #${row.position} (UCL Spot)`;
          qualifications.push({
            seasonId,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            targetCompetitionId: uclComp.id,
            targetCompetitionName: uclComp.name,
            clubId: row.clubId,
            clubName: row.clubName,
            ownerUserId: owner?.user_id || null,
            rank: row.position,
            reason,
          });

          // Permanent snapshot into competition_participants
          const partId = `part-${uclComp.id}-${row.clubId}`;
          const existing = queryGet('SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ?', [
            uclComp.id,
            row.clubId,
          ]);

          if (!existing) {
            queryRun(
              `INSERT INTO competition_participants (
                id, competition_id, club_id, season_id, owner_user_id,
                source_competition_id, source_position, qualification_reason,
                qualification_timestamp, seed_number, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                partId,
                uclComp.id,
                row.clubId,
                seasonId,
                owner?.user_id || null,
                league.id,
                row.position,
                reason,
                now,
                qualifications.length,
                now,
              ]
            );
            participantsAdded++;

            if (owner) {
              createNotification(
                owner.user_id,
                'QUALIFICATION_CONFIRMED',
                '🏆 Qualified for UEFA Champions League!',
                `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Champions League!`
              );
            }
          }
        }
      }

      // 2. Qualify next M for UEFA Europa League
      if (uelComp) {
        for (let i = uclSpots; i < Math.min(uclSpots + uelSpots, standings.length); i++) {
          const row = standings[i];
          const owner = queryGet<{ user_id: string }>(
            'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
            [row.clubId, seasonId]
          );

          const reason = `${league.name} Rank #${row.position} (UEL Spot)`;
          qualifications.push({
            seasonId,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            targetCompetitionId: uelComp.id,
            targetCompetitionName: uelComp.name,
            clubId: row.clubId,
            clubName: row.clubName,
            ownerUserId: owner?.user_id || null,
            rank: row.position,
            reason,
          });

          const partId = `part-${uelComp.id}-${row.clubId}`;
          const existing = queryGet('SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ?', [
            uelComp.id,
            row.clubId,
          ]);

          if (!existing) {
            queryRun(
              `INSERT INTO competition_participants (
                id, competition_id, club_id, season_id, owner_user_id,
                source_competition_id, source_position, qualification_reason,
                qualification_timestamp, seed_number, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                partId,
                uelComp.id,
                row.clubId,
                seasonId,
                owner?.user_id || null,
                league.id,
                row.position,
                reason,
                now,
                qualifications.length,
                now,
              ]
            );
            participantsAdded++;

            if (owner) {
              createNotification(
                owner.user_id,
                'QUALIFICATION_CONFIRMED',
                'Qualified for UEFA Europa League',
                `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Europa League!`
              );
            }
          }
        }
      }

      // 3. Qualify next K for UEFA Conference League
      if (ueclComp) {
        for (let i = uclSpots + uelSpots; i < Math.min(uclSpots + uelSpots + ueclSpots, standings.length); i++) {
          const row = standings[i];
          const owner = queryGet<{ user_id: string }>(
            'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
            [row.clubId, seasonId]
          );

          const reason = `${league.name} Rank #${row.position} (UECL Spot)`;
          qualifications.push({
            seasonId,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            targetCompetitionId: ueclComp.id,
            targetCompetitionName: ueclComp.name,
            clubId: row.clubId,
            clubName: row.clubName,
            ownerUserId: owner?.user_id || null,
            rank: row.position,
            reason,
          });

          const partId = `part-${ueclComp.id}-${row.clubId}`;
          const existing = queryGet('SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ?', [
            ueclComp.id,
            row.clubId,
          ]);

          if (!existing) {
            queryRun(
              `INSERT INTO competition_participants (
                id, competition_id, club_id, season_id, owner_user_id,
                source_competition_id, source_position, qualification_reason,
                qualification_timestamp, seed_number, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                partId,
                ueclComp.id,
                row.clubId,
                seasonId,
                owner?.user_id || null,
                league.id,
                row.position,
                reason,
                now,
                qualifications.length,
                now,
              ]
            );
            participantsAdded++;

            if (owner) {
              createNotification(
                owner.user_id,
                'QUALIFICATION_CONFIRMED',
                'Qualified for UEFA Conference League',
                `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Conference League!`
              );
            }
          }
        }
      }
    }

    createAuditLog(
      'system',
      'EVALUATE_QUALIFICATIONS',
      'seasons',
      seasonId,
      null,
      { totalQualified: qualifications.length, participantsAdded }
    );

    return {
      success: true,
      qualifications,
      participantsAdded,
    };
  });
}

/**
 * Automatically populates Super Cup participants dynamically from platform competition results
 */
export function populateSuperCupParticipants(seasonId: string, superCupCompetitionId: string): {
  success: boolean;
  participants: Array<{ clubId: string; clubName: string; reason: string }>;
} {
  return dbTransaction(() => {
    const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [superCupCompetitionId]);
    if (!comp || comp.type !== 'SUPER_CUP') {
      throw new Error(`Competition '${superCupCompetitionId}' is not a Super Cup.`);
    }

    const participants: Array<{ clubId: string; clubName: string; reason: string }> = [];
    const now = new Date().toISOString();

    // 1. UEFA Super Cup (UCL Winner vs UEL Winner)
    if (comp.name.includes('UEFA Super Cup') || comp.id.includes('uefa-super-cup')) {
      const uclFinal = queryGet<any>(
        `SELECT winner_club_id FROM fixtures WHERE competition_id LIKE '%champions%' AND round_name = 'Final' AND status = 'CONFIRMED'`
      );
      const uelFinal = queryGet<any>(
        `SELECT winner_club_id FROM fixtures WHERE competition_id LIKE '%europa%' AND round_name = 'Final' AND status = 'CONFIRMED'`
      );

      if (uclFinal?.winner_club_id) {
        participants.push({ clubId: uclFinal.winner_club_id, clubName: '', reason: 'UEFA Champions League Winner' });
      }
      if (uelFinal?.winner_club_id && uelFinal.winner_club_id !== uclFinal?.winner_club_id) {
        participants.push({ clubId: uelFinal.winner_club_id, clubName: '', reason: 'UEFA Europa League Winner' });
      }
    } else {
      // 2. Domestic Super Cups (League Champion + Cup Winner)
      const leagueComp = queryGet<any>(
        `SELECT id, name FROM competitions WHERE season_id = ? AND league_id = ? AND type = 'LEAGUE'`,
        [seasonId, comp.league_id]
      );
      const cupComp = queryGet<any>(
        `SELECT id, name FROM competitions WHERE season_id = ? AND league_id = ? AND type = 'KNOCKOUT'`,
        [seasonId, comp.league_id]
      );

      let leagueWinnerId: string | null = null;
      let leagueRunnerUpId: string | null = null;

      if (leagueComp) {
        const standings = calculateCompetitionStandings(leagueComp.id);
        if (standings.length > 0) {
          leagueWinnerId = standings[0].clubId;
        }
        if (standings.length > 1) {
          leagueRunnerUpId = standings[1].clubId;
        }
      }

      let cupWinnerId: string | null = null;
      let cupRunnerUpId: string | null = null;

      if (cupComp) {
        const cupFinal = queryGet<any>(
          `SELECT home_club_id, away_club_id, winner_club_id FROM fixtures WHERE competition_id = ? AND round_name = 'Final' AND status = 'CONFIRMED'`,
          [cupComp.id]
        );
        if (cupFinal?.winner_club_id) {
          cupWinnerId = cupFinal.winner_club_id;
          cupRunnerUpId = cupFinal.winner_club_id === cupFinal.home_club_id ? cupFinal.away_club_id : cupFinal.home_club_id;
        }
      }

      // Add League Winner
      if (leagueWinnerId) {
        participants.push({ clubId: leagueWinnerId, clubName: '', reason: `${leagueComp?.name || 'League'} Champion` });
      }

      // Add Cup Winner or deterministic fallback if double winner
      if (cupWinnerId && cupWinnerId !== leagueWinnerId) {
        participants.push({ clubId: cupWinnerId, clubName: '', reason: `${cupComp?.name || 'Cup'} Winner` });
      } else if (leagueRunnerUpId) {
        // Deterministic rule for Double Winner: League Runner-up qualifies for Super Cup
        participants.push({ clubId: leagueRunnerUpId, clubName: '', reason: `${leagueComp?.name || 'League'} Runner-up (Double Winner Rule)` });
      }
    }

    // Insert participants into database
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const club = queryGet<any>('SELECT name FROM clubs WHERE id = ?', [p.clubId]);
      p.clubName = club?.name || p.clubId;

      const owner = queryGet<{ user_id: string }>(
        'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
        [p.clubId, seasonId]
      );

      const partId = `part-${comp.id}-${p.clubId}`;
      const existing = queryGet('SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ?', [
        comp.id,
        p.clubId,
      ]);

      if (!existing) {
        queryRun(
          `INSERT INTO competition_participants (
            id, competition_id, club_id, season_id, owner_user_id,
            source_competition_id, source_position, qualification_reason,
            qualification_timestamp, seed_number, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            partId,
            comp.id,
            p.clubId,
            seasonId,
            owner?.user_id || null,
            comp.league_id || null,
            i + 1,
            p.reason,
            now,
            i + 1,
            now,
          ]
        );
      }
    }

    return { success: true, participants };
  });
}

