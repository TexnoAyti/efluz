/**
 * Custom Tournament Scheduling, Standings & Playoff Engine
 *
 * Implements:
 * 1. Berger Circle Method Round-Robin (1 or 2 rounds, odd-team BYE)
 * 2. Playoff Bracket Generator (4-32 teams, arbitrary N with BYE to nearest 2^k)
 * 3. Group Stage + Playoff compound format
 * 4. Two-legged aggregate scoring with separate penalty shootout tie-breaker
 * 5. Standings calculation with strict EFL UZ tie-breaking rules:
 *    Points -> Goal Difference -> Goals For -> Head-to-Head
 */

import {
  CustomTournamentFormat,
  CustomTournamentFixture,
  CustomTournamentParticipant,
  CustomTournamentRulesConfig,
  CustomTournamentStandingsRow,
  TournamentFormatPreview,
} from '../../types/customTournament';

/**
 * Generates an instant preview of tournament structure without mutating database.
 */
export function generateTournamentPreview(
  format: CustomTournamentFormat,
  participantsCount: number,
  rules: Partial<CustomTournamentRulesConfig> = {}
): TournamentFormatPreview {
  const n = Math.max(4, Math.min(32, participantsCount));
  const roundsCount = rules.roundsCount || 1;
  const playoffLegMode = rules.playoffLegMode || 'SINGLE_LEG';
  const legMultiplier = playoffLegMode === 'TWO_LEG' ? 2 : 1;

  if (format === 'LEAGUE') {
    const isOdd = n % 2 !== 0;
    const effectiveTeams = isOdd ? n + 1 : n;
    const roundsPerDavra = effectiveTeams - 1;
    const matchesPerRound = effectiveTeams / 2;
    const totalRounds = roundsPerDavra * roundsCount;
    const totalMatches = (n * (n - 1) / 2) * roundsCount;

    return {
      format: 'LEAGUE',
      participantsCount: n,
      totalMatches,
      totalStagesOrRounds: totalRounds,
      stagesDescription: `${roundsCount} davrali liga: ${totalRounds} ta tur, har bir qatnashchi ${totalRounds} ta uchrashuv o'tkazadi`,
      byeCount: isOdd ? 1 : 0,
    };
  }

  if (format === 'PLAYOFF') {
    // Nearest power of 2
    let powerOfTwo = 4;
    while (powerOfTwo < n) {
      powerOfTwo *= 2;
    }
    const byeCount = powerOfTwo - n;
    const totalRounds = Math.log2(powerOfTwo);
    const totalPlayoffMatches = (powerOfTwo - 1 - byeCount) * legMultiplier;

    let stageName = 'Chorak final (QF)';
    if (powerOfTwo === 4) stageName = 'Yarim final (SF)';
    if (powerOfTwo === 16) stageName = '1/8 final (R16)';
    if (powerOfTwo === 32) stageName = '1/16 final (R32)';

    return {
      format: 'PLAYOFF',
      participantsCount: n,
      totalMatches: totalPlayoffMatches,
      totalStagesOrRounds: totalRounds,
      stagesDescription: `${totalRounds} ta bosqich (${stageName}dan Finalgacha). ${byeCount > 0 ? `${byeCount} ta qatnashchi 1-bosqichda BYE oladi.` : 'Barcha juftliklar to‘liq.'}`,
      byeCount,
    };
  }

  // LEAGUE_AND_PLAYOFF
  const qualifiers = rules.playoffQualifiersCount || (n >= 16 ? 8 : 4);
  const groupMode = rules.groupStageMode || 'SINGLE_TABLE';
  const groupsCount = rules.groupsCount || 2;

  let groupStageMatches = 0;
  let breakdown: any[] | undefined;

  if (groupMode === 'GROUPS') {
    const perGroup = Math.floor(n / groupsCount);
    groupStageMatches = groupsCount * ((perGroup * (perGroup - 1)) / 2) * roundsCount;
    breakdown = Array.from({ length: groupsCount }, (_, i) => ({
      groupName: `${String.fromCharCode(65 + i)}-guruhi`,
      teamsCount: perGroup + (i === 0 ? n % groupsCount : 0),
      qualifiersCount: Math.floor(qualifiers / groupsCount),
    }));
  } else {
    groupStageMatches = ((n * (n - 1)) / 2) * roundsCount;
  }

  const playoffMatches = (qualifiers - 1) * legMultiplier;

  return {
    format: 'LEAGUE_AND_PLAYOFF',
    participantsCount: n,
    totalMatches: groupStageMatches + playoffMatches,
    totalStagesOrRounds: Math.log2(qualifiers) + 1,
    stagesDescription: `${groupMode === 'GROUPS' ? `${groupsCount} ta guruh bosqichi` : 'Yagona liga jadvali'} + ${qualifiers} talik Pley-off bosqichi`,
    groupBreakdown: breakdown,
  };
}

