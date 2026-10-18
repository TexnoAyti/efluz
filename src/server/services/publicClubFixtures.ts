import type { Club, Fixture } from '../../types';
import { getAdminFixturesFromReadModel } from '../readModel/readModelStore';
import { filterPublishedEuropeanFixtures } from './europeanFixtureGate';
import { filterTombstonedFixtures } from './fixtureTombstoneService';
import { sortSeasonFixtures } from '../../lib/fixtureOrder';

function publicClub(club: Club | null | undefined): Club | null {
  if (!club) return null;
  return { id: club.id, name: club.name, shortName: club.shortName, country: club.country,
    leagueId: club.leagueId, logoUrl: club.logoUrl, stadium: club.stadium,
    active: club.active, createdAt: club.createdAt };
}

/** Explicit public projection: no submissions, proofs, contact data or admin notes. */
export function publicClubFixture(f: Fixture): Fixture {
  const confirmed = f.status === 'CONFIRMED';
  return {
    id: f.id, seasonId: f.seasonId, competitionId: f.competitionId, competitionName: f.competitionName,
    matchday: f.matchday, roundName: f.roundName, homeClubId: f.homeClubId, awayClubId: f.awayClubId,
    homeClub: publicClub(f.homeClub), awayClub: publicClub(f.awayClub),
    scheduledAt: f.scheduledAt, venue: f.venue, status: f.status,
    homeScore: confirmed ? f.homeScore : null, awayScore: confirmed ? f.awayScore : null,
    homeExtraTimeScore: confirmed ? f.homeExtraTimeScore : null, awayExtraTimeScore: confirmed ? f.awayExtraTimeScore : null,
    homePenaltyScore: confirmed ? f.homePenaltyScore : null, awayPenaltyScore: confirmed ? f.awayPenaltyScore : null,
    createdAt: f.createdAt, updatedAt: f.updatedAt,
  };
}

export async function getPublicClubFixtures(clubId: string, seasonId: string) {
  const all: Fixture[] = [];
  let cursor: string | undefined, stale = false, degraded = false;
  const seen = new Set<string>();
  do {
    const result = await getAdminFixturesFromReadModel({ clubId, seasonId, cursor, limit: 100 });
    all.push(...result.fixtures.filter(f => f.seasonId === seasonId && (f.homeClubId === clubId || f.awayClubId === clubId)));
    stale ||= result.stale; degraded ||= result.degraded;
    cursor = result.hasMore ? result.nextCursor : undefined;
    if (cursor && seen.has(cursor)) throw new Error('CLUB_FIXTURE_CURSOR_REPEATED');
    if (cursor) seen.add(cursor);
  } while (cursor);
  const published = await filterPublishedEuropeanFixtures(all);
  const visible = await filterTombstonedFixtures(published, seasonId);
  const unique = [...new Map(visible.map(f => [f.id, f])).values()];
  return { fixtures: sortSeasonFixtures(unique).map(publicClubFixture), stale, degraded };
}
