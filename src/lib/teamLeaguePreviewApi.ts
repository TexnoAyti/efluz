import {getAuthHeaders} from './customTournamentApi';
import type {PreviewTeam,TeamLeague} from '../types/teamLeaguePreview';
export const previewId=()=>`tp_${crypto.randomUUID()}`;
async function rawTeamPreviewRequest<T>(path='',body?:unknown):Promise<T>{
 const response=await fetch(`/api/team-leagues-preview${path}`,{method:body?'POST':'GET',headers:getAuthHeaders(),...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'So‘rov bajarilmadi.'),{status:response.status,code:result.code,groupUrl:result.groupUrl,groupName:result.groupName});return result.data;
}
export const loadTeamPreview=(management=false)=>teamPreviewRequest<{teams:PreviewTeam[];leagues:TeamLeague[]}>(management?'':'/published');

export async function hydrateTeamTransport<T>(data:T,get:(path:string)=>Promise<any>):Promise<T>{
 const value=data as any;if(!value||typeof value!=='object')return data;
 for(const [field,pageField] of [['teams','teamPage'],['fixtures','fixturePage']]){
  if(!value[pageField])continue;
  const first=value[pageField],items=[...(value[field]||[])];let next=first.next,pages=0;
  while(next){if(++pages>100||typeof next!=='string'||!/^\/(?:published\/)?(?:leagues\/tp_[A-Za-z0-9_-]+|teams\/tp_[A-Za-z0-9_-]+|membership)?\?/.test(next)&&!/^\/published\?/.test(next)&&!/^\/\?/.test(next))throw Error('Team sahifasi manzili noto‘g‘ri.');
   const result=await get(next),page=result[pageField];if(!page||page.snapshot!==first.snapshot||page.total!==first.total||!Array.isArray(result[field]))throw Error('Team ma’lumotlari yangilandi. Qayta yuklang.');items.push(...result[field]);next=page.next;
  }
  if(items.length!==first.total)throw Error('Team ma’lumotlari to‘liq yuklanmadi. Qayta urinib ko‘ring.');value[field]=items;delete value[pageField];
 }
 if(Array.isArray(value.leagues))for(const league of value.leagues)await hydrateTeamTransport(league,get);
 return data;
}
export async function teamPreviewRequest<T>(path='',body?:unknown):Promise<T>{return hydrateTeamTransport(await rawTeamPreviewRequest<T>(path,body),next=>rawTeamPreviewRequest(next));}