/**
 * Berger Circle Method Round-Robin Fixtures Generator
 */
export function generateRoundRobinFixtures(
  tournamentId: string,
  participants: CustomTournamentParticipant[],
  roundsCount: 1 | 2 = 1,
  matchDurationHours = 36,
  groupIndex?: number
): CustomTournamentFixture[] {
  const teams = [...participants];
  const fixtures: CustomTournamentFixture[] = [];
  const now = Date.now();

  // If odd number, add dummy BYE team
  let hasBye = false;
  if (teams.length % 2 !== 0) {
    teams.push({
      id: '__BYE__',
      tournamentId,
      userId: '__BYE__',
      telegramId: '',
      clubId: 'BYE',
      clubName: 'BYE',
      clubShortName: 'BYE',
      clubLogoUrl: '',
      status: 'REGISTERED',
      joinedAt: '',
    });
    hasBye = true;
  }

  const n = teams.length;
  const numRounds = n - 1;
  const matchesPerRound = n / 2;
  const rotatingTeams = teams.slice(1);

  let matchCounter = 0;

  for (let davra = 1; davra <= roundsCount; davra++) {
    for (let round = 0; round < numRounds; round++) {
      const matchday = (davra - 1) * numRounds + (round + 1);
      const roundTeams = [teams[0], ...rotatingTeams];
      const deadline = new Date(now + matchday * matchDurationHours * 3600 * 1000).toISOString();

      for (let match = 0; match < matchesPerRound; match++) {
        const teamA = roundTeams[match];
        const teamB = roundTeams[n - 1 - match];

        if (teamA.clubId === 'BYE' || teamB.clubId === 'BYE') {
          continue; // Skip dummy BYE match
        }

        // Home and away alternation
        let home = teamA;
        let away = teamB;
        if (davra === 1) {
          if (match === 0 && round % 2 === 1) {
            home = teamB;
            away = teamA;
          }
        } else {
          // Second leg swaps home and away
          home = teamB;
          away = teamA;
          if (match === 0 && round % 2 === 1) {
            home = teamA;
            away = teamB;
          }
        }

        matchCounter++;
        fixtures.push({
          id: `ctf_${tournamentId}_r${matchday}_m${matchCounter}`,
          tournamentId,
          stage: groupIndex !== undefined ? 'GROUP_STAGE' : 'LEAGUE',
          groupIndex,
          roundOrMatchday: matchday,
          matchIndex: matchCounter,
          leg: davra === 1 ? 1 : 2,
          homeClubId: home.clubId,
          awayClubId: away.clubId,
          homeClubName: home.clubName,
          awayClubName: away.clubName,
          homeClubLogoUrl: home.clubLogoUrl,
          awayClubLogoUrl: away.clubLogoUrl,
          homeUserId: home.userId,
          awayUserId: away.userId,
          status: 'SCHEDULED',
          deadlineAt: deadline,
        });
      }

      // Rotate teams (Circle Method)
      const last = rotatingTeams.pop()!;
      rotatingTeams.unshift(last);
    }
  }

  return fixtures;
}

/**
 * Knockout Bracket Fixtures Generator with arbitrary N teams and BYE handling
 */
