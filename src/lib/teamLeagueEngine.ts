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
export function teamStandings(l:TeamLeague):TeamStanding[]{
 const rows=new Map(l.teamIds.map(teamId=>[teamId,{teamId,name:l.teams[teamId]?.name||teamId,position:0,played:0,won:0,drawn:0,lost:0,winsFor:0,winsAgainst:0,points:0}]));
 for(const f of l.fixtures){const s=teamFixtureScore(f);if(!s.complete)continue;const h=rows.get(f.homeTeamId)!,a=rows.get(f.awayTeamId)!;
  h.played++;a.played++;h.winsFor+=s.home;h.winsAgainst+=s.away;a.winsFor+=s.away;a.winsAgainst+=s.home;
  if(s.home>s.away){h.won++;h.points+=3;a.lost++;}else if(s.home<s.away){a.won++;a.points+=3;h.lost++;}else{h.drawn++;a.drawn++;h.points++;a.points++;}
 }
 return [...rows.values()].sort((a,b)=>b.points-a.points||(b.winsFor-b.winsAgainst)-(a.winsFor-a.winsAgainst)||b.winsFor-a.winsFor||a.name.localeCompare(b.name)).map((r,i)=>({...r,position:i+1}));
}
