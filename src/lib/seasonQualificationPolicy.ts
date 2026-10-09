/** Owner-confirmed 2026/27 domestic allocations: 32 UCL and 32 UEL places. */
export const SEASON_2026_27_ALLOCATION:Readonly<Record<string,number>>=Object.freeze({
  'comp-premier-league-2026':7,
  'comp-la-liga-2026':7,
  'comp-serie-a-2026':6,
  'comp-bundesliga-2026':6,
  'comp-ligue-1-2026':6,
});
export function withSeasonQualificationPolicy<T extends {id:string;formatConfig?:any}>(competition:T,seasonId:string):T {
  if(seasonId!=='season-2026-27')return competition;
  const count=SEASON_2026_27_ALLOCATION[competition.id];
  if(count!=null)return {...competition,formatConfig:{...competition.formatConfig,qualificationSpots:count,europaQualificationSpots:count}};
  if(competition.id==='comp-champions-league-2026'||competition.id==='comp-europa-league-2026'){
    return {...competition,formatConfig:{...competition.formatConfig,leaguePhaseTeams:32,qualificationSlots:{...competition.formatConfig?.qualificationSlots,...SEASON_2026_27_ALLOCATION}}};
  }
  return competition;
}
