import { getFirestoreDb } from '../firebase/admin';
import {
  COLLECTIONS,
  FirestoreCompetitionDoc,
  FirestoreCompetitionParticipantDoc,
  FirestoreFixtureDoc,
  FirestoreClubDoc,
} from '../firebase/collections';
import { calculateCompetitionStandingsFirestore } from '../firebase/firestoreStore';
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
 * Evaluates European & Super Cup qualification rules across all competitions in a season
 * directly in Cloud Firestore using batched writes for maximum performance and consistency.
 */
export async function evaluateSeasonQualifications(seasonId = 'season-2026-27'): Promise<{
  success: boolean;
  qualifications: QualificationResult[];
  participantsAdded: number;
}> {
  const db = getFirestoreDb();
  const qualifications: QualificationResult[] = [];
  let participantsAdded = 0;
  const now = new Date().toISOString();

  // 1. Fetch all competitions & existing participants in parallel
  const [compSnap, existingPartsSnap, occupanciesSnap] = await Promise.all([
    db.collection(COLLECTIONS.COMPETITIONS).where('seasonId', '==', seasonId).get(),
    db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('seasonId', '==', seasonId).get(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).get(),
  ]);

  const allComps = compSnap.docs.map((d) => d.data() as FirestoreCompetitionDoc);
  const leagues = allComps.filter((c) => c.type === 'LEAGUE');

  const existingPartIds = new Set(existingPartsSnap.docs.map((d) => d.id));
  const occupancyMap = new Map<string, string>(); // clubId -> userId
  for (const doc of occupanciesSnap.docs) {
    const data = doc.data();
    if (data.userId && data.clubId) {
      occupancyMap.set(data.clubId, data.userId);
    }
  }

  // Target European competitions
  const uclComp = allComps.find(
    (c) => c.type === 'EUROPEAN_LEAGUE_PHASE' && (c.name.toLowerCase().includes('champions league') || c.id.includes('ucl'))
  );
  const uelComp = allComps.find(
    (c) => c.type === 'EUROPEAN_LEAGUE_PHASE' && (c.name.toLowerCase().includes('europa league') || c.id.includes('uel'))
  );
  const ueclComp = allComps.find(
    (c) => c.type === 'EUROPEAN_LEAGUE_PHASE' && (c.name.toLowerCase().includes('conference league') || c.id.includes('uecl'))
  );

  const newParticipants: FirestoreCompetitionParticipantDoc[] = [];
  const notificationsToSend: Array<{ userId: string; title: string; message: string }> = [];

  for (const league of leagues) {
    const standings = await calculateCompetitionStandingsFirestore(league.id);
    if (standings.length === 0) continue;

    const formatConfig = league.formatConfig || {};
    const isLigue1 = league.id.includes('ligue-1') || league.name.toLowerCase().includes('ligue 1');
    const uclSpots = isLigue1 ? 4 : (formatConfig.qualificationSpots || 5);
    const uelSpots = 1;
    const ueclSpots = 1;

    // 1. Qualify top N for UEFA Champions League
    if (uclComp) {
      for (let i = 0; i < Math.min(uclSpots, standings.length); i++) {
        const row = standings[i];
        const ownerUserId = occupancyMap.get(row.clubId) || null;
        const reason = `${league.name} Rank #${row.position} (UCL Spot)`;

        qualifications.push({
          seasonId,
          sourceCompetitionId: league.id,
          sourceCompetitionName: league.name,
          targetCompetitionId: uclComp.id,
          targetCompetitionName: uclComp.name,
          clubId: row.clubId,
          clubName: row.clubName,
          ownerUserId,
          rank: row.position,
          reason,
        });

        const partId = `part-${uclComp.id}-${row.clubId}`;
        if (!existingPartIds.has(partId)) {
          newParticipants.push({
            id: partId,
            competitionId: uclComp.id,
            clubId: row.clubId,
            seasonId,
            ownerUserId: ownerUserId || undefined,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            sourcePosition: row.position,
            qualificationReason: reason,
            qualificationTimestamp: now,
            seedNumber: qualifications.length,
            createdAt: now,
          });
          existingPartIds.add(partId);
          participantsAdded++;

          if (ownerUserId) {
            notificationsToSend.push({
              userId: ownerUserId,
              title: '🏆 Qualified for UEFA Champions League!',
              message: `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Champions League!`,
            });
          }
        }
      }
    }

    // 2. Qualify next M for UEFA Europa League
    if (uelComp) {
      for (let i = uclSpots; i < Math.min(uclSpots + uelSpots, standings.length); i++) {
        const row = standings[i];
        const ownerUserId = occupancyMap.get(row.clubId) || null;
        const reason = `${league.name} Rank #${row.position} (UEL Spot)`;

        qualifications.push({
          seasonId,
          sourceCompetitionId: league.id,
          sourceCompetitionName: league.name,
          targetCompetitionId: uelComp.id,
          targetCompetitionName: uelComp.name,
          clubId: row.clubId,
          clubName: row.clubName,
          ownerUserId,
          rank: row.position,
          reason,
        });

        const partId = `part-${uelComp.id}-${row.clubId}`;
        if (!existingPartIds.has(partId)) {
          newParticipants.push({
            id: partId,
            competitionId: uelComp.id,
            clubId: row.clubId,
            seasonId,
            ownerUserId: ownerUserId || undefined,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            sourcePosition: row.position,
            qualificationReason: reason,
            qualificationTimestamp: now,
            seedNumber: qualifications.length,
            createdAt: now,
          });
          existingPartIds.add(partId);
          participantsAdded++;

          if (ownerUserId) {
            notificationsToSend.push({
              userId: ownerUserId,
              title: 'Qualified for UEFA Europa League',
              message: `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Europa League!`,
            });
          }
        }
      }
    }

    // 3. Qualify next K for UEFA Conference League
    if (ueclComp) {
      for (let i = uclSpots + uelSpots; i < Math.min(uclSpots + uelSpots + ueclSpots, standings.length); i++) {
        const row = standings[i];
        const ownerUserId = occupancyMap.get(row.clubId) || null;
        const reason = `${league.name} Rank #${row.position} (UECL Spot)`;

        qualifications.push({
          seasonId,
          sourceCompetitionId: league.id,
          sourceCompetitionName: league.name,
          targetCompetitionId: ueclComp.id,
          targetCompetitionName: ueclComp.name,
          clubId: row.clubId,
          clubName: row.clubName,
          ownerUserId,
          rank: row.position,
          reason,
        });

        const partId = `part-${ueclComp.id}-${row.clubId}`;
        if (!existingPartIds.has(partId)) {
          newParticipants.push({
            id: partId,
            competitionId: ueclComp.id,
            clubId: row.clubId,
            seasonId,
            ownerUserId: ownerUserId || undefined,
            sourceCompetitionId: league.id,
            sourceCompetitionName: league.name,
            sourcePosition: row.position,
            qualificationReason: reason,
            qualificationTimestamp: now,
            seedNumber: qualifications.length,
            createdAt: now,
          });
          existingPartIds.add(partId);
          participantsAdded++;

          if (ownerUserId) {
            notificationsToSend.push({
              userId: ownerUserId,
              title: 'Qualified for UEFA Conference League',
              message: `Congratulations! ${row.clubName} finished #${row.position} in ${league.name} and qualified for the UEFA Conference League!`,
            });
          }
        }
      }
    }
  }

  // Batch write all new participants
  if (newParticipants.length > 0) {
    const batch = db.batch();
    for (const part of newParticipants) {
      const ref = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(part.id);
      batch.set(ref, part);
    }
    await batch.commit();
  }

  // Send notifications in parallel
  await Promise.all(
    notificationsToSend.map((n) =>
      createNotification(n.userId, 'QUALIFICATION_CONFIRMED', n.title, n.message).catch(() => {})
    )
  );

  await createAuditLog(
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
}

export const evaluateSeasonQualificationsFirestore = evaluateSeasonQualifications;

/**
 * Automatically populates Super Cup participants dynamically from platform competition results in Firestore.
 */
export async function populateSuperCupParticipants(
  seasonId: string,
  superCupCompetitionId: string
): Promise<{
  success: boolean;
  participants: Array<{ clubId: string; clubName: string; reason: string }>;
}> {
  const db = getFirestoreDb();
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(superCupCompetitionId).get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${superCupCompetitionId}' not found.`);
  }
  const comp = compDoc.data() as FirestoreCompetitionDoc;
  if (comp.type !== 'SUPER_CUP') {
    throw new Error(`Competition '${superCupCompetitionId}' is not a Super Cup.`);
  }

  const participants: Array<{ clubId: string; clubName: string; reason: string }> = [];
  const now = new Date().toISOString();

  // 1. UEFA Super Cup (UCL Winner vs UEL Winner)
  if (comp.name.includes('UEFA Super Cup') || comp.id.includes('uefa-super-cup')) {
    const fixSnap = await db
      .collection(COLLECTIONS.FIXTURES)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'CONFIRMED')
      .get();

    const confirmedFixtures = fixSnap.docs.map((d) => d.data() as FirestoreFixtureDoc);
    const uclFinal = confirmedFixtures.find((f) => f.competitionId.includes('champions') && f.roundName === 'Final');
    const uelFinal = confirmedFixtures.find((f) => f.competitionId.includes('europa') && f.roundName === 'Final');

    if (uclFinal?.winnerClubId) {
      participants.push({ clubId: uclFinal.winnerClubId, clubName: '', reason: 'UEFA Champions League Winner' });
    }
    if (uelFinal?.winnerClubId && uelFinal.winnerClubId !== uclFinal?.winnerClubId) {
      participants.push({ clubId: uelFinal.winnerClubId, clubName: '', reason: 'UEFA Europa League Winner' });
    }
  } else {
    // 2. Domestic Super Cups (League Champion + Cup Winner)
    const compSnap = await db.collection(COLLECTIONS.COMPETITIONS).where('seasonId', '==', seasonId).get();
    const allComps = compSnap.docs.map((d) => d.data() as FirestoreCompetitionDoc);

    const leagueComp = allComps.find((c) => c.leagueId === comp.leagueId && c.type === 'LEAGUE');
    const cupComp = allComps.find((c) => c.leagueId === comp.leagueId && c.type === 'KNOCKOUT');

    let leagueWinnerId: string | null = null;
    let leagueRunnerUpId: string | null = null;

    if (leagueComp) {
      const standings = await calculateCompetitionStandingsFirestore(leagueComp.id);
      if (standings.length > 0) {
        leagueWinnerId = standings[0].clubId;
      }
      if (standings.length > 1) {
        leagueRunnerUpId = standings[1].clubId;
      }
    }

    let cupWinnerId: string | null = null;
    if (cupComp) {
      const fixSnap = await db
        .collection(COLLECTIONS.FIXTURES)
        .where('competitionId', '==', cupComp.id)
        .where('roundName', '==', 'Final')
        .where('status', '==', 'CONFIRMED')
        .get();

      if (!fixSnap.empty) {
        const cupFinal = fixSnap.docs[0].data() as FirestoreFixtureDoc;
        cupWinnerId = cupFinal.winnerClubId || null;
      }
    }

    if (leagueWinnerId) {
      participants.push({ clubId: leagueWinnerId, clubName: '', reason: `${leagueComp?.name || 'League'} Champion` });
    }

    if (cupWinnerId && cupWinnerId !== leagueWinnerId) {
      participants.push({ clubId: cupWinnerId, clubName: '', reason: `${cupComp?.name || 'Cup'} Winner` });
    } else if (leagueRunnerUpId) {
      participants.push({ clubId: leagueRunnerUpId, clubName: '', reason: `${leagueComp?.name || 'League'} Runner-up (Double Winner Rule)` });
    }
  }

  // Insert participants into Firestore with batch
  if (participants.length > 0) {
    const batch = db.batch();
    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const clubDoc = await db.collection(COLLECTIONS.CLUBS).doc(p.clubId).get();
      p.clubName = clubDoc.exists ? (clubDoc.data() as FirestoreClubDoc).name : p.clubId;

      const occDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${p.clubId}`).get();
      const ownerUserId = occDoc.exists ? occDoc.data()?.userId || null : null;

      const partId = `part-${comp.id}-${p.clubId}`;
      const partRef = db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).doc(partId);
      const existingPart = await partRef.get();

      if (!existingPart.exists) {
        const participantDoc: FirestoreCompetitionParticipantDoc = {
          id: partId,
          competitionId: comp.id,
          clubId: p.clubId,
          seasonId,
          ownerUserId: ownerUserId || undefined,
          sourceCompetitionId: comp.leagueId || undefined,
          sourcePosition: i + 1,
          qualificationReason: p.reason,
          qualificationTimestamp: now,
          seedNumber: i + 1,
          createdAt: now,
        };
        batch.set(partRef, participantDoc);
      }
    }
    await batch.commit();
  }

  return { success: true, participants };
}

export const populateSuperCupParticipantsFirestore = populateSuperCupParticipants;
