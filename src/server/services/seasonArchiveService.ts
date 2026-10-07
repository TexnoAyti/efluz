import { getFirestoreDb } from '../firebase/admin';
import { trackFirestoreRead, trackFirestoreWrite } from '../firebase/firestoreStore';
import { SEED_COMPETITIONS } from '../db/seed';
import { createAuditLog } from './adminService';
import { getSeasonTrophies, getSeasonAwards, TrophyRecord } from './seasonInsightsService';
import { getQualificationTracker, getSeasonRolloverPreview } from './seasonOperationsService';
import { DOMESTIC_LEAGUE_CONFIG } from '../readModel/readModelStore';
import { invalidateTrophyHistory, preserveRecordedTrophyOwners } from './playerTrophyService';

const COLLECTION = 'season_archives';

export interface SeasonArchive {
  seasonId: string;
  status: 'ARCHIVED';
  archivedAt: string;
  archivedBy: string;
  trophies: TrophyRecord[];
  awards: Awaited<ReturnType<typeof getSeasonAwards>>['awards'];
  finalStandings: Awaited<ReturnType<typeof getQualificationTracker>>['leagues'];
}

function validSeasonId(seasonId: string) {
  if (!/^season-\d{4}-\d{2}$/.test(seasonId)) throw new Error('INVALID_SEASON_ID');
  return seasonId;
}

export function missingArchiveTrophies(seasonId: string, trophies: TrophyRecord[]): string[] {
  const expected = SEED_COMPETITIONS.filter((competition) => competition.seasonId === seasonId);
  if (!expected.length) return ['SEASON_COMPETITIONS_NOT_CONFIGURED'];
  const decided = new Set(trophies.filter((trophy) => trophy.seasonId === seasonId).map((trophy) => trophy.competitionId));
  return expected.filter((competition) => !decided.has(competition.id))
    .map((competition) => competition.id);
}

export async function getSeasonArchive(seasonId: string): Promise<SeasonArchive | null> {
  const doc = await getFirestoreDb().collection(COLLECTION).doc(validSeasonId(seasonId)).get();
  trackFirestoreRead(COLLECTION, 1, 'getSeasonArchive');
  return doc.exists ? doc.data() as SeasonArchive : null;
}

export async function listSeasonArchives() {
  const snap = await getFirestoreDb().collection(COLLECTION).orderBy('archivedAt', 'desc').limit(20).get();
  trackFirestoreRead(COLLECTION, snap.size, 'listSeasonArchives');
  return snap.docs.map((doc) => {
    const data = doc.data() as SeasonArchive;
    return { seasonId: doc.id, archivedAt: data.archivedAt, trophyCount: data.trophies?.length || 0 };
  }).sort((a, b) => b.seasonId.localeCompare(a.seasonId));
}

export async function archiveCompletedSeason(seasonId: string, actorUserId: string, actorUsername = 'admin') {
  validSeasonId(seasonId);
  const existing = await getSeasonArchive(seasonId);
  if (existing) return { archive: existing, alreadyArchived: true };

  const preview = await getSeasonRolloverPreview(seasonId);
  if (!preview.canRollover) throw new Error(`SEASON_ARCHIVE_BLOCKED: ${preview.blockers.join('; ')}`);
  const [trophyResult, awardResult, qualification] = await Promise.all([
    getSeasonTrophies(seasonId), getSeasonAwards(seasonId), getQualificationTracker(seasonId),
  ]);
  const missing = missingArchiveTrophies(seasonId, trophyResult.trophies);
  if (missing.length) throw new Error(`SEASON_ARCHIVE_BLOCKED: trophies not decided: ${missing.join(', ')}`);
  if (qualification.leagues.length !== 5 || qualification.leagues.some((league) => {
    const expected = DOMESTIC_LEAGUE_CONFIG[league.competitionId]?.expectedCount;
    return !expected || league.rows.length !== expected || league.rows.some((row) => row.played !== expected - 1);
  })) {
    throw new Error('SEASON_ARCHIVE_BLOCKED: final league standings are incomplete.');
  }

  const archive: SeasonArchive = {
    seasonId, status: 'ARCHIVED', archivedAt: new Date().toISOString(), archivedBy: actorUserId,
    trophies: await preserveRecordedTrophyOwners(trophyResult.trophies), awards: awardResult.awards, finalStandings: qualification.leagues,
  };
  const ref = getFirestoreDb().collection(COLLECTION).doc(seasonId);
  const created = await getFirestoreDb().runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);
    if (doc.exists) return false;
    transaction.set(ref, archive);
    return true;
  });
  if (created) {
    trackFirestoreWrite(COLLECTION, 1, 'archiveCompletedSeason');
    await invalidateTrophyHistory().catch(() => {});
    await createAuditLog(actorUserId, 'SEASON_ARCHIVED', 'SEASON', seasonId, undefined,
      { archivedAt: archive.archivedAt, trophies: archive.trophies.length }, undefined, actorUsername,
      'Immutable season trophy and final standings snapshot created.').catch(() => {});
  }
  return { archive: created ? archive : (await getSeasonArchive(seasonId))!, alreadyArchived: !created };
}
