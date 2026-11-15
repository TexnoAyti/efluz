/** Season 1 domestic leagues/cups are historical.
 * Only the still-running UEFA Champions/Europa League fixtures may send
 * unfinished-game reminders for that season. Season 2 remains active.
 */
export const LEGACY_SEASON_ID='season-2026-27';
export const CURRENT_LEAGUE_SEASON_ID='season-2027-28';
const LEGACY_EUROPEAN_IDS=new Set([
  'comp-champions-league-2026',
  'comp-europa-league-2026',
]);
export function unplayedReminderCompetitionAllowed(seasonId:string|undefined,competitionId:string|undefined):boolean{
  if(!seasonId)return false;
  if(seasonId===LEGACY_SEASON_ID)return Boolean(competitionId)&&LEGACY_EUROPEAN_IDS.has(competitionId);
  // Synthetic test seasons and future seasons retain the existing delivery
  // behavior. This policy restricts *only* retired Season 1 competitions.
  return true;
}
/** Prevent old queued Season 1 non-UEFA backlog jobs from reaching Telegram. */
export function unplayedReminderJobAllowed(job:{seasonId?:string;leagueReminder?:{competitionId:string;seasonId:string};eventId?:string;competitionId?:string}):boolean{
  const season=job.leagueReminder?.seasonId||job.seasonId;
  if(season!==LEGACY_SEASON_ID)return true;
  const comp=job.leagueReminder?.competitionId||job.competitionId;
  return Boolean(comp)&&unplayedReminderCompetitionAllowed(season,comp);
}
