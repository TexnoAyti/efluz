import type {PreviewTeam,TeamLeague,TeamFixture} from '../types/teamLeaguePreview';
import {teamFixtureScore,teamFixtureWinner,teamStandings} from './teamLeagueEngine';
export interface TeamProfileData {canManageTeam?:boolean;team:PreviewTeam;leagues:TeamLeague[];teams:Array<Pick<PreviewTeam,'id'|'name'|'logo'>>}
export function teamProfileFixtureComplete(f:TeamFixture,starterCount?:number){return (starterCount===undefined||f.bouts.length===starterCount)&&teamFixtureScore(f).complete&&(f.stage!=='PLAYOFF'||!!teamFixtureWinner(f));}
export function teamProfileChampion(l:TeamLeague){
 if(l.status!=='COMPLETED'||!l.fixtures.length||!l.fixtures.every(f=>teamProfileFixtureComplete(f,l.starterCount)))return null;
 if(!l.format||l.format==='LEAGUE')return teamStandings(l)[0]?.teamId||null;
 const finals=l.fixtures.filter(f=>(f.stage==='PLAYOFF'||l.format==='PLAYOFF')&&f.round===l.totalRounds);
 return finals.length===1?teamFixtureWinner(finals[0]):null;
}
export function teamMatchOutcome(f:TeamFixture,teamId:string){
 const winner=f.stage==='PLAYOFF'?teamFixtureWinner(f):null;
 if(winner)return winner===teamId?'W':'L';
 const score=teamFixtureScore(f),own=f.homeTeamId===teamId?score.home:score.away,other=f.homeTeamId===teamId?score.away:score.home;
 return own>other?'W':own<other?'L':'D';
}
export function teamProfileMatches(data:TeamProfileData,filter='ALL',view:'all'|'upcoming'|'results'='all'){
 const matches=data.leagues.filter(l=>l.teamIds.includes(data.team.id)&&(filter==='ALL'||l.id===filter)).flatMap(league=>league.fixtures.filter(f=>f.homeTeamId===data.team.id||f.awayTeamId===data.team.id).slice().sort((a,b)=>a.round-b.round).map(fixture=>({league,fixture})));
 const filtered=matches.filter(({league:l,fixture:f})=>view==='all'||(view==='results'?teamProfileFixtureComplete(f,l.starterCount):l.status==='ACTIVE'&&!teamProfileFixtureComplete(f,l.starterCount)));
 return view==='results'?filtered.slice().reverse():filtered;
}
export function teamProfileSummary(data:TeamProfileData){
 const {team}=data,leagues=data.leagues.filter(l=>l.teamIds.includes(team.id));
 const matches=teamProfileMatches(data),totals={played:0,won:0,drawn:0,lost:0,winsFor:0,winsAgainst:0};
 for(const {league:l,fixture:f} of matches){if(!teamProfileFixtureComplete(f,l.starterCount))continue;const s=teamFixtureScore(f);totals.played++;totals.winsFor+=f.homeTeamId===team.id?s.home:s.away;totals.winsAgainst+=f.homeTeamId===team.id?s.away:s.home;const outcome=teamMatchOutcome(f,team.id);if(outcome==='W')totals.won++;else if(outcome==='L')totals.lost++;else totals.drawn++;}
 const trophies=leagues.filter(l=>teamProfileChampion(l)===team.id);
 const next=matches.find(({league:l,fixture:f})=>l.status==='ACTIVE'&&f.round===l.currentRound&&!teamProfileFixtureComplete(f,l.starterCount));
 // Tournament snapshots retain the careers of members removed from the current roster.
 const members=new Map(leagues.flatMap(l=>l.teams[team.id]?.members||[]).map(m=>[m.id,m]));
 team.members.forEach(member=>members.set(member.id,member));
 const players=[...members.values()].map(member=>({...member,active:team.members.some(m=>m.id===member.id),played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0}));
 const byId=new Map(players.map(player=>[player.id,player]));
 for(const {fixture:f} of matches)for(const bout of f.bouts){
  if(bout.homeScore==null||bout.awayScore==null)continue;
  const home=f.homeTeamId===team.id,player=byId.get(home?bout.homeMemberId:bout.awayMemberId);if(!player)continue;
  const own=home?bout.homeScore:bout.awayScore,other=home?bout.awayScore:bout.homeScore;
  player.played++;player.goalsFor+=own;player.goalsAgainst+=other;if(own>other)player.won++;else if(own<other)player.lost++;else player.drawn++;
 }
 return {leagues,matches,totals,trophies,next,players};
}