export function generatePlayoffBracketFixtures(
  tournamentId: string,
  participants: CustomTournamentParticipant[],
  playoffLegMode: 'SINGLE_LEG' | 'TWO_LEG' = 'SINGLE_LEG',
  matchDurationHours = 36
): CustomTournamentFixture[] {
  const n = participants.length;
  let powerOfTwo = 4;
  while (powerOfTwo < n) {
    powerOfTwo *= 2;
  }

  const byeCount = powerOfTwo - n;
  const fixtures: CustomTournamentFixture[] = [];
  const now = Date.now();

  // Create bracket node array of size powerOfTwo / 2 for Round 1
  const roundsTotal = Math.log2(powerOfTwo);

  // Stage names map
  const getStageName = (matchesInRound: number): CustomTournamentFixture['stage'] => {
    if (matchesInRound === 1) return 'PLAYOFF_FINAL';
    if (matchesInRound === 2) return 'PLAYOFF_SF';
    if (matchesInRound === 4) return 'PLAYOFF_QF';
    if (matchesInRound === 8) return 'PLAYOFF_R16';
    return 'PLAYOFF_R32';
  };

  // Build binary bracket tree from Final down to Round 1
  let currentMatchesCount = 1;
  const matchesByRound: Array<Array<{ fixtureId1: string; fixtureId2?: string }>> = [];

  for (let r = roundsTotal; r >= 1; r--) {
    const roundList: Array<{ fixtureId1: string; fixtureId2?: string }> = [];
    const stage = getStageName(currentMatchesCount);
    const deadline = new Date(now + r * matchDurationHours * 3600 * 1000).toISOString();

    for (let m = 0; m < currentMatchesCount; m++) {
      const fixIdLeg1 = `ctf_${tournamentId}_s${stage}_m${m}_l1`;
      let fixIdLeg2: string | undefined;

      if (playoffLegMode === 'TWO_LEG' && stage !== 'PLAYOFF_FINAL') {
        fixIdLeg2 = `ctf_${tournamentId}_s${stage}_m${m}_l2`;
      }

      roundList.push({ fixtureId1: fixIdLeg1, fixtureId2: fixIdLeg2 });
    }
    matchesByRound.unshift(roundList);
    currentMatchesCount *= 2;
  }

  // Prepare Round 1 seedings with BYEs
  const seededTeams: Array<CustomTournamentParticipant | 'BYE'> = [...participants];
  for (let b = 0; b < byeCount; b++) {
    seededTeams.push('BYE');
  }

  // Standard tournament seeding interleave: 1 vs 16, 2 vs 15...
  const pairs: Array<[CustomTournamentParticipant | 'BYE', CustomTournamentParticipant | 'BYE']> = [];
  for (let i = 0; i < powerOfTwo / 2; i++) {
    pairs.push([seededTeams[i], seededTeams[powerOfTwo - 1 - i]]);
  }

  let matchIndex = 0;

  // Populate Round 1 fixtures and link next matches
  for (let r = 0; r < roundsTotal; r++) {
    const roundPairs = matchesByRound[r];
    const isRound1 = r === 0;
    const stage = getStageName(roundPairs.length);
    const deadline = new Date(now + (r + 1) * matchDurationHours * 3600 * 1000).toISOString();

    for (let m = 0; m < roundPairs.length; m++) {
      matchIndex++;
      const nextRoundIndex = Math.floor(m / 2);
      const nextFixtureId = r < roundsTotal - 1 ? matchesByRound[r + 1][nextRoundIndex].fixtureId1 : null;

      let home = isRound1 ? pairs[m][0] : undefined;
      let away = isRound1 ? pairs[m][1] : undefined;

      const isByeMatch = isRound1 && (home === 'BYE' || away === 'BYE');
      let status: CustomTournamentFixture['status'] = 'SCHEDULED';
      let winnerClubId: string | null = null;

      if (isByeMatch) {
        status = 'BYE_AUTO_ADVANCED';
        const advTeam = home !== 'BYE' ? (home as CustomTournamentParticipant) : (away as CustomTournamentParticipant);
        winnerClubId = advTeam?.clubId || null;
      }

      const homeClubId = home === 'BYE' ? 'BYE' : home?.clubId || 'TBD';
      const awayClubId = away === 'BYE' ? 'BYE' : away?.clubId || 'TBD';
      const homeClubName = home === 'BYE' ? 'BYE' : home?.clubName || 'Kutilmoqda';
      const awayClubName = away === 'BYE' ? 'BYE' : away?.clubName || 'Kutilmoqda';

      fixtures.push({
        id: roundPairs[m].fixtureId1,
        tournamentId,
        stage,
        roundOrMatchday: r + 1,
        matchIndex,
        leg: 1,
        homeClubId,
        awayClubId,
        homeClubName,
        awayClubName,
        homeClubLogoUrl: home && home !== 'BYE' ? home.clubLogoUrl : undefined,
        awayClubLogoUrl: away && away !== 'BYE' ? away.clubLogoUrl : undefined,
        homeUserId: home && home !== 'BYE' ? home.userId : undefined,
        awayUserId: away && away !== 'BYE' ? away.userId : undefined,
        status,
        winnerClubId,
        deadlineAt: deadline,
        nextMatchFixtureId: nextFixtureId,
      });

      // Leg 2 if two-legged
      if (roundPairs[m].fixtureId2) {
        matchIndex++;
        fixtures.push({
          id: roundPairs[m].fixtureId2!,
          tournamentId,
          stage,
          roundOrMatchday: r + 1,
          matchIndex,
          leg: 2,
          homeClubId: awayClubId,
          awayClubId: homeClubId,
          homeClubName: awayClubName,
          awayClubName: homeClubName,
          homeClubLogoUrl: away && away !== 'BYE' ? away.clubLogoUrl : undefined,
          awayClubLogoUrl: home && home !== 'BYE' ? home.clubLogoUrl : undefined,
          homeUserId: away && away !== 'BYE' ? away.userId : undefined,
          awayUserId: home && home !== 'BYE' ? home.userId : undefined,
          status,
          winnerClubId,
          deadlineAt: new Date(new Date(deadline).getTime() + 24 * 3600 * 1000).toISOString(),
          nextMatchFixtureId: nextFixtureId,
        });
      }
    }
  }

  return fixtures;
}

