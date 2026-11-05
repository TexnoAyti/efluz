import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { PREPARED_TIE_RULES, type TieMetric } from '../../content/season2Rules';

export interface PreparedResult { id: string; seasonId: string; homeClubId: string; awayClubId: string; homeScore: number; awayScore: number; status: 'CONFIRMED'; }
export interface ExtraRankData { discipline?: number; forfeits?: number; previousPosition?: number; }

/** Isolated preview. Equal ranks stay equal; alphabetical order is display-only. */
export function rankPreparedLeagueResults(leagueId: string, fixtures: PreparedResult[], options: {
  final?: boolean; decisivePositions?: number[]; extra?: Record<string,ExtraRankData>;
} = {}) {
  const league = EFL_SECOND_SEASON.leagues.find(item=>item.id===leagueId);
  if (!league) throw new Error('PREPARED_LEAGUE_NOT_FOUND');
  const rule = PREPARED_TIE_RULES[leagueId];
  const rows = league.roster.clubs.map(club=>({...club,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,goalDifference:0,points:0,awayGoals:0,awayWins:0}));
  const byId = new Map(rows.map(row=>[row.id,row]));
  const seenIds = new Set<string>(), seenPairs = new Set<string>();
  for (const f of fixtures) {
    if (f.seasonId!==EFL_SECOND_SEASON.id || !f.id || seenIds.has(f.id) || !byId.has(f.homeClubId) || !byId.has(f.awayClubId) || f.homeClubId===f.awayClubId || f.status!=='CONFIRMED' || !Number.isInteger(f.homeScore) || !Number.isInteger(f.awayScore) || f.homeScore<0 || f.awayScore<0 || f.homeScore>99 || f.awayScore>99) throw new Error('INVALID_PREPARED_RESULT');
    const key=f.homeClubId+'|'+f.awayClubId;
    if(seenPairs.has(key))throw new Error('DUPLICATE_PREPARED_PAIR');
    seenIds.add(f.id);seenPairs.add(key);
    const h=byId.get(f.homeClubId)!,a=byId.get(f.awayClubId)!;
    h.played++;a.played++;h.goalsFor+=f.homeScore;h.goalsAgainst+=f.awayScore;a.goalsFor+=f.awayScore;a.goalsAgainst+=f.homeScore;a.awayGoals+=f.awayScore;
    if(f.homeScore>f.awayScore){h.won++;h.points+=3;a.lost++;}
    else if(f.homeScore<f.awayScore){a.won++;a.awayWins++;a.points+=3;h.lost++;}
    else {h.drawn++;a.drawn++;h.points++;a.points++;}
  }
  for(const row of rows)row.goalDifference=row.goalsFor-row.goalsAgainst;
  const seasonComplete=fixtures.length===league.format.totalFixtures;
  if(options.final&&!seasonComplete)throw new Error('PREPARED_SEASON_INCOMPLETE');
  const reasons=new Set<string>();
  const h2hComplete=(ids:string[])=>ids.every(a=>ids.every(b=>a===b||seenPairs.has(a+'|'+b)));
  const metric=(row:typeof rows[number],key:TieMetric,base:string[]):number|null=>{
    if(key==='discipline'||key==='forfeits'||key==='previousPosition'){
      const v=options.extra?.[row.id]?.[key];return Number.isInteger(v)&&(v as number)>=0?(key==='forfeits'?Number(v!>0):v!):null;
    }
    if(!key.startsWith('h2h'))return row[key as keyof typeof row] as number;
    const wanted=new Set(base);let points=0,gf=0,ga=0,away=0;
    for(const f of fixtures)if(wanted.has(f.homeClubId)&&wanted.has(f.awayClubId)){
      if(f.homeClubId===row.id){gf+=f.homeScore;ga+=f.awayScore;points+=f.homeScore>f.awayScore?3:f.homeScore===f.awayScore?1:0;}
      if(f.awayClubId===row.id){gf+=f.awayScore;ga+=f.homeScore;away+=f.awayScore;points+=f.awayScore>f.homeScore?3:f.awayScore===f.homeScore?1:0;}
    }
    return key==='h2hPoints'?points:key==='h2hGoalDifference'?gf-ga:key==='h2hGoalsFor'?gf:away;
  };
  const pointGroups=new Map<number,typeof rows>();
  for(const row of rows){const group=pointGroups.get(row.points)||[];group.push(row);pointGroups.set(row.points,group);}
  const ordered: Array<typeof rows> = [];
  let position=1;
  for(const [,pointGroup] of [...pointGroups].sort((a,b)=>b[0]-a[0])){
    const decisive=(options.decisivePositions||[]).some(p=>p>=position&&p<position+pointGroup.length);
    const primary=leagueId==='league-premier-league'&&!decisive?rule.interimCriteria!:(!options.final&&rule.interimCriteria?rule.interimCriteria:pointGroup.length>2&&rule.multiTeamCriteria?rule.multiTeamCriteria:rule.criteria);
    const split=(group:typeof rows,criteria:TieMetric[],index:number,base:string[]):Array<typeof rows>=>{
      if(group.length<2)return [group];
      if(index>=criteria.length)return [group];
      const key=criteria[index];
      if(key.startsWith('h2h')&&!h2hComplete(base))return split(group,criteria,index+1,base);
      if(options.final&&leagueId==='league-saudi-pro-league'&&key==='discipline'&&group.length===2){
        const last=fixtures.at(-1);
        if(last&&group.some(row=>row.id===last.homeClubId)&&group.some(row=>row.id===last.awayClubId)){reasons.add('SPL_FINAL_MATCH_PLAYOFF_REQUIRED');return [group];}
      }
      const buckets=new Map<number,typeof rows>();
      for(const row of group){const v=metric(row,key,base);if(v===null){reasons.add('MISSING_'+key.toUpperCase());return [group];}const bucket=buckets.get(v)||[];bucket.push(row);buckets.set(v,bucket);}
      const ascending=['discipline','forfeits','previousPosition'].includes(key);
      return [...buckets].sort((a,b)=>ascending?a[0]-b[0]:b[0]-a[0]).flatMap(([,bucket])=>{
        if(rule.reapplyHeadToHead&&key.startsWith('h2h')&&(leagueId!=='league-saudi-pro-league'||key==='h2hGoalsFor')&&bucket.length>1&&bucket.length<base.length){
          const reduced=bucket.length>2&&rule.multiTeamCriteria?rule.multiTeamCriteria:rule.criteria;
          return split(bucket,reduced,1,bucket.map(row=>row.id));
        }
        return split(bucket,criteria,index+1,base);
      });
    };
    ordered.push(...split(pointGroup,primary,1,pointGroup.map(row=>row.id)));
    if(options.final&&leagueId==='league-serie-a'&&pointGroup.length>1&&(position===1||(position<=17&&position+pointGroup.length-1>=18)))reasons.add('SERIE_A_PLAYOFF_REVIEW');
    position+=pointGroup.length;
  }
  const unresolved:string[][]=[];position=1;
  const standings=ordered.flatMap(group=>{
    const rank=position;position+=group.length;
    if(group.length>1)unresolved.push(group.map(row=>row.id));
    return [...group].sort((a,b)=>a.name.localeCompare(b.name)).map(row=>({...row,position:rank,tied:group.length>1}));
  });
  if(unresolved.length)reasons.add('TIED_RANKS_REQUIRE_'+rule.resolution);
  if(rule.verification!=='VERIFIED')reasons.add('RULE_VERIFICATION_REQUIRED');
  return {seasonId:EFL_SECOND_SEASON.id,leagueId,official:false,persisted:false,standings,unresolved,ruleSource:rule.source,seasonComplete,canFinalize:Boolean(options.final&&seasonComplete&&!reasons.size),blockers:[...reasons]};
}
