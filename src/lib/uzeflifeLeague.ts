import type {UMatch,UState} from '../types/uzeflife';
export const UZEFLIFE_LEAGUE_ROUNDS=15;
export const isULeague=(s:Pick<UState,'format'>)=>s.format==='LEAGUE';
export const uMatchFinished=(m:UMatch)=>m.homeScore!==null&&m.awayScore!==null;
export function createULeagueMatches(ids:string[]):UMatch[]{
 if(ids.length<16||ids.length>256||ids.length%2||new Set(ids).size!==ids.length)throw Error('15 tur uchun 16–256 ta juft sonli, noyob ishtirokchi kerak.');
 const ring=[...ids],matches:UMatch[]=[];
 for(let round=1;round<=UZEFLIFE_LEAGUE_ROUNDS;round++){
  for(let i=0;i<ring.length/2;i++){
   const pair=[ring[i],ring[ring.length-1-i]];if((round+i)%2)pair.reverse();
   matches.push({id:`l${round}m${i}`,round,bracket:0,home:pair[0],away:pair[1],winner:null,homeScore:null,awayScore:null,penaltyHome:null,penaltyAway:null,proposal:null,scheduledAt:null});
  }
  ring.splice(1,0,ring.pop()!);
 }
 return matches;
}
export function uLeagueStandings(s:Pick<UState,'participants'|'matches'|'roster'>){
 const rows=new Map(s.participants.filter(p=>p.status==='approved'||s.matches.some(m=>m.home===p.id||m.away===p.id)).map((p,i)=>[p.id,{id:p.id,name:p.name,position:0,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,goalDifference:0,points:0,form:[] as string[],order:s.roster?.findIndex(slot=>slot.userId===p.id)??i}]));
 for(const m of s.matches){if(!uMatchFinished(m))continue;const home=rows.get(m.home!),away=rows.get(m.away!);if(!home||!away)continue;
  for(const [a,b,gf,ga] of [[home,away,m.homeScore!,m.awayScore!],[away,home,m.awayScore!,m.homeScore!]] as const){a.played++;a.goalsFor+=gf;a.goalsAgainst+=ga;const result=gf>ga?'W':gf===ga?'D':'L';a.form.push(result);if(result==='W'){a.won++;a.points+=3;}else if(result==='D'){a.drawn++;a.points++;}else a.lost++;a.goalDifference=a.goalsFor-a.goalsAgainst;}
 }
 return [...rows.values()].sort((a,b)=>b.points-a.points||b.goalDifference-a.goalDifference||b.goalsFor-a.goalsFor||a.order-b.order||a.id.localeCompare(b.id)).map((row,i)=>({...row,position:i+1}));
}
