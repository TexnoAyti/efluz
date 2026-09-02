import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS, FirestoreCompetitionDoc, FirestoreFixtureDoc, FirestoreCompetitionParticipantDoc, FirestoreClubDoc } from '../firebase/collections';
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
 * with deterministic seeding and round indices directly in Cloud Firestore.
 */
export async function generateKnockoutBracket(
  competitionId: string,
  options: {
    participants?: string[];
    singleLeg?: boolean;
    seedParticipants?: boolean;
    force?: boolean;
  } = {}
): Promise<{ generated: number; rounds: number }> {
  const db = getFirestoreDb();

  // 1. Fetch competition & season
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data() as FirestoreCompetitionDoc;

  // Check existing fixtures
  const existingFixSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  if (!existingFixSnap.empty) {
    if (options.force) {
      const deleteBatch = db.batch();
      for (const fix of existingFixSnap.docs) {
        deleteBatch.delete(fix.ref);
      }
      await deleteBatch.commit();
    } else {
      return { generated: existingFixSnap.size, rounds: 0 };
    }
  }

  // 2. Fetch participating clubs
  let clubIds = options.participants ? [...options.participants] : [];
  if (clubIds.length === 0) {
    const partSnap = await db
      .collection(COLLECTIONS.COMPETITION_PARTICIPANTS)
      .where('competitionId', '==', competitionId)
      .get();
    
    if (!partSnap.empty) {
      const sortedParts = partSnap.docs
        .map((d) => d.data() as FirestoreCompetitionParticipantDoc)
        .sort((a, b) => (a.seedNumber ?? 0) - (b.seedNumber ?? 0));
      clubIds = sortedParts.map((p) => p.clubId);
    }
  }

  // Fallback: If no participants registered, fetch from associated league clubs
  if (clubIds.length === 0 && comp.leagueId) {
    const leagueClubsSnap = await db
      .collection(COLLECTIONS.CLUBS)
      .where('leagueId', '==', comp.leagueId)
      .where('isActive', '==', true)
      .get();
    const sorted = leagueClubsSnap.docs
      .map((d) => d.data() as FirestoreClubDoc)
      .sort((a, b) => a.name.localeCompare(b.name));
    clubIds = sorted.map((c) => c.id);
  }

  if (clubIds.length < 2) {
    throw new Error(`Cannot generate knockout bracket with fewer than 2 teams (found ${clubIds.length}).`);
  }

  // Calculate nearest power of 2 (e.g. 2, 4, 8, 16, 32)
  let bracketSize = 2;
  while (bracketSize < clubIds.length) {
    bracketSize *= 2;
  }

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
  const batch = db.batch();

  // First round matches
  const firstRoundMatches = bracketSize / 2;
  for (let i = 0; i < firstRoundMatches; i++) {
    const homeClubId = clubIds[i * 2] || 'TBD';
    const awayClubId = clubIds[i * 2 + 1] || 'TBD';
    const fixtureId = `fix-${competitionId}-r1-m${i}`;
    const roundName = getRoundName(1);

    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 1,
      roundName,
      homeClubId,
      awayClubId,
      scheduledAt: now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    totalGenerated++;
  }

  // Subsequent rounds (QF, SF, Final) with TBD placeholders
  for (let round = 2; round <= totalRounds; round++) {
    const matchesInRound = Math.pow(2, totalRounds - round);
    const roundName = getRoundName(round);

    for (let m = 0; m < matchesInRound; m++) {
      const fixtureId = `fix-${competitionId}-r${round}-m${m}`;
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: round,
        roundName,
        homeClubId: 'TBD',
        awayClubId: 'TBD',
        scheduledAt: now,
        status: 'SCHEDULED',
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      totalGenerated++;
    }
  }

  // Update competition metadata
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  batch.update(compRef, {
    status: 'active',
    hasFixtures: true,
    fixtureCount: totalGenerated,
    fixturesCount: totalGenerated,
    generationStatus: 'generated',
    updatedAt: now,
  });

  await batch.commit();
  return { generated: totalGenerated, rounds: totalRounds };
}

