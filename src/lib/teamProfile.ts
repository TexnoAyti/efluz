import type {PreviewTeam,TeamLeague,TeamFixture} from '../types/teamLeaguePreview';
import {teamFixtureScore,teamFixtureWinner,teamStandings,teamPlayerStats} from './teamLeagueEngine';
export interface TeamProfileData {team:PreviewTeam;leagues:TeamLeague[];teams:Array<Pick<PreviewTeam,'id'|'name'|'logo'>>}
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
 const allStats=leagues.flatMap(teamPlayerStats).filter(p=>p.teamId===team.id);
 const players=[...members.values()].map(member=>{const stats=allStats.filter(p=>p.memberId===member.id);return {...member,active:team.members.some(m=>m.id===member.id),played:stats.reduce((n,p)=>n+p.played,0),won:stats.reduce((n,p)=>n+p.won,0),drawn:stats.reduce((n,p)=>n+p.drawn,0),lost:stats.reduce((n,p)=>n+p.lost,0),goalsFor:stats.reduce((n,p)=>n+p.goalsFor,0),goalsAgainst:stats.reduce((n,p)=>n+p.goalsAgainst,0)};});
 return {leagues,matches,totals,trophies,next,players};
}