/**
 * Calculates standings from confirmed fixtures enforcing strict tie-breakers:
 * 1. Points
 * 2. Goal Difference
 * 3. Goals For
 * 4. Head-to-Head points & GD
 */
export function calculateCustomStandings(
  participants: CustomTournamentParticipant[],
  fixtures: CustomTournamentFixture[],
  groupIndex?: number
): CustomTournamentStandingsRow[] {
  const filteredParticipants = groupIndex !== undefined
    ? participants.filter((p) => p.groupIndex === groupIndex)
    : participants;

  const rowsMap = new Map<string, CustomTournamentStandingsRow>();

  for (const p of filteredParticipants) {
    rowsMap.set(p.clubId, {
      position: 0,
      clubId: p.clubId,
      clubName: p.clubName,
      clubShortName: p.clubShortName,
      clubLogoUrl: p.clubLogoUrl,
      userId: p.userId,
      groupIndex: p.groupIndex,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    });
  }

  const confirmedMatches = fixtures.filter(
    (f) =>
      f.status === 'CONFIRMED' &&
      (groupIndex !== undefined ? f.groupIndex === groupIndex : true) &&
      f.homeScore !== null &&
      f.homeScore !== undefined &&
      f.awayScore !== null &&
      f.awayScore !== undefined &&
      rowsMap.has(f.homeClubId) &&
      rowsMap.has(f.awayClubId)
  );

  for (const m of confirmedMatches) {
    const home = rowsMap.get(m.homeClubId)!;
    const away = rowsMap.get(m.awayClubId)!;
    const hScore = m.homeScore!;
    const aScore = m.awayScore!;

    home.played += 1;
    away.played += 1;
    home.goalsFor += hScore;
    home.goalsAgainst += aScore;
    away.goalsFor += aScore;
    away.goalsAgainst += hScore;

    if (hScore > aScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (hScore < aScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      home.points += 1;
      away.drawn += 1;
      away.points += 1;
    }

    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
  }

  const list = Array.from(rowsMap.values());

  // Strict sorting: Points -> GD -> GF -> H2H
  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;

    // Head-to-Head calculation
    const h2h = confirmedMatches.filter(
      (m) =>
        (m.homeClubId === a.clubId && m.awayClubId === b.clubId) ||
        (m.homeClubId === b.clubId && m.awayClubId === a.clubId)
    );

    let aH2hPoints = 0;
    let bH2hPoints = 0;
    for (const m of h2h) {
      if (m.homeClubId === a.clubId) {
        if (m.homeScore! > m.awayScore!) aH2hPoints += 3;
        else if (m.homeScore! < m.awayScore!) bH2hPoints += 3;
        else { aH2hPoints += 1; bH2hPoints += 1; }
      } else {
        if (m.homeScore! > m.awayScore!) bH2hPoints += 3;
        else if (m.homeScore! < m.awayScore!) aH2hPoints += 3;
        else { aH2hPoints += 1; bH2hPoints += 1; }
      }
    }

    if (bH2hPoints !== aH2hPoints) return bH2hPoints - aH2hPoints;
    return a.clubName.localeCompare(b.clubName);
  });

  list.forEach((row, idx) => {
    row.position = idx + 1;
  });

  return list;
}

