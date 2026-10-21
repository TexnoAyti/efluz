import { TOP5_CLUBS, TOP5_LEAGUES } from '../constants/top5Clubs';
import type { Club, Competition, Fixture, Season, User } from '../types';
const stamp = '2026-10-01T12:00:00Z';
export const previewUser: User = { id: 'design-preview', telegramId: '', username: 'demo_player', firstName: 'Demo', isAdmin: false, isSuspended: false, createdAt: stamp, updatedAt: stamp };
export const previewSeasons: Season[] = [ { id: 'season-2026-27', name: '2026/27', status: 'active', startDate: stamp, createdAt: stamp }, { id: 'season-2025-26', name: '2025/26 · Demo', status: 'completed', startDate: '2025-08-01', createdAt: stamp } ];
export const previewLeagues = TOP5_LEAGUES.map(l => ({ ...l, createdAt: stamp }));
export const previewClubs: Club[] = TOP5_CLUBS.map((c, i) => ({ ...c, active: true, createdAt: stamp, isTaken: true, claimedByUserId: i === 0 ? previewUser.id : `demo-player-${i}`, claimedByUsername: `demo_player_${i}`, owner: { userId: i === 0 ? previewUser.id : `demo-player-${i}`, username: `demo_player_${i}`, firstName: `Demo ${i}`, claimedAt: stamp } }));
export function previewData(seasonId = previewSeasons[0].id) {
  const competitions: Competition[] = previewLeagues.flatMap(l => [
    { id: `demo-${l.id}`, seasonId, leagueId: l.id, name: l.name, type: 'LEAGUE' as const, scheduleMode: 'GENERATED_SCHEDULE' as const, status: 'active' as const, currentMatchday: 4, totalMatchdays: 19, isMatchdayOpen: true, hasFixtures: true, fixtureCount: 40, formatConfig: { rounds: 1 }, createdAt: stamp },
    { id: `demo-cup-${l.id}`, seasonId, leagueId: l.id, name: `${l.country} Cup`, type: 'KNOCKOUT' as const, scheduleMode: 'GENERATED_SCHEDULE' as const, status: 'active' as const, currentMatchday: 1, hasFixtures: true, formatConfig: { singleLeg: true }, createdAt: stamp },
  ]);
  competitions.push({ id: 'demo-ucl', seasonId, name: 'UEFA Champions League', type: 'EUROPEAN_LEAGUE_PHASE', scheduleMode: 'GENERATED_SCHEDULE', status: 'active', currentMatchday: 4, totalTeams: 32, hasFixtures: true, formatConfig: { leaguePhaseTeams: 32 }, createdAt: stamp });
  const fixtures: Fixture[] = competitions.flatMap(c => {
    const clubs = previewClubs.filter(club => c.leagueId ? club.leagueId === c.leagueId : true).slice(0, c.leagueId ? 100 : 32);
    return Array.from({ length: c.type === 'LEAGUE' ? 4 : 1 }, (_, r) => clubs.slice(0, Math.floor(clubs.length / 2)).map((home, i) => {
      const away = clubs[clubs.length - 1 - i];
      return { id: `${c.id}-${r}-${i}`, seasonId, competitionId: c.id, competitionName: c.name, matchday: r + 1, roundName: c.type === 'LEAGUE' ? undefined : 'Round of 16', homeClubId: home.id, awayClubId: away.id, homeClub: home, awayClub: away, scheduledAt: `2026-10-${String(17+r).padStart(2,'0')}T15:00:00Z`, status: r < 3 ? 'CONFIRMED' as const : 'SCHEDULED' as const, homeScore: r < 3 ? (i+r)%4 : null, awayScore: r < 3 ? i%3 : null, createdAt: stamp, updatedAt: stamp };
    })).flat();
  });
  function standings(id: string) {
    const comp = competitions.find(c => c.id === id);
    return previewClubs.filter(c => comp?.leagueId ? c.leagueId === comp.leagueId : true).map(club => {
      const games = fixtures.filter(f => f.competitionId === id && f.status === 'CONFIRMED' && [f.homeClubId,f.awayClubId].includes(club.id));
      let won=0, drawn=0, goalsFor=0, goalsAgainst=0;
      const form = games.map(f => { const home=f.homeClubId===club.id; const a=(home?f.homeScore:f.awayScore)!; const b=(home?f.awayScore:f.homeScore)!; goalsFor+=a; goalsAgainst+=b; if(a>b){won++;return 'W' as const;} if(a===b){drawn++;return 'D' as const;} return 'L' as const; });
      return { position: 0, clubId: club.id, clubName: club.name, shortName: club.shortName, logoUrl: club.logoUrl, clubLogoUrl: club.logoUrl, played: games.length, won, drawn, lost: games.length-won-drawn, goalsFor, goalsAgainst, goalDifference: goalsFor-goalsAgainst, points: won*3+drawn, form };
    }).sort((a,b)=>b.points-a.points || b.goalDifference-a.goalDifference || a.clubName.localeCompare(b.clubName)).map((r,i)=>({...r,position:i+1}));
  }
  return { competitions, fixtures, standings };
}
