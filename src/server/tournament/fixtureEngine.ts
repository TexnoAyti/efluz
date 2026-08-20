export interface RoundMatchup {
  matchday: number;
  homeClubId: string;
  awayClubId: string;
}

/**
 * Deterministic Berger (Circle Method) Round-Robin Fixture Generator
 * Generates balanced home and away schedules for N teams.
 */
export function generateRoundRobinSchedule(
  clubIds: string[],
  options: {
    homeAndAway?: boolean;
    startDate?: Date;
    daysBetweenMatchdays?: number;
  } = {}
): RoundMatchup[] {
  const homeAndAway = options.homeAndAway !== false; // default true
  const list = [...clubIds];

  // If odd, add a dummy BYE club
  let hasBye = false;
  if (list.length % 2 !== 0) {
    list.push('__BYE__');
    hasBye = true;
  }

  const n = list.length;
  const numRounds = n - 1;
  const matchesPerRound = n / 2;

  const firstLegMatchups: RoundMatchup[] = [];

  // Circle method: Fix index 0, rotate the rest (indices 1 to n-1)
  const rotatingTeams = list.slice(1);

  for (let round = 0; round < numRounds; round++) {
    const matchday = round + 1;
    const roundTeams = [list[0], ...rotatingTeams];

    for (let match = 0; match < matchesPerRound; match++) {
      let teamA = roundTeams[match];
      let teamB = roundTeams[n - 1 - match];

      // Skip match with BYE
      if (teamA === '__BYE__' || teamB === '__BYE__') {
        continue;
      }

      // Balance home and away for the fixed team (match === 0)
      let home = teamA;
      let away = teamB;

      if (match === 0) {
        // Alternate home/away for the fixed team across rounds
        if (round % 2 === 1) {
          home = teamB;
          away = teamA;
        }
      } else {
        // Balance home/away based on round + match parity
        if ((round + match) % 2 === 1) {
          home = teamB;
          away = teamA;
        }
      }

      firstLegMatchups.push({
        matchday,
        homeClubId: home,
        awayClubId: away,
      });
    }

    // Rotate rotatingTeams by 1 position clockwise: pop last item, unshift to front
    const last = rotatingTeams.pop()!;
    rotatingTeams.unshift(last);
  }

  if (!homeAndAway) {
    return firstLegMatchups;
  }

  // Second Leg (reverse home and away)
  const secondLegMatchups: RoundMatchup[] = [];
  for (const match of firstLegMatchups) {
    secondLegMatchups.push({
      matchday: match.matchday + numRounds,
      homeClubId: match.awayClubId, // Invert home/away
      awayClubId: match.homeClubId,
    });
  }

  return [...firstLegMatchups, ...secondLegMatchups];
}

/**
 * Deterministic 24-Club UEFA Champions League Phase Schedule Generator
 * Generates exactly 8 matchdays (12 matches per matchday, 96 total matches).
 * Each club plays exactly 8 matches (4 Home, 4 Away) against 8 DIFFERENT opponents.
 */
export function generateUCL24LeaguePhaseSchedule(
  clubIds: string[],
  options: {
    startDate?: string;
    daysBetweenMatchdays?: number;
  } = {}
): RoundMatchup[] {
  if (clubIds.length !== 24) {
    throw new Error(`UCL 24-team league phase requires exactly 24 clubs (received ${clubIds.length}).`);
  }

  const n = 24;
  const numRounds = 8;

  // Standard 1-factorization of K_24 (indices 0..23)
  const roundPairs: Array<Array<[number, number]>> = [];
  for (let r = 0; r < numRounds; r++) {
    const pairs: Array<[number, number]> = [];
    // Fixed team 23 plays team r
    pairs.push([23, r]);
    for (let i = 1; i <= 11; i++) {
      const u = (r + i) % 23;
      const v = (r - i + 23) % 23;
      pairs.push([u, v]);
    }
    roundPairs.push(pairs);
  }

  // Home / Away assignments: greedy balancing so each team gets exactly 4 home and 4 away matches
  const homeCount = new Array(n).fill(0);
  const matchups: RoundMatchup[] = [];

  for (let r = 0; r < numRounds; r++) {
    const pairs = roundPairs[r];
    for (let m = 0; m < pairs.length; m++) {
      const [u, v] = pairs[m];
      let uIsHome: boolean;

      if (homeCount[u] >= 4 && homeCount[v] < 4) {
        uIsHome = false;
      } else if (homeCount[v] >= 4 && homeCount[u] < 4) {
        uIsHome = true;
      } else if (homeCount[u] < homeCount[v]) {
        uIsHome = true;
      } else if (homeCount[v] < homeCount[u]) {
        uIsHome = false;
      } else {
        // Deterministic alternation
        uIsHome = (r + m) % 2 === 0;
      }

      const homeIdx = uIsHome ? u : v;
      const awayIdx = uIsHome ? v : u;

      homeCount[homeIdx]++;

      matchups.push({
        matchday: r + 1,
        homeClubId: clubIds[homeIdx],
        awayClubId: clubIds[awayIdx],
      });
    }
  }

  return matchups;
}

/**
 * Calculates scheduled dates for each matchday starting from a base season date.
 */
export function calculateMatchdayDate(seasonStartDate: string, matchday: number, daysInterval = 7): string {
  const base = new Date(seasonStartDate);
  if (isNaN(base.getTime())) {
    return new Date().toISOString();
  }
  const matchDate = new Date(base.getTime() + (matchday - 1) * daysInterval * 24 * 60 * 60 * 1000);
  // Default to 15:00 UTC
  matchDate.setUTCHours(15, 0, 0, 0);
  return matchDate.toISOString();
}