/**
 * Resolves 2-legged aggregate or 1-leg match outcome.
 * In 2-legged ties, separate penalty shootout determines winner.
 */
export function resolvePlayoffWinner(
  leg1: CustomTournamentFixture,
  leg2?: CustomTournamentFixture
): { winnerClubId: string | null; isTiedNeedPenalties: boolean } {
  if (!leg2) {
    // Single leg
    const h = leg1.homeScore ?? 0;
    const a = leg1.awayScore ?? 0;
    if (h > a) return { winnerClubId: leg1.homeClubId, isTiedNeedPenalties: false };
    if (a > h) return { winnerClubId: leg1.awayClubId, isTiedNeedPenalties: false };

    // Tied single leg: check penalties
    if (leg1.penaltyHomeScore !== null && leg1.penaltyHomeScore !== undefined &&
        leg1.penaltyAwayScore !== null && leg1.penaltyAwayScore !== undefined) {
      if (leg1.penaltyHomeScore > leg1.penaltyAwayScore) {
        return { winnerClubId: leg1.homeClubId, isTiedNeedPenalties: false };
      }
      if (leg1.penaltyAwayScore > leg1.penaltyHomeScore) {
        return { winnerClubId: leg1.awayClubId, isTiedNeedPenalties: false };
      }
    }
    return { winnerClubId: null, isTiedNeedPenalties: true };
  }

  // Two legs
  // leg1: TeamA (home) vs TeamB (away)
  // leg2: TeamB (home) vs TeamA (away)
  const teamAScore = (leg1.homeScore ?? 0) + (leg2.awayScore ?? 0);
  const teamBScore = (leg1.awayScore ?? 0) + (leg2.homeScore ?? 0);

  if (teamAScore > teamBScore) {
    return { winnerClubId: leg1.homeClubId, isTiedNeedPenalties: false };
  }
  if (teamBScore > teamAScore) {
    return { winnerClubId: leg1.awayClubId, isTiedNeedPenalties: false };
  }

  // Aggregate tied: NO away goals rule (UEFA modern style per user decision). Check penalties on leg2.
  const penHome = leg2.penaltyHomeScore; // TeamB
  const penAway = leg2.penaltyAwayScore; // TeamA

  if (penHome !== null && penHome !== undefined && penAway !== null && penAway !== undefined) {
    if (penAway > penHome) {
      return { winnerClubId: leg1.homeClubId, isTiedNeedPenalties: false };
    }
    if (penHome > penAway) {
      return { winnerClubId: leg1.awayClubId, isTiedNeedPenalties: false };
    }
  }

  return { winnerClubId: null, isTiedNeedPenalties: true };
}
