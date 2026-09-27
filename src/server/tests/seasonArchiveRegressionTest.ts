process.env.FIREBASE_FORCE_LOCAL_FALLBACK = 'true';
process.env.NODE_ENV = 'test';

import { getFirestoreDb } from '../firebase/admin';
import { SEED_COMPETITIONS } from '../db/seed';
import { TrophyRecord } from '../services/seasonInsightsService';
import { archiveCompletedSeason, getSeasonArchive, listSeasonArchives, missingArchiveTrophies } from '../services/seasonArchiveService';

async function main() {
  const seasonId = 'season-2026-27';
  const trophies = SEED_COMPETITIONS.filter((competition) => competition.seasonId === seasonId)
    .map((competition): TrophyRecord => ({ competitionId: competition.id, competitionName: competition.name,
      seasonId, clubId: 'club-arsenal', clubName: 'Arsenal', decidedBy: 'FINAL' }));
  if (missingArchiveTrophies(seasonId, trophies).length !== 0) throw new Error('Complete trophy set rejected');
  if (missingArchiveTrophies(seasonId, trophies.slice(1)).length !== 1) throw new Error('Missing trophy not detected');

  const archive = { seasonId, status: 'ARCHIVED', archivedAt: '2027-07-01T00:00:00.000Z',
    archivedBy: 'test-admin', trophies, awards: [], finalStandings: [] };
  await getFirestoreDb().collection('season_archives').doc(seasonId).set(archive);
  const read = await getSeasonArchive(seasonId);
  if (read?.trophies.length !== trophies.length) throw new Error('Archived trophies not persisted');
  const listed = await listSeasonArchives();
  if (listed.length !== 1 || listed[0].trophyCount !== trophies.length) throw new Error('Archive list incorrect');
  const repeated = await archiveCompletedSeason(seasonId, 'another-admin');
  if (!repeated.alreadyArchived || repeated.archive.archivedBy !== 'test-admin') throw new Error('Archive was overwritten');
  if (await getSeasonArchive('season-2025-26')) throw new Error('Missing archive returned data');
  console.log('SEASON_ARCHIVE_REGRESSION_PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
