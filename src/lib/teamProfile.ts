import type {PreviewTeam,TeamLeague,TeamFixture} from '../types/teamLeaguePreview';
import {teamFixtureScore,teamFixtureWinner,teamStandings,teamPlayerStats} from './teamLeagueEngine';
export interface TeamProfileData {team:PreviewTeam;leagues:TeamLeague[];teams:PreviewTeam[]}
export function teamProfileSummary(data:TeamProfileData){
 const {team}=data,leagues=data.leagues.filter(l=>l.teamIds.includes(team.id));
 const matches=leagues.flatMap(league=>league.fixtures.filter(f=>f.homeTeamId===team.id||f.awayTeamId===team.id).map(fixture=>({league,fixture})));
 const totals={played:0,won:0,drawn:0,lost:0,winsFor:0,winsAgainst:0};
 for(const {fixture:f} of matches){const s=teamFixtureScore(f);if(!teamProfileFixtureComplete(f))continue;totals.played++;const home=f.homeTeamId===team.id,own=home?s.home:s.away,other=home?s.away:s.home;totals.winsFor+=own;totals.winsAgainst+=other;const winner=f.stage==='PLAYOFF'?teamFixtureWinner(f):null;if(winner?winner===team.id:own>other)totals.won++;else if(winner||own<other)totals.lost++;else totals.drawn++;}
 const trophies=leagues.filter(l=>l.status==='COMPLETED'&&l.fixtures.length>0&&(l.format&&l.format!=='LEAGUE'?(l.fixtures.length?teamFixtureWinner(l.fixtures.at(-1)!):null):teamStandings(l)[0]?.teamId)===team.id);
 const next=matches.filter(({league:l,fixture:f})=>l.status==='ACTIVE'&&f.round===l.currentRound&&!teamProfileFixtureComplete(f))[0];
 const players=team.members.map(member=>{const stats=leagues.flatMap(teamPlayerStats).filter(p=>p.teamId===team.id&&p.memberId===member.id);return {...member,played:stats.reduce((n,p)=>n+p.played,0),won:stats.reduce((n,p)=>n+p.won,0),goalsFor:stats.reduce((n,p)=>n+p.goalsFor,0),goalsAgainst:stats.reduce((n,p)=>n+p.goalsAgainst,0)};});
 return {leagues,matches,totals,trophies,next,players};
}
export function teamProfileFixtureComplete(f:TeamFixture){return teamFixtureScore(f).complete&&(f.stage!=='PLAYOFF'||!!teamFixtureWinner(f));}
