import type {CustomTournamentFixture} from '../types/customTournament';

export function isCustomMatchReady(f:CustomTournamentFixture, fixtures:CustomTournamentFixture[]):boolean {
  if (f.status==='BYE_AUTO_ADVANCED'||[f.homeClubId,f.awayClubId].some(id=>['TBD','BYE'].includes(id))) return false;
  return !f.stage.startsWith('PLAYOFF')||f.leg!==2||fixtures.some(first=>first.id===f.id.replace(/_l2$/,'_l1')&&first.status==='CONFIRMED');
}

/** Penalties belong to a tied deciding game, in that game's home/away order. */
export function customMatchNeedsPenalties(f:CustomTournamentFixture, fixtures:CustomTournamentFixture[], home:number, away:number):boolean {
  if (!f.stage.startsWith('PLAYOFF')) return false;
  if (f.leg===2) {
    const first=fixtures.find(first=>first.id===f.id.replace(/_l2$/,'_l1'));
    return !!first&&first.status==='CONFIRMED'&&(first.homeScore??0)+away===(first.awayScore??0)+home;
  }
  return !fixtures.some(second=>second.id===f.id.replace(/_l1$/,'_l2'))&&home===away;
}

const stages=['LEAGUE','GROUP_STAGE','PLAYOFF_R32','PLAYOFF_R16','PLAYOFF_QF','PLAYOFF_SF','PLAYOFF_FINAL','PLAYOFF_THIRD_PLACE'];
export const customRoundKey=(f:CustomTournamentFixture)=>`${f.stage}:${f.roundOrMatchday}`;

/** Resolve a visible round after filtering; a saved round can disappear as the view changes. */
export function customScheduleView(fixtures:CustomTournamentFixture[],options:{userId?:string;mine?:boolean;group?:number;round?:string}={}) {
  const relevant=fixtures.filter(f=>(!options.mine||!!options.userId&&(f.homeUserId===options.userId||f.awayUserId===options.userId))&&
    (options.group===undefined||f.stage!=='GROUP_STAGE'||f.groupIndex===options.group))
    .sort((a,b)=>stages.indexOf(a.stage)-stages.indexOf(b.stage)||a.roundOrMatchday-b.roundOrMatchday||a.leg-b.leg||a.matchIndex-b.matchIndex||a.id.localeCompare(b.id));
  const rounds=[...new Set(relevant.map(customRoundKey))];
  const open=relevant.filter(f=>!['CONFIRMED','BYE_AUTO_ADVANCED'].includes(f.status));
  const next=open.find(f=>isCustomMatchReady(f,fixtures))??open[0]??relevant.at(-1);
  const round=options.round&&rounds.includes(options.round)?options.round:next?customRoundKey(next):'';
  return {rounds,round,fixtures:relevant.filter(f=>customRoundKey(f)===round)};
}

export function customAggregateScore(first:CustomTournamentFixture,second?:CustomTournamentFixture):{home:number;away:number}|null {
  if(!second||first.status!=='CONFIRMED'||second.status!=='CONFIRMED'||first.homeScore==null||first.awayScore==null||second.homeScore==null||second.awayScore==null)return null;
  return {home:first.homeScore+second.awayScore,away:first.awayScore+second.homeScore};
}
