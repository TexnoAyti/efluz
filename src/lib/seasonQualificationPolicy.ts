/** 2026/27 allocations across four active domestic leagues: 32 UCL and 32 UEL places. */
export const SEASON_2026_27_ALLOCATION:Readonly<Record<string,number>>=Object.freeze({
  'comp-premier-league-2026':8,
  'comp-la-liga-2026':8,
  'comp-serie-a-2026':8,
  'comp-bundesliga-2026':8,
});
export function withSeasonQualificationPolicy<T extends {id:string;formatConfig?:any}>(competition:T,seasonId:string):T {
  if(seasonId!=='season-2026-27')return competition;
  const count=SEASON_2026_27_ALLOCATION[competition.id];
  if(count!=null)return {...competition,formatConfig:{...competition.formatConfig,qualificationSpots:count,europaQualificationSpots:count}};
  if(competition.id==='comp-champions-league-2026'||competition.id==='comp-europa-league-2026'){
    return {...competition,formatConfig:{...competition.formatConfig,leaguePhaseTeams:32,qualificationSlots:{...SEASON_2026_27_ALLOCATION}}};
  }
  return competition;
}

/** Shared table thresholds; current-season overrides also correct old cached configs. */
export function seasonQualificationRanges(
  competition: {id: string; formatConfig?: any}, seasonId: string,
): { uclEnd: number; uelEnd: number } {
  const config = withSeasonQualificationPolicy(competition, seasonId).formatConfig || {};
  const count = (value: unknown) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  const uclEnd = count(config.qualificationSpots);
  return { uclEnd, uelEnd: uclEnd + count(config.europaQualificationSpots ?? config.qualificationSpots) };
}
