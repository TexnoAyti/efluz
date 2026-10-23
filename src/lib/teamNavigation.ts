export const TEAM_NAVIGATION_EVENT='efl:team-navigation';
const valid=(id:string)=>/^tp_[a-zA-Z0-9_-]{8,80}$/.test(id);
export function teamPagePath(id?:string){return id?`/teams/${encodeURIComponent(id)}`:'/teams';}
export function readTeamPageId(path:string){const match=/^\/teams\/([^/]+)\/?$/.exec(path);if(!match)return null;try{const id=decodeURIComponent(match[1]);return valid(id)?id:null;}catch{return null;}}
export type TeamNavigation={kind:'profile';id:string}|{kind:'directory'}|{kind:'workspace'}|{kind:'tournament';id:string;fixtureId?:string};
export function openTeamProfile(id:string){if(valid(id))window.dispatchEvent(new CustomEvent<TeamNavigation>(TEAM_NAVIGATION_EVENT,{detail:{kind:'profile',id}}));}
export function openTeamDirectory(){window.dispatchEvent(new CustomEvent<TeamNavigation>(TEAM_NAVIGATION_EVENT,{detail:{kind:'directory'}}));}
export function openTeamTournament(id:string,fixtureId?:string){if(valid(id))window.dispatchEvent(new CustomEvent<TeamNavigation>(TEAM_NAVIGATION_EVENT,{detail:{kind:'tournament',id,fixtureId}}));}
export function readTeamTournamentLaunch(search=typeof window==='undefined'?'':window.location.search){const params=new URLSearchParams(search),id=params.get('teamTournament');if(!id||!valid(id))return null;const fixtureId=params.get('teamFixture')||undefined;return {id,fixtureId:fixtureId&&/^[a-zA-Z0-9_-]{1,160}$/.test(fixtureId)?fixtureId:undefined};}

export function openTeamWorkspace(){window.dispatchEvent(new CustomEvent<TeamNavigation>(TEAM_NAVIGATION_EVENT,{detail:{kind:'workspace'}}));}
export function isTeamWorkspaceLaunch(){return !!readTeamTournamentLaunch()||(typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('teamMode')==='1');}
