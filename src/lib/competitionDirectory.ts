import type {League,Competition} from '../types';
import type {CustomTournament} from '../types/customTournament';
import type {TeamLeague} from '../types/teamLeaguePreview';

export type CompetitionCategory='all'|'leagues'|'cups'|'european';
export type CompetitionTarget=
 | {kind:'league';leagueId?:string}
 | {kind:'cup'|'european';competitionId?:string}
 | {kind:'custom';tournamentId:string;token?:string}
 | {kind:'team';tournamentId:string}
 | {kind:'teams'|'season'};
export type CompetitionState='UPCOMING'|'OPEN'|'ACTIVE'|'COMPLETED'|'CANCELLED';
export interface CompetitionEntry {
 key:string;name:string;category:Exclude<CompetitionCategory,'all'>;mode:'solo'|'team';
 origin:'EFL'|'ORGANIZER';state:CompetitionState;format:'LEAGUE'|'PLAYOFF'|'LEAGUE_AND_PLAYOFF';
 participants?:number;capacity?:number;round?:number;mine:boolean;logo?:string;target:CompetitionTarget;
}
export const competitionStateLabels:Record<CompetitionState,string>={UPCOMING:'Tayyorlanmoqda',OPEN:'Qabul ochiq',ACTIVE:'Davom etmoqda',COMPLETED:'Yakunlangan',CANCELLED:'Bekor qilingan'};
const icons:Record<string,string>={'league-premier-league':'premier-league','league-la-liga':'la-liga','league-serie-a':'serie-a','league-bundesliga':'bundesliga','league-ligue-1':'ligue-1'};
export function isDirectoryEuropean(c:Competition){
 return (c.type==='EUROPEAN_LEAGUE_PHASE'||c.type==='EUROPEAN_KNOCKOUT'||/champions|europa|ucl|uel/.test(c.id))&&!/conference|uecl/.test(c.id);
}
export function buildCompetitionDirectory({leagues,competitions,publicTournaments,myTournaments,teamLeagues,allowTeamPreview,ownedLeagueIds=[]}:{leagues:League[];competitions:Competition[];publicTournaments:CustomTournament[];myTournaments:CustomTournament[];teamLeagues:TeamLeague[];allowTeamPreview:boolean;ownedLeagueIds?:string[]}):CompetitionEntry[]{
 const entries:CompetitionEntry[]=[],covered=new Set<string>();
 for(const c of competitions){
  const european=isDirectoryEuropean(c);
  if(!european&&!['LEAGUE','KNOCKOUT','SUPER_CUP'].includes(c.type))continue;
  if(c.type==='LEAGUE'&&!c.leagueId)continue;
  const league=leagues.find(l=>l.id===c.leagueId);
  if(c.type==='LEAGUE'&&c.leagueId)covered.add(c.leagueId);
  const category=european?'european':c.type==='LEAGUE'?'leagues':'cups';
  entries.push({key:`efl:${c.id}`,name:c.name,category,mode:'solo',origin:'EFL',state:c.status==='active'?'ACTIVE':c.status==='completed'?'COMPLETED':'UPCOMING',format:c.type==='LEAGUE'?'LEAGUE':european?'LEAGUE_AND_PLAYOFF':'PLAYOFF',capacity:c.totalTeams??c.formatConfig?.maxTeams??league?.totalClubs,round:c.currentMatchday,mine:c.type==='LEAGUE'&&!!c.leagueId&&ownedLeagueIds.includes(c.leagueId),logo:league?(icons[league.id]?`/welcome/${icons[league.id]}.svg`:league.logoUrl):undefined,target:c.type==='LEAGUE'?{kind:'league',leagueId:c.leagueId}:european?{kind:'european',competitionId:c.id}:{kind:'cup',competitionId:c.id}});
 }
 for(const league of leagues){if(covered.has(league.id))continue;entries.push({key:`efl-league:${league.id}`,name:league.name,category:'leagues',mode:'solo',origin:'EFL',state:'UPCOMING',format:'LEAGUE',capacity:league.totalClubs,mine:ownedLeagueIds.includes(league.id),logo:icons[league.id]?`/welcome/${icons[league.id]}.svg`:league.logoUrl,target:{kind:'league',leagueId:league.id}});}
 // My list is authenticated and may contain private drafts/assistant entries.
 // Merge by ID, retaining its authoritative access-scoped version of each item.
 const mine=new Set(myTournaments.map(t=>t.id)),custom=new Map(publicTournaments.filter(t=>t.visibility!=='PRIVATE'&&t.status!=='DRAFT').map(t=>[t.id,t]));
 for(const t of myTournaments)custom.set(t.id,t);
 for(const t of custom.values())entries.push({key:`custom:${t.id}`,name:t.name,category:t.format==='PLAYOFF'?'cups':'leagues',mode:'solo',origin:'ORGANIZER',state:t.status==='REGISTRATION_OPEN'?'OPEN':t.status==='IN_PROGRESS'||t.status==='STARTING'?'ACTIVE':t.status==='COMPLETED'?'COMPLETED':t.status==='CANCELLED'?'CANCELLED':'UPCOMING',format:t.format,participants:t.currentParticipantsCount,capacity:t.maxParticipants,mine:mine.has(t.id),target:{kind:'custom',tournamentId:t.id}});
 if(allowTeamPreview)for(const t of teamLeagues)entries.push({key:`team:${t.id}`,name:t.name,category:t.format==='PLAYOFF'?'cups':'leagues',mode:'team',origin:'ORGANIZER',state:t.status==='ACTIVE'?'ACTIVE':t.status==='COMPLETED'?'COMPLETED':t.status==='CANCELLED'?'CANCELLED':'UPCOMING',format:t.format||'LEAGUE',participants:t.teamIds.length,capacity:t.teamIds.length,round:t.currentRound,mine:true,target:{kind:'team',tournamentId:t.id}});
 return entries;
}
export function filterCompetitionDirectory(entries:CompetitionEntry[],filter:{category:CompetitionCategory;scope:'all'|'my';search:string;state:'ALL'|CompetitionState;mode:'all'|'solo'|'team'}){
 const query=filter.search.trim().toLocaleLowerCase();
 return entries.filter(e=>(filter.category==='all'||e.category===filter.category)&&(filter.scope==='all'||e.mine)&&(!query||e.name.toLocaleLowerCase().includes(query))&&(filter.state==='ALL'||e.state===filter.state)&&(filter.mode==='all'||e.mode===filter.mode));
}
