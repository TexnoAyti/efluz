import { TOP5_CLUBS, TOP5_LEAGUES } from '../constants/top5Clubs';
import type { Club, Competition, Fixture, Season, StandingsRow, User } from '../types';

// Public brand assets/catalogue only. Every identity, result and ownership is synthetic.
const stamp = '2026-10-01T12:00:00Z';
export const previewUser: User = { id: 'design-preview', telegramId: '', username: 'demo_designer', firstName: 'Namuna o‘yinchi', isAdmin: false, isSuspended: false, createdAt: stamp, updatedAt: stamp };
export const previewSeasons: Season[] = [
  { id: 'season-2026-27', name: '2026/27', status: 'active', startDate: '2026-08-01', createdAt: stamp },
  { id: 'season-2025-26', name: '2025/26', status: 'completed', startDate: '2025-08-01', endDate: '2026-06-01', createdAt: stamp },
];
export const previewClubs: Club[] = TOP5_CLUBS.map((club, index) => ({ ...club, active: true, createdAt: stamp, leagueName: TOP5_LEAGUES.find(l => l.id === club.leagueId)?.name, isTaken: true, managerUserId: index === 0 ? previewUser.id : `demo-player-${index}`, managerUsername: `demo_player_${index}`, owner: { userId: index === 0 ? previewUser.id : `demo-player-${index}`, username: `demo_player_${index}`, firstName: `Namuna ${index + 1}`, claimedAt: stamp } }));
export function previewCompetitions(seasonId: string): Competition[] {
  const common = { seasonId, status: seasonId === 'season-2025-26' ? 'completed' as const : 'active' as const, scheduleMode: 'GENERATED_SCHEDULE' as const, createdAt: stamp, currentMatchday: 5, isMatchdayOpen: true, hasFixtures: true, formatConfig: { pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0, rounds: 1 } };
  return [
    ...TOP5_LEAGUES.map(l => ({ ...common, id: `${seasonId}-${l.id}`, leagueId: l.id, name: l.name, type: 'LEAGUE' as const, totalTeams: previewClubs.filter(c => c.leagueId === l.id).length, totalMatchdays: previewClubs.filter(c => c.leagueId === l.id).length - 1 })),
    ...TOP5_LEAGUES.map(l => ({ ...common, id: `${seasonId}-${l.id}-cup`, leagueId: l.id, name: `${l.country} Cup`, type: 'KNOCKOUT' as const, currentMatchday: 1, totalTeams: 16, totalMatchdays: 4 })),
    { ...common, id: `${seasonId}-ucl`, name: 'UEFA Champions League', type: 'EUROPEAN_LEAGUE_PHASE', totalTeams: 36, totalMatchdays: 8 },
  ];
}
export function previewFixtures(competition: Competition): Fixture[] {
  const clubs = previewClubs.filter(c => !competition.leagueId || c.leagueId === competition.leagueId).slice(0, competition.totalTeams);
  if (competition.type === 'KNOCKOUT') {
    const fixtures: Fixture[] = [];
    let teams = clubs.slice(0, 16), sources: string[] = [];
    for (let round = 1; teams.length > 1; round++) {
      const winners: Club[] = [], nextSources: string[] = [];
      for (let i = 0; i < teams.length; i += 2) {
        const homeClub = teams[i], awayClub = teams[i + 1];
        const id = `demo-${competition.id}-${round}-${i}`;
        const completed = teams.length > 2 || competition.status === 'completed';
        fixtures.push({ id, seasonId: competition.seasonId, competitionId: competition.id, competitionName: competition.name, matchday: round, roundName: teams.length === 16 ? 'Round of 16' : teams.length === 8 ? 'Quarter-final' : teams.length === 4 ? 'Semi-final' : 'Final', homeClubId: homeClub.id, awayClubId: awayClub.id, homeClub, awayClub, homeSourceFixtureId: sources[i], awaySourceFixtureId: sources[i + 1], winnerClubId: completed ? homeClub.id : null, scheduledAt: '2026-10-28T15:00:00Z', status: completed ? 'CONFIRMED' : 'SCHEDULED', homeScore: completed ? 2 : null, awayScore: completed ? 1 : null, isPlayable: false, createdAt: stamp, updatedAt: stamp });
        winners.push(homeClub); nextSources.push(id);
      }
      teams = winners; sources = nextSources;
    }
    return fixtures;
  }
  const ring = [...clubs];
  const fixtures: Fixture[] = [];
  // Circle schedule: no duplicate opponents, all table statistics derived below.
  for (let round = 1; round <= Math.min(clubs.length - 1, competition.totalMatchdays || clubs.length - 1); round++) {
    for (let i = 0; i < Math.floor(ring.length / 2); i++) {
      const homeClub = ring[i], awayClub = ring[ring.length - 1 - i];
      const completed = competition.status === 'completed' || round < 5;
      fixtures.push({ id: `demo-${competition.id}-${round}-${i}`, seasonId: competition.seasonId, competitionId: competition.id, competitionName: competition.name, matchday: round, homeClubId: homeClub.id, awayClubId: awayClub.id, homeClub, awayClub, scheduledAt: new Date(Date.UTC(competition.seasonId === 'season-2025-26' ? 2025 : 2026, 9, 18 + round, 15)).toISOString(), status: completed ? 'CONFIRMED' : 'SCHEDULED', homeScore: completed ? (round + i) % 4 : null, awayScore: completed ? i % 3 : null, isPlayable: false, createdAt: stamp, updatedAt: stamp });
    }
    ring.splice(1, 0, ring.pop()!);
  }
  return fixtures;
}
export function previewStandings(competition: Competition): StandingsRow[] {
  const clubs = previewClubs.filter(c => !competition.leagueId || c.leagueId === competition.leagueId).slice(0, competition.totalTeams);
  const matches = previewFixtures(competition).filter(f => f.status === 'CONFIRMED');
  return clubs.map(club => {
    const own = matches.filter(f => f.homeClubId === club.id || f.awayClubId === club.id);
    let goalsFor = 0, goalsAgainst = 0;
    const form = own.map(f => { const home = f.homeClubId === club.id; const gf = (home ? f.homeScore : f.awayScore)!; const ga = (home ? f.awayScore : f.homeScore)!; goalsFor += gf; goalsAgainst += ga; return gf > ga ? 'W' as const : gf === ga ? 'D' as const : 'L' as const; });
    const won = form.filter(v => v === 'W').length, drawn = form.filter(v => v === 'D').length;
    return { position: 0, clubId: club.id, clubName: club.name, shortName: club.shortName, logoUrl: club.logoUrl, clubLogoUrl: club.logoUrl, managerUsername: club.managerUsername, played: own.length, won, drawn, lost: own.length - won - drawn, goalsFor, goalsAgainst, goalDifference: goalsFor - goalsAgainst, points: won * 3 + drawn, form };
  }).sort((a,b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor).map((row,i) => ({ ...row, position: i + 1 }));
}

export function previewAccountStats(seasonId = previewSeasons[0].id) {
  const row = previewStandings(previewCompetitions(seasonId)[0]).find(row => row.clubId === previewClubs[0].id)!;
  return { matchesPlayed: row.played, wins: row.won, draws: row.drawn, losses: row.lost, goalsScored: row.goalsFor, goalsConceded: row.goalsAgainst, points: row.points, trophies: 0, leaguePosition: row.position };
}
export const previewStats = previewAccountStats();