export const generateKnockoutBracketFirestore = generateKnockoutBracket;

/**
 * Generates UEFA Champions League / Europa League Knockout Phase (Play-offs -> R16 -> QF -> SF -> Final)
 * based on the 32-team single league table standings directly in Firestore.
 * Positions 1-8: Direct to Round of 16
 * Positions 9-24: Knockout Play-offs (16 teams -> 8 winners advance to Round of 16)
 * Positions 25-32: Eliminated
 */
export async function generateUCLKnockoutBracket(
  competitionId: string,
  rankedClubIds: string[]
): Promise<{ generated: number; playoffFixtures: number; r16Fixtures: number }> {
  if (rankedClubIds.length < 24) {
    throw new Error(`European Knockout Phase requires at least 24 ranked clubs (found ${rankedClubIds.length}).`);
  }

  const db = getFirestoreDb();
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }
  const comp = compDoc.data() as FirestoreCompetitionDoc;

  const now = new Date().toISOString();
  let totalGenerated = 0;
  const batch = db.batch();

  const directQualifiers = rankedClubIds.slice(0, 8);
  const playoffClubs = rankedClubIds.slice(8, 24);

  // 1. Generate 8 Play-off Matches (Matchday 9)
  for (let i = 0; i < 8; i++) {
    const seededClubId = playoffClubs[i];
    const unseededClubId = playoffClubs[15 - i];
    const fixtureId = `fix-${competitionId}-po-m${i}`;
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);

    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 9,
      roundName: 'Knockout Play-offs',
      homeClubId: unseededClubId,
      awayClubId: seededClubId,
      scheduledAt: now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    totalGenerated++;
  }

  // 2. Generate Round of 16 Matches (Matchday 10)
  for (let i = 0; i < 8; i++) {
    const directClubId = directQualifiers[i];
    const fixtureId = `fix-${competitionId}-r16-m${i}`;
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);

    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 10,
      roundName: 'Round of 16',
      homeClubId: directClubId,
      awayClubId: 'TBD',
      scheduledAt: now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    totalGenerated++;
  }

  // 3. Generate Quarter-Finals (Matchday 11)
  for (let i = 0; i < 4; i++) {
    const fixtureId = `fix-${competitionId}-qf-m${i}`;
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);

    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 11,
      roundName: 'Quarter-Finals',
      homeClubId: 'TBD',
      awayClubId: 'TBD',
      scheduledAt: now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    totalGenerated++;
  }

  // 4. Generate Semi-Finals (Matchday 12)
  for (let i = 0; i < 2; i++) {
    const fixtureId = `fix-${competitionId}-sf-m${i}`;
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);

    batch.set(fixRef, {
      id: fixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 12,
      roundName: 'Semi-Finals',
      homeClubId: 'TBD',
      awayClubId: 'TBD',
      scheduledAt: now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    totalGenerated++;
  }

  // 5. Generate Final (Matchday 13)
  const finalFixtureId = `fix-${competitionId}-final-m0`;
  const finalRef = db.collection(COLLECTIONS.FIXTURES).doc(finalFixtureId);
  batch.set(finalRef, {
    id: finalFixtureId,
    seasonId: comp.seasonId,
    competitionId,
    competitionName: comp.name,
    matchday: 13,
    roundName: 'Final',
    homeClubId: 'TBD',
    awayClubId: 'TBD',
    scheduledAt: now,
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    winnerClubId: null,
    resultConfirmedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  totalGenerated++;

  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  batch.update(compRef, {
    status: 'active',
    hasFixtures: true,
    fixtureCount: totalGenerated,
    fixturesCount: totalGenerated,
    generationStatus: 'generated',
    updatedAt: now,
  });

  await batch.commit();
  return { generated: totalGenerated, playoffFixtures: 8, r16Fixtures: 8 };
}

export const generateUCLKnockoutBracketFirestore = generateUCLKnockoutBracket;

/**
 * Automatically advances winner of a confirmed knockout fixture to the next bracket round in Firestore.
 */
export async function advanceKnockoutWinner(fixtureId: string): Promise<{ advanced: boolean; targetFixtureId?: string; winnerClubId?: string }> {
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();

  if (!fixDoc.exists) return { advanced: false };
  const fixture = fixDoc.data() as FirestoreFixtureDoc;

  if (fixture.status !== 'CONFIRMED' || !fixture.winnerClubId) {
    return { advanced: false };
  }

  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(fixture.competitionId).get();
  if (!compDoc.exists) return { advanced: false };
  const comp = compDoc.data() as FirestoreCompetitionDoc;

  if (comp.type !== 'KNOCKOUT' && comp.type !== 'SUPER_CUP' && comp.type !== 'EUROPEAN_KNOCKOUT') {
    return { advanced: false };
  }

  // Parse round and match index from fixture ID (e.g. fix-{comp}-r{round}-m{matchIndex})
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
  const nextFixRef = db.collection(COLLECTIONS.FIXTURES).doc(nextFixtureId);
  const nextFixDoc = await nextFixRef.get();

  if (!nextFixDoc.exists) {
    // This was the Final! Crown tournament champion!
    const championClubDoc = await db.collection(COLLECTIONS.CLUBS).doc(fixture.winnerClubId).get();
    const championClub = championClubDoc.exists ? (championClubDoc.data() as FirestoreClubDoc) : null;

    if (championClub) {
      await createAuditLog(
        'system',
        'TOURNAMENT_CHAMPION_CROWNED',
        'competitions',
        comp.id,
        null,
        { championClubId: championClub.id, championName: championClub.name }
      );

      // Notify champion club owner
      const occDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${comp.seasonId}_${championClub.id}`).get();
      if (occDoc.exists && occDoc.data()?.userId) {
        await createNotification(
          occDoc.data()!.userId,
          'TOURNAMENT_CHAMPION',
          `🏆 Champion of ${comp.name}!`,
          `Congratulations! ${championClub.name} has won the ${comp.name} title!`
        );
      }
    }
    return { advanced: true, winnerClubId: fixture.winnerClubId };
  }

  const now = new Date().toISOString();
  const updateData: Partial<FirestoreFixtureDoc> = {
    updatedAt: now,
  };
  if (isHomeSlot) {
    updateData.homeClubId = fixture.winnerClubId;
  } else {
    updateData.awayClubId = fixture.winnerClubId;
  }

  await nextFixRef.update(updateData);

  // Check if both teams in next fixture are ready
  const updatedNextDoc = await nextFixRef.get();
  const updatedNext = updatedNextDoc.data() as FirestoreFixtureDoc;

  if (updatedNext.homeClubId && updatedNext.homeClubId !== 'TBD' && updatedNext.awayClubId && updatedNext.awayClubId !== 'TBD') {
    const homeOccDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${comp.seasonId}_${updatedNext.homeClubId}`).get();
    const awayOccDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${comp.seasonId}_${updatedNext.awayClubId}`).get();

    const notifMsg = `Your next match in ${comp.name} (${updatedNext.roundName}) is scheduled!`;
    if (homeOccDoc.exists && homeOccDoc.data()?.userId) {
      await createNotification(homeOccDoc.data()!.userId, 'NEXT_ROUND_MATCH', `Next Round in ${comp.name}`, notifMsg);
    }
    if (awayOccDoc.exists && awayOccDoc.data()?.userId) {
      await createNotification(awayOccDoc.data()!.userId, 'NEXT_ROUND_MATCH', `Next Round in ${comp.name}`, notifMsg);
    }
  }

  await createAuditLog(
    'system',
    'KNOCKOUT_ADVANCE',
    'fixtures',
    nextFixtureId,
    { previousFixtureId: fixture.id },
    { round: nextRound, slot: isHomeSlot ? 'HOME' : 'AWAY', advancedClubId: fixture.winnerClubId }
  );

  return { advanced: true, targetFixtureId: nextFixtureId, winnerClubId: fixture.winnerClubId };
}

export const advanceKnockoutWinnerFirestore = advanceKnockoutWinner;
