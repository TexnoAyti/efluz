import type {TeamFixture,TeamLeague,TeamStanding} from '../types/teamLeaguePreview';
export function makeTeamSchedule(id:string,teamIds:string[],rounds:1|2):TeamFixture[]{
 const circle:Array<string|null>=[...teamIds];if(circle.length%2)circle.push(null);
 const fixtures:TeamFixture[]=[],count=circle.length-1;
 for(let leg=0;leg<rounds;leg++)for(let r=0;r<count;r++){
  for(let m=0;m<circle.length/2;m++){
   const a=circle[m],b=circle[circle.length-1-m];if(!a||!b)continue;
   const swap=(m===0&&r%2===1)!==(leg===1);
   fixtures.push({id:`${id}_r${leg*count+r+1}_m${m}`,round:leg*count+r+1,homeTeamId:swap?b:a,awayTeamId:swap?a:b,homeLineup:null,awayLineup:null,bouts:[]});
  }
  circle.splice(1,0,circle.pop()!);
 }
 return fixtures;
}
export function teamFixtureScore(f:TeamFixture){
 let home=0,away=0,draws=0,played=0;
 for(const b of f.bouts)if(b.homeScore!=null&&b.awayScore!=null){played++;if(b.homeScore>b.awayScore)home++;else if(b.homeScore<b.awayScore)away++;else draws++;}
 return {home,away,draws,played,complete:f.bouts.length>0&&played===f.bouts.length};
}
export const teamPoints=(l:Pick<TeamLeague,'points'>)=>l.points??{win:3,draw:1,loss:0};
export function teamStandings(l:TeamLeague):TeamStanding[]{
 const points=teamPoints(l);
 const rows=new Map(l.teamIds.map(teamId=>[teamId,{teamId,name:l.teams[teamId]?.name||teamId,position:0,played:0,won:0,drawn:0,lost:0,winsFor:0,winsAgainst:0,points:0}]));
 for(const f of l.fixtures){if(f.stage==='PLAYOFF')continue;const s=teamFixtureScore(f);if(!s.complete)continue;const h=rows.get(f.homeTeamId)!,a=rows.get(f.awayTeamId)!;
  h.played++;a.played++;h.winsFor+=s.home;h.winsAgainst+=s.away;a.winsFor+=s.away;a.winsAgainst+=s.home;
  if(s.home>s.away){h.won++;h.points+=points.win;a.lost++;a.points+=points.loss;}else if(s.home<s.away){a.won++;a.points+=points.win;h.lost++;h.points+=points.loss;}else{h.drawn++;a.drawn++;h.points+=points.draw;a.points+=points.draw;}
 }
 return [...rows.values()].sort((a,b)=>b.points-a.points||(b.winsFor-b.winsAgainst)-(a.winsFor-a.winsAgainst)||b.winsFor-a.winsFor||a.name.localeCompare(b.name)).map((r,i)=>({...r,position:i+1}));
}

export const teamFormatLabels={LEAGUE:'Liga',PLAYOFF:'Pley-off',LEAGUE_AND_PLAYOFF:'Liga + pley-off'};
export function teamFixtureWinner(f:TeamFixture):string|null {
 const s=teamFixtureScore(f);if(!s.complete)return null;
 if(s.home>s.away)return f.homeTeamId;if(s.away>s.home)return f.awayTeamId;
 return [f.homeTeamId,f.awayTeamId].includes(f.tieBreakWinnerId||'')?f.tieBreakWinnerId!:null;
}
export function makeTeamPlayoffRound(id:string,seeds:string[],round:number):TeamFixture[]{
 if(seeds.length<2||!Number.isInteger(Math.log2(seeds.length)))throw Error('Pley-off uchun 2, 4, 8, 16, 32 yoki 64 team kerak.');
 return Array.from({length:seeds.length/2},(_,i)=>({id:`${id}_p${round}_m${i}`,stage:'PLAYOFF' as const,round,homeTeamId:seeds[i],awayTeamId:seeds[seeds.length-1-i],homeLineup:null,awayLineup:null,bouts:[]}));
}
export function teamFormatPreview(count:number,format:TeamLeague['format']='LEAGUE',rounds:1|2=1,qualifiers=4){
 const leagueRounds=(count%2?count:count-1)*rounds,leagueMatches=count*(count-1)/2*rounds;
 return {matches:format==='PLAYOFF'?count-1:leagueMatches+(format==='LEAGUE_AND_PLAYOFF'?qualifiers-1:0),rounds:format==='PLAYOFF'?Math.log2(count):leagueRounds+(format==='LEAGUE_AND_PLAYOFF'?Math.log2(qualifiers):0)};
}
export function teamPlayerStats(l:TeamLeague){
 const rows=Object.values(l.teams).flatMap(t=>t.members.map(p=>({id:t.id+':'+p.id,memberId:p.id,teamId:t.id,name:p.name,teamName:t.name,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0})));
 const map=new Map(rows.map(r=>[r.id,r]));
 for(const f of l.fixtures)for(const b of f.bouts){if(b.homeScore==null||b.awayScore==null)continue;const h=map.get(f.homeTeamId+':'+b.homeMemberId),a=map.get(f.awayTeamId+':'+b.awayMemberId);if(!h||!a)continue;h.played++;a.played++;h.goalsFor+=b.homeScore;h.goalsAgainst+=b.awayScore;a.goalsFor+=b.awayScore;a.goalsAgainst+=b.homeScore;if(b.homeScore>b.awayScore){h.won++;a.lost++;}else if(b.homeScore<b.awayScore){a.won++;h.lost++;}else{h.drawn++;a.drawn++;}}
 return rows.sort((a,b)=>b.won-a.won||(b.goalsFor-b.goalsAgainst)-(a.goalsFor-a.goalsAgainst)||b.goalsFor-a.goalsFor||a.name.localeCompare(b.name));
}
