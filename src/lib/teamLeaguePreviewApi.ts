import {getAuthHeaders} from './customTournamentApi';
import type {PreviewTeam,TeamLeague} from '../types/teamLeaguePreview';
export const previewId=()=>`tp_${crypto.randomUUID()}`;
export async function teamPreviewRequest<T>(path='',body?:unknown):Promise<T>{
 const response=await fetch(`/api/team-leagues-preview${path}`,{method:body?'POST':'GET',headers:getAuthHeaders(),...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'So‘rov bajarilmadi.'),{status:response.status});return result.data;
}
export const loadTeamPreview=(management=false)=>teamPreviewRequest<{teams:PreviewTeam[];leagues:TeamLeague[]}>(management?'':'/published');
