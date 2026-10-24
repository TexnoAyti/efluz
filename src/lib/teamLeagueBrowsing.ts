import type {TeamLeague} from '../types/teamLeaguePreview';

type LeagueChoice=Pick<TeamLeague,'id'|'name'|'status'>;
const priority={ACTIVE:0,DRAFT:1,COMPLETED:2,CANCELLED:3};
export function orderedTeamLeagues<T extends LeagueChoice>(leagues:readonly T[]):T[]{
 return [...leagues].sort((a,b)=>priority[a.status]-priority[b.status]||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
export function selectedTeamLeague(leagues:readonly LeagueChoice[],requested:string,remembered=''):string{
 return leagues.some(l=>l.id===requested)?requested:leagues.some(l=>l.id===remembered)?remembered:orderedTeamLeagues(leagues)[0]?.id||'';
}
export function swipedTeamLeague(leagues:readonly LeagueChoice[],selected:string,dx:number,dy:number):string{
 if(Math.abs(dx)<70||Math.abs(dx)<=Math.abs(dy)*1.5)return selected;
 const ordered=orderedTeamLeagues(leagues),index=ordered.findIndex(l=>l.id===selected);
 return ordered[index+(dx<0?1:-1)]?.id||selected;
}
