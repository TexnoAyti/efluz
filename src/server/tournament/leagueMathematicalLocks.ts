import {projectStandings} from './standingsProjection';

export type LeagueLockInput={
 clubs:Array<{id:string;name:string;shortName:string;logoUrl?:string}>;
 fixtures:Array<{id:string;homeClubId?:string|null;awayClubId?:string|null;
  status:string;homeScore?:number|null;awayScore?:number|null}>;
 config?:{homeAndAway?:boolean;pointsForWin?:number;pointsForDraw?:number;pointsForLoss?:number;tieBreakers?:string[]};
};
export type LeagueLockResult={
 validSchedule:boolean;confirmed:number;remaining:number;
 championClubId:string|null;ranking:Array<{clubId:string;points:number;maxPoints:number;worstPossibleRank:number}>;
 lockedTop6:string[];lockedTop12:string[];
};
/** All scheduled matches must be present. A strict points margin (not a
 * projected goal difference) proves a rank group cannot change even if every
 * remaining match goes against the current club. Ties are deliberately
 * unresolved because head-to-head and goal difference can still change.
 */
export function evaluateLeagueMathematicalLocks(input:LeagueLockInput):LeagueLockResult{
 const {clubs,fixtures,config={}}=input;
 const empty:LeagueLockResult={validSchedule:false,confirmed:0,remaining:0,
  championClubId:null,ranking:[],lockedTop6:[],lockedTop12:[]};
 const ids=new Set(clubs.map(c=>c.id)),n=clubs.length;
 if(n<2||ids.size!==n||clubs.some(c=>!c.id))return empty;
 const double=config.homeAndAway===true;
 const expected=n*(n-1)/(double?1:2);
 if(fixtures.length!==expected)return empty;
 const pairs=new Set<string>(),remaining=new Map(clubs.map(c=>[c.id,0]));
 let confirmed=0;
 for(const f of fixtures){
  if(!f.id||!f.homeClubId||!f.awayClubId||f.homeClubId===f.awayClubId||
    !ids.has(f.homeClubId)||!ids.has(f.awayClubId))return empty;
  const pair=double?f.homeClubId+':'+f.awayClubId:
    [f.homeClubId,f.awayClubId].sort().join(':');
  if(pairs.has(pair))return empty;
  pairs.add(pair);
  if(f.status==='CONFIRMED'){
   if(!Number.isSafeInteger(f.homeScore)||!Number.isSafeInteger(f.awayScore)||
     Number(f.homeScore)<0||Number(f.awayScore)<0)return empty;
   confirmed++;
  }else if(f.status==='SCHEDULED'){
   remaining.set(f.homeClubId,remaining.get(f.homeClubId)!+1);
   remaining.set(f.awayClubId,remaining.get(f.awayClubId)!+1);
  }else return empty; // Unknown/contested score is not a mathematically settled result.
 }
 const win=Number(config.pointsForWin??3);
 const loss=Number(config.pointsForLoss??0);
 const draw=Number(config.pointsForDraw??1);
 if(![win,draw,loss].every(Number.isFinite)||win<draw||draw<loss||loss<0)return empty;
 const standings=projectStandings(clubs,fixtures,config);
 const ranking=standings.map(row=>({
  clubId:row.clubId,points:row.points,
  maxPoints:row.points+remaining.get(row.clubId)!*win,
  worstPossibleRank:0
 }));
 // Deliberate overestimate: competitors can all reach their individual
 // maximum in this bound, even where their schedules intersect.
 for(const row of ranking)
  row.worstPossibleRank=1+ranking.filter(other=>
    other.clubId!==row.clubId&&other.maxPoints>=row.points).length;
 const lockedTop=(k:number)=>ranking.filter(row=>row.worstPossibleRank<=k)
   .map(row=>row.clubId);
 const top6=lockedTop(6),top12=lockedTop(12);
 const leader=ranking[0];
 return {validSchedule:true,confirmed,remaining:expected-confirmed,
  championClubId:leader?.worstPossibleRank===1?leader.clubId:null,ranking,
  lockedTop6:top6.length===6?top6:[],lockedTop12:top12.length===12?top12:[]};
}
