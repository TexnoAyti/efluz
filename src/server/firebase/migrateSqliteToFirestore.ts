import { getFirestoreDb } from './admin';
import { COLLECTIONS } from './collections';
import { queryAll, queryGet } from '../db';

export interface MigrationReport {
  timestamp: string;
  source: 'sqlite';
  target: 'firestore';
  sqliteCounts: Record<string, number>;
  firestoreCounts: Record<string, number>;
  success: boolean;
  errors: string[];
}

export async function migrateSqliteToFirestore(): Promise<MigrationReport> {
  const db = getFirestoreDb();
  const errors: string[] = [];

  // 1. Inspect SQLite Counts
  const sqliteCounts: Record<string, number> = {
    users: queryGet<{ count: number }>('SELECT count(*) as count FROM users')?.count || 0,
    seasons: queryGet<{ count: number }>('SELECT count(*) as count FROM seasons')?.count || 0,
    leagues: queryGet<{ count: number }>('SELECT count(*) as count FROM leagues')?.count || 0,
    clubs: queryGet<{ count: number }>('SELECT count(*) as count FROM clubs')?.count || 0,
    competitions: queryGet<{ count: number }>('SELECT count(*) as count FROM competitions')?.count || 0,
    competition_participants:
      queryGet<{ count: number }>('SELECT count(*) as count FROM competition_participants')?.count || 0,
    club_memberships: queryGet<{ count: number }>('SELECT count(*) as count FROM club_memberships')?.count || 0,
    fixtures: queryGet<{ count: number }>('SELECT count(*) as count FROM fixtures')?.count || 0,
  };

  console.log('[Migration] Starting SQLite to Firestore migration...');
  console.log('[Migration] Source SQLite counts:', JSON.stringify(sqliteCounts, null, 2));

  // 2. Migrate Seasons
  try {
    const seasons = queryAll<any>('SELECT * FROM seasons');
    const batch = db.batch();
    for (const s of seasons) {
      const ref = db.collection(COLLECTIONS.SEASONS).doc(s.id);
      batch.set(ref, {
        id: s.id,
        name: s.name,
        status: s.status,
        startDate: s.start_date || null,
        endDate: s.end_date || null,
        createdAt: s.created_at || new Date().toISOString(),
      });
    }
    await batch.commit();
  } catch (err: any) {
    errors.push(`Seasons migration error: ${err.message}`);
  }

  // 3. Migrate Leagues
  try {
    const leagues = queryAll<any>('SELECT * FROM leagues');
    const batch = db.batch();
    for (const l of leagues) {
      const ref = db.collection(COLLECTIONS.LEAGUES).doc(l.id);
      batch.set(
        ref,
        {
          id: l.id,
          name: l.name,
          country: l.country,
          tier: l.tier,
          logo: l.logo_url,
          createdAt: l.created_at || new Date().toISOString(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  } catch (err: any) {
    errors.push(`Leagues migration error: ${err.message}`);
  }

  // 4. Migrate Clubs
  try {
    const clubs = queryAll<any>('SELECT * FROM clubs');
    const chunkSize = 400;
    for (let i = 0; i < clubs.length; i += chunkSize) {
      const chunk = clubs.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const c of chunk) {
        const ref = db.collection(COLLECTIONS.CLUBS).doc(c.id);
        batch.set(
          ref,
          {
            id: c.id,
            name: c.name,
            shortName: c.short_name,
            leagueId: c.league_id,
            country: c.country,
            logo: c.logo_url,
            isActive: c.active !== undefined ? Boolean(c.active) : (c.is_active !== undefined ? Boolean(c.is_active) : true),
            createdAt: c.created_at || new Date().toISOString(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    }
  } catch (err: any) {
    errors.push(`Clubs migration error: ${err.message}`);
  }

  // 5. Migrate Competitions
  try {
    // Purge obsolete competitions if they exist in Firestore
    const obsoleteIds = ['comp-trophee-des-champions-2026', 'comp-trophee-des-champions'];
    for (const obsId of obsoleteIds) {
      await db.collection(COLLECTIONS.COMPETITIONS).doc(obsId).delete().catch(() => {});
    }

    const competitions = queryAll<any>('SELECT * FROM competitions');
    const batch = db.batch();
    for (const comp of competitions) {
      const ref = db.collection(COLLECTIONS.COMPETITIONS).doc(comp.id);
      batch.set(ref, {
        id: comp.id,
        seasonId: comp.season_id,
        leagueId: comp.league_id || null,
        name: comp.name,
        type: comp.type,
        scheduleMode: comp.schedule_mode,
        status: comp.status,
        formatConfig: comp.format_config_json ? JSON.parse(comp.format_config_json) : {},
        createdAt: comp.created_at || new Date().toISOString(),
      });
    }
    await batch.commit();
  } catch (err: any) {
    errors.push(`Competitions migration error: ${err.message}`);
  }

  // 6. Migrate Competition Participants
  try {
    const participants = queryAll<any>('SELECT * FROM competition_participants');
    const chunkSize = 400;
    for (let i = 0; i < participants.length; i += chunkSize) {
      const chunk = participants.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const p of chunk) {
        const ref = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(p.id);
        batch.set(ref, {
          id: p.id,
          competitionId: p.competition_id,
          clubId: p.club_id,
          seasonId: p.season_id,
          ownerUserId: p.owner_user_id || null,
          ownerUsername: p.owner_username || null,
          sourceCompetitionId: p.source_competition_id || null,
          sourceCompetitionName: p.source_competition_name || null,
          sourcePosition: p.source_position || null,
          qualificationReason: p.qualification_reason || null,
          qualificationTimestamp: p.qualification_timestamp || null,
          seedNumber: p.seed_number || null,
          createdAt: p.created_at || new Date().toISOString(),
        });
      }
      await batch.commit();
    }
  } catch (err: any) {
    errors.push(`Competition participants migration error: ${err.message}`);
  }

  // 7. Migrate Club Memberships
  try {
    const memberships = queryAll<any>('SELECT * FROM club_memberships');
    const batch = db.batch();
    for (const m of memberships) {
      const ref = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(m.id);
      batch.set(ref, {
        id: m.id,
        seasonId: m.season_id,
        clubId: m.club_id,
        userId: m.user_id,
        status: m.status,
        claimedAt: m.claimed_at,
        updatedAt: m.updated_at || m.claimed_at,
      });

      if (m.status === 'active') {
        const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${m.season_id}_${m.user_id}`);
        const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${m.season_id}_${m.club_id}`);
        batch.set(userMemRef, { userId: m.user_id, clubId: m.club_id, seasonId: m.season_id, status: 'active' });
        batch.set(clubOccRef, { clubId: m.club_id, userId: m.user_id, seasonId: m.season_id, status: 'active' });
      }
    }
    await batch.commit();
  } catch (err: any) {
    errors.push(`Memberships migration error: ${err.message}`);
  }

  // 8. Migrate Fixtures
  try {
    const fixtures = queryAll<any>('SELECT * FROM fixtures');
    const chunkSize = 400;
    for (let i = 0; i < fixtures.length; i += chunkSize) {
      const chunk = fixtures.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const f of chunk) {
        const ref = db.collection(COLLECTIONS.FIXTURES).doc(f.id);
        batch.set(ref, {
          id: f.id,
          competitionId: f.competition_id,
          seasonId: f.season_id,
          matchday: f.matchday,
          roundName: f.round_name,
          homeClubId: f.home_club_id,
          awayClubId: f.away_club_id,
          scheduledAt: f.scheduled_at,
          status: f.status,
          homeScore: f.home_score !== null ? f.home_score : null,
          awayScore: f.away_score !== null ? f.away_score : null,
          winnerClubId: f.winner_club_id || null,
          resultConfirmedAt: f.result_confirmed_at || null,
          createdAt: f.created_at || new Date().toISOString(),
          updatedAt: f.updated_at || new Date().toISOString(),
        });
      }
      await batch.commit();
    }
  } catch (err: any) {
    errors.push(`Fixtures migration error: ${err.message}`);
  }

  // 9. Count Firestore Documents
  const [seasonsSnap, leaguesSnap, clubsSnap, compSnap, partSnap, memSnap, fixSnap] = await Promise.all([
    db.collection(COLLECTIONS.SEASONS).get(),
    db.collection(COLLECTIONS.LEAGUES).get(),
    db.collection(COLLECTIONS.CLUBS).get(),
    db.collection(COLLECTIONS.COMPETITIONS).get(),
    db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).get(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).get(),
    db.collection(COLLECTIONS.FIXTURES).get(),
  ]);

  const firestoreCounts: Record<string, number> = {
    seasons: seasonsSnap.size,
    leagues: leaguesSnap.size,
    clubs: clubsSnap.size,
    competitions: compSnap.size,
    competition_participants: partSnap.size,
    club_memberships: memSnap.size,
    fixtures: fixSnap.size,
  };

  console.log('[Migration] Target Firestore counts:', JSON.stringify(firestoreCounts, null, 2));

  const success =
    errors.length === 0 &&
    firestoreCounts.clubs >= sqliteCounts.clubs &&
    firestoreCounts.leagues >= sqliteCounts.leagues &&
    firestoreCounts.competitions >= sqliteCounts.competitions;

  return {
    timestamp: new Date().toISOString(),
    source: 'sqlite',
    target: 'firestore',
    sqliteCounts,
    firestoreCounts,
    success,
    errors,
  };
}
