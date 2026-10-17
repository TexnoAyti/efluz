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
