/**
 * Season-one Super Cup qualification rules.
 * This module has no database, webhook or notification side effects.
 * 2026 format: England/Germany/Italy 2 clubs, Spain 4.
 * Conflicting qualifications are replaced by the next ranked league club.
 */
export const SEASON_ONE_SUPERCUPS = {
  'comp-community-shield-2026': {league:'comp-premier-league-2026', cup:'comp-fa-cup-2026', size:2},
  'comp-supercopa-espana-2026': {league:'comp-la-liga-2026',cup:'comp-copa-del-rey-2026',size:4},
  'comp-supercoppa-italiana-2026': {league:'comp-serie-a-2026',cup:'comp-coppa-italia-2026',size:2},
  'comp-dfl-supercup-2026': {league:'comp-bundesliga-2026',cup:'comp-dfb-pokal-2026',size:2},
} as const;
export type SeasonOneSupercupId=keyof typeof SEASON_ONE_SUPERCUPS;
export type QualifiedClub={clubId:string;reason:string};
export type SupercupPlan={
  competitionId:SeasonOneSupercupId;
  seasonId:'season-2026-27';
  size:2|4;
  canCreate:boolean;
  blockReasons:string[];
  qualifiers:QualifiedClub[];
  pairings:Array<{homeClubId:string;awayClubId:string}>;
};
export function isSeasonOneSupercup(id:string):id is SeasonOneSupercupId {
 return Object.prototype.hasOwnProperty.call(SEASON_ONE_SUPERCUPS,id);
}
export function previewSeasonOneSupercup(input:{
 competitionId:string;
 leagueComplete:boolean;
 cupFinal:{status:string;homeClubId:string|null;awayClubId:string|null;winnerClubId:string|null}|null;
 rankedClubIds:string[];
 existingFixtureCount:number;
}):SupercupPlan{
 const {competitionId,leagueComplete,cupFinal,rankedClubIds,existingFixtureCount}=input;
 if(!isSeasonOneSupercup(competitionId))throw Error('INVALID_SEASON_ONE_SUPERCUP');
 const size=SEASON_ONE_SUPERCUPS[competitionId].size;
 const blockReasons:string[]=[];
 if(!leagueComplete)blockReasons.push('LEAGUE_NOT_COMPLETE');
 if(!cupFinal || cupFinal.status!=='CONFIRMED'||!cupFinal.homeClubId||
   !cupFinal.awayClubId||cupFinal.homeClubId===cupFinal.awayClubId||
   !cupFinal.winnerClubId ||
   ![cupFinal.homeClubId,cupFinal.awayClubId].includes(cupFinal.winnerClubId))
  blockReasons.push('CUP_FINAL_NOT_CONFIRMED');
 if(existingFixtureCount!==0)blockReasons.push('SUPERCUP_ALREADY_GENERATED');
 if(rankedClubIds.length<2||new Set(rankedClubIds).size!==rankedClubIds.length||
    rankedClubIds.some(id=>typeof id!=='string'||!id))
  blockReasons.push('INVALID_LEAGUE_RANKING');
 const qualifiers:QualifiedClub[]=[];
 if(!blockReasons.includes('CUP_FINAL_NOT_CONFIRMED')&&!blockReasons.includes('INVALID_LEAGUE_RANKING')){
  const cupWinner=cupFinal!.winnerClubId!;
  const cupRunnerUp=cupFinal!.homeClubId===cupWinner?cupFinal!.awayClubId!:cupFinal!.homeClubId!;
  const add=(clubId:string,reason:string)=>{
    if(!qualifiers.some(q=>q.clubId===clubId))qualifiers.push({clubId,reason});
  };
  if(size===2){
   add(rankedClubIds[0],'League champion');
   add(cupWinner,'Domestic cup champion');
  }else{
   add(rankedClubIds[0],'League champion');
   add(rankedClubIds[1],'League runner-up');
   add(cupWinner,'Domestic cup champion');
   add(cupRunnerUp,'Domestic cup runner-up');
  }
  // A league-and-cup double should never create a duplicate team or a bye.
  // Prioritize the league and cup qualifiers already selected and fill from
  // the league table, keeping existing seeding order deterministic.
  for(const clubId of rankedClubIds){
   if(qualifiers.length>=size)break;
   add(clubId,'Next highest league position');
  }
  if(qualifiers.length!==size)blockReasons.push('INSUFFICIENT_DISTINCT_CLUBS');
 }
 const pairings=blockReasons.length?[]:size===2
   ?[{homeClubId:qualifiers[0].clubId,awayClubId:qualifiers[1].clubId}]
   :[{homeClubId:qualifiers[0].clubId,awayClubId:qualifiers[3].clubId},
     {homeClubId:qualifiers[1].clubId,awayClubId:qualifiers[2].clubId}];
 return {competitionId,seasonId:'season-2026-27',size,canCreate:blockReasons.length===0,
  blockReasons,qualifiers,pairings};
}

/** Manual admin entry: no league/cup completion or champion proof requirement.
 * The provided order is the admin's intended seed order, not an official result.
 * Existing generated fixtures are never overwritten.
 */
export function previewManualSeasonOneSupercup(input:{
 competitionId:string;
 selectedClubIds:string[];
 validClubIds:string[];
 existingFixtureCount:number;
 existingParticipantCount:number;
}):SupercupPlan {
 const {competitionId,selectedClubIds,validClubIds,existingFixtureCount,existingParticipantCount}=input;
 if(!isSeasonOneSupercup(competitionId))throw Error('INVALID_SEASON_ONE_SUPERCUP');
 const size=SEASON_ONE_SUPERCUPS[competitionId].size;
 const blockReasons:string[]=[];
 if(existingFixtureCount!==0)blockReasons.push('SUPERCUP_ALREADY_GENERATED');
 if(existingParticipantCount!==0)blockReasons.push('SUPERCUP_PARTICIPANTS_ALREADY_REGISTERED');
 const distinct=new Set(selectedClubIds);
 const allowed=new Set(validClubIds);
 if(selectedClubIds.length!==size)blockReasons.push('SUPERCUP_SELECTION_SIZE_MISMATCH');
 if(distinct.size!==selectedClubIds.length)blockReasons.push('SUPERCUP_DUPLICATE_CLUB');
 if(selectedClubIds.some(id=>typeof id!=='string'||!allowed.has(id)))
  blockReasons.push('SUPERCUP_CLUB_OUTSIDE_LEAGUE');
 const qualifiers=selectedClubIds.map((clubId,i)=>({clubId,reason:`Admin selected, seed ${i+1}`}));
 const pairings=blockReasons.length?[]:size===2
  ?[{homeClubId:selectedClubIds[0],awayClubId:selectedClubIds[1]}]
  :[{homeClubId:selectedClubIds[0],awayClubId:selectedClubIds[3]},
    {homeClubId:selectedClubIds[1],awayClubId:selectedClubIds[2]}];
 return {competitionId,seasonId:'season-2026-27',size,canCreate:blockReasons.length===0,
  blockReasons,qualifiers,pairings};
}
