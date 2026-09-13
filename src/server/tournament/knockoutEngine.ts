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

  // Handle European 32-team League Phase transitions (Champions League / Europa League)
  if (
    comp.type === 'EUROPEAN_LEAGUE_PHASE' ||
    comp.type === 'EUROPEAN_KNOCKOUT' ||
    competitionId.includes('champions') ||
    competitionId.includes('europa') ||
    competitionId.includes('ucl') ||
    competitionId.includes('uel')
  ) {
    if (clubIds.length >= 24) {
      const standingsSnap = await db
        .collection(COLLECTIONS.STANDINGS)
        .where('competitionId', '==', competitionId)
        .get();
      let ranked = clubIds;
      if (!standingsSnap.empty) {
        const sortedStandings = standingsSnap.docs
          .map((d) => d.data())
          .sort((a: any, b: any) => {
            if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
            return (b.goalDifference || 0) - (a.goalDifference || 0);
          });
        ranked = sortedStandings.map((s: any) => s.clubId);
      }
      const uclRes = await generateUCLKnockoutBracket(competitionId, ranked);
      return { generated: uclRes.generated, rounds: 5 };
    }
  }

  const now = new Date().toISOString();
  let totalGenerated = 0;
  let totalRounds = 0;
  const batch = db.batch();

  // Handle 18-team (Bundesliga / Ligue 1) and 20-team (Premier League / La Liga / Serie A) domestic cups
  if (clubIds.length > 16 && clubIds.length < 32) {
    totalRounds = 5;
    const totalTeams = clubIds.length;
    const prelimMatches = totalTeams - 16; // 4 for 20 teams, 2 for 18 teams
    const prelimTeamsCount = prelimMatches * 2; // 8 for 20 teams, 4 for 18 teams
    const byeTeamsCount = totalTeams - prelimTeamsCount; // 12 for 20 teams, 14 for 18 teams
    const prelimPairs = Math.ceil(prelimMatches / 2); // 2 for 20 teams, 1 for 18 teams

    // Round 1: Preliminary / Play-in Round (4 matches for 20 teams, 2 matches for 18 teams)
    for (let i = 0; i < prelimMatches; i++) {
      const fixtureId = `fix-${competitionId}-r1-m${i}`;
      const homeClubId = clubIds[byeTeamsCount + i * 2] || 'TBD';
      const awayClubId = clubIds[byeTeamsCount + i * 2 + 1] || 'TBD';
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);

      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 1,
        roundName: 'Preliminary Round',
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

    // Round 2: Round of 16 (8 matches)
    for (let i = 0; i < 8; i++) {
      const fixtureId = `fix-${competitionId}-r2-m${i}`;
      let homeClubId = 'TBD';
      let awayClubId = 'TBD';

      if (i >= prelimPairs) {
        const byeIdx = (i - prelimPairs) * 2;
        homeClubId = clubIds[byeIdx] || 'TBD';
        awayClubId = clubIds[byeIdx + 1] || 'TBD';
      }

      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 2,
        roundName: 'Round of 16',
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

    // Round 3: Quarter-Finals (4 matches)
    for (let m = 0; m < 4; m++) {
      const fixtureId = `fix-${competitionId}-r3-m${m}`;
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 3,
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

    // Round 4: Semi-Finals (2 matches)
    for (let m = 0; m < 2; m++) {
      const fixtureId = `fix-${competitionId}-r4-m${m}`;
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      batch.set(fixRef, {
        id: fixtureId,
        seasonId: comp.seasonId,
        competitionId,
        competitionName: comp.name,
        matchday: 4,
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

    // Round 5: Final (1 match)
    const finalFixtureId = `fix-${competitionId}-r5-m0`;
    const finalRef = db.collection(COLLECTIONS.FIXTURES).doc(finalFixtureId);
    batch.set(finalRef, {
      id: finalFixtureId,
      seasonId: comp.seasonId,
      competitionId,
      competitionName: comp.name,
      matchday: 5,
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
  } else {
    // Standard power-of-2 bracket (2, 4, 8, 16, 32)
    let bracketSize = 2;
    while (bracketSize < clubIds.length) {
      bracketSize *= 2;
    }

    totalRounds = Math.log2(bracketSize);
    const getRoundName = (roundNum: number): string => {
      const remainingTeams = Math.pow(2, totalRounds - roundNum + 1);
      if (remainingTeams === 2) return 'Final';
      if (remainingTeams === 4) return 'Semi-Finals';
      if (remainingTeams === 8) return 'Quarter-Finals';
      if (remainingTeams === 16) return 'Round of 16';
      if (remainingTeams === 32) return 'Round of 32';
      return `Round of ${remainingTeams}`;
    };

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
  const compId = comp.id || fixture.competitionId;

  if (
    comp.type !== 'KNOCKOUT' &&
    comp.type !== 'SUPER_CUP' &&
    comp.type !== 'EUROPEAN_KNOCKOUT' &&
    comp.type !== 'EUROPEAN_LEAGUE_PHASE'
  ) {
    return { advanced: false };
  }

  // Parse target next round and match index from fixture ID
  let nextFixtureId = '';
  let isHomeSlot = true;
  let nextRound = 0;

  // 1. Check UCL / European Knockout IDs (Play-offs -> R16 -> QF -> SF -> Final)
  const uclPoMatch = fixture.id.match(/-po-m(\d+)$/);
  const uclR16Match = fixture.id.match(/-r16-m(\d+)$/);
  const uclQfMatch = fixture.id.match(/-qf-m(\d+)$/);
  const uclSfMatch = fixture.id.match(/-sf-m(\d+)$/);
  const uclFinalMatch = fixture.id.match(/-final-m(\d+)$/);

  if (uclPoMatch) {
    const poIndex = parseInt(uclPoMatch[1], 10);
    nextFixtureId = `fix-${compId}-r16-m${poIndex}`;
    isHomeSlot = false; // Away slot, direct top-8 qualifier is Home
    nextRound = 10;
  } else if (uclR16Match) {
    const r16Index = parseInt(uclR16Match[1], 10);
    const qfIndex = Math.floor(r16Index / 2);
    nextFixtureId = `fix-${compId}-qf-m${qfIndex}`;
    isHomeSlot = r16Index % 2 === 0;
    nextRound = 11;
  } else if (uclQfMatch) {
    const qfIndex = parseInt(uclQfMatch[1], 10);
    const sfIndex = Math.floor(qfIndex / 2);
    nextFixtureId = `fix-${compId}-sf-m${sfIndex}`;
    isHomeSlot = qfIndex % 2 === 0;
    nextRound = 12;
  } else if (uclSfMatch) {
    const sfIndex = parseInt(uclSfMatch[1], 10);
    nextFixtureId = `fix-${compId}-final-m0`;
    isHomeSlot = sfIndex === 0;
    nextRound = 13;
  } else if (uclFinalMatch) {
    // This was the European Final!
    nextFixtureId = '';
  } else {
    // Standard round format (e.g. fix-{comp}-r{round}-m{matchIndex})
    const match = fixture.id.match(/-r(\d+)-m(\d+)$/);
    if (!match) {
      return { advanced: false };
    }

    const currentRound = parseInt(match[1], 10);
    const currentMatchIndex = parseInt(match[2], 10);
    nextRound = currentRound + 1;
    const nextMatchIndex = Math.floor(currentMatchIndex / 2);
    isHomeSlot = currentMatchIndex % 2 === 0;

    nextFixtureId = `fix-${compId}-r${nextRound}-m${nextMatchIndex}`;
  }

  const nextFixRef = nextFixtureId ? db.collection(COLLECTIONS.FIXTURES).doc(nextFixtureId) : null;
  const nextFixDoc = nextFixRef ? await nextFixRef.get() : null;

  if (!nextFixDoc || !nextFixDoc.exists) {
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

  // Check if current round is complete and update competition currentMatchday
  try {
    const curMd = fixture.matchday || 1;
    const roundSnap = await db
      .collection(COLLECTIONS.FIXTURES)
      .where('competitionId', '==', comp.id)
      .where('matchday', '==', curMd)
      .get();
    const allRoundConfirmed = !roundSnap.empty && roundSnap.docs.every((d) => (d.data() as FirestoreFixtureDoc)?.status === 'CONFIRMED');
    if (allRoundConfirmed) {
      const nextMatchday = curMd + 1;
      await db.collection(COLLECTIONS.COMPETITIONS).doc(comp.id).update({
        currentMatchday: nextMatchday,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (roundErr) {
    console.warn('[KNOCKOUT_ADVANCE] Could not check round completion:', roundErr);
  }

  return { advanced: true, targetFixtureId: nextFixtureId, winnerClubId: fixture.winnerClubId };
}

export const advanceKnockoutWinnerFirestore = advanceKnockoutWinner;
