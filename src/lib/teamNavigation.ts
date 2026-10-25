import {readElClasicoLaunch} from './elClasicoLinks';
export const TEAM_NAVIGATION_EVENT='efl:team-navigation';
const valid=(id:string)=>/^tp_[a-zA-Z0-9_-]{8,80}$/.test(id);
export function teamPagePath(id?:string){return id?`/teams/${encodeURIComponent(id)}`:'/teams';}
export function readTeamPageId(path:string){const match=/^\/teams\/([^/]+)\/?$/.exec(path);if(!match)return null;try{const id=decodeURIComponent(match[1]);return valid(id)?id:null;}catch{return null;}}
export type TeamNavigation={kind:'profile';id:string}|{kind:'directory'}|{kind:'workspace'}|{kind:'tournament';id:string;fixtureId?:string;tab?:'standings'|'fixtures'|'teams'|'manage'};
export function openTeamProfile(id:string){if(valid(id))window.dispatchEvent(new CustomEvent<TeamNavigation>(TEAM_NAVIGATION_EVENT,{detail:{kind:'profile',id}}));}
export function openTeamDirectory(){window.dispatchEvent(new CustomEvent<TeamNavigation>(TEAM_NAVIGATION_EVENT,{detail:{kind:'directory'}}));}
export function openTeamTournament(id:string,fixtureId?:string,tab?:'standings'|'fixtures'|'teams'|'manage'){if(valid(id))window.dispatchEvent(new CustomEvent<TeamNavigation>(TEAM_NAVIGATION_EVENT,{detail:{kind:'tournament',id,fixtureId,tab}}));}
export function readTeamTournamentLaunch(search=typeof window==='undefined'?'':window.location.search){const params=new URLSearchParams(search),id=params.get('teamTournament');if(!id||!valid(id))return null;const fixtureId=params.get('teamFixture')||undefined;const tab=params.get('teamTab');return {id,fixtureId:fixtureId&&/^[a-zA-Z0-9_-]{1,160}$/.test(fixtureId)?fixtureId:undefined,...(tab&&['standings','fixtures','teams','manage'].includes(tab)?{tab}: {})};}

export function openTeamWorkspace(){window.dispatchEvent(new CustomEvent<TeamNavigation>(TEAM_NAVIGATION_EVENT,{detail:{kind:'workspace'}}));}
export function isTeamWorkspaceLaunch(){return readElClasicoLaunch()||!!readTeamTournamentLaunch()||(typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('teamMode')==='1');}
/** Keep a focused fixture restorable without adding a history entry for each tab click. */
export function teamFixtureLocation(path:string,leagueId:string,fixtureId?:string){
 const url=new URL(path,'https://efl.local');
 url.searchParams.set('teamTournament',leagueId);
 if(fixtureId&&/^[a-zA-Z0-9_-]{1,160}$/.test(fixtureId))url.searchParams.set('teamFixture',fixtureId);else url.searchParams.delete('teamFixture');
 return url.pathname+url.search;
}
export function replaceTeamFixtureLocation(leagueId:string,fixtureId?:string){
 if(typeof window==='undefined'||!valid(leagueId))return;
 window.history.replaceState(window.history.state,'',teamFixtureLocation(window.location.href,leagueId,fixtureId));
}
export function profileSearchTarget(query:string,clubs:readonly {id:string;name:string;shortName?:string}[],teams:readonly {id:string;name:string}[]){
 const term=query.trim().toLocaleLowerCase();if(!term)return null;
 const candidates=[...clubs.map(c=>({kind:'club' as const,id:c.id,name:c.name,shortName:c.shortName})),...teams.map(t=>({kind:'team' as const,id:t.id,name:t.name,shortName:undefined}))];
 const exact=candidates.filter(item=>item.name.toLocaleLowerCase()===term||item.shortName?.toLocaleLowerCase()===term);
 const selected=exact.length===1?exact[0]:exact.length===0&&candidates.length===1?candidates[0]:null;
 return selected?{kind:selected.kind,id:selected.id}:null;
}
