import {getAuthHeaders} from './customTournamentApi';
import type {MatchChatAdminReport,MatchChatKind,MatchChatView} from '../types/matchChat';

export interface MatchChatTarget {kind:MatchChatKind;matchId:string;title?:string;opponentName?:string}
const eventName='efluz:open-match-chat';
export function openMatchChat(target:MatchChatTarget){window.dispatchEvent(new CustomEvent<MatchChatTarget>(eventName,{detail:target}));}
export function onMatchChatOpen(listener:(target:MatchChatTarget)=>void){const handler=(event:Event)=>listener((event as CustomEvent<MatchChatTarget>).detail);window.addEventListener(eventName,handler);return()=>window.removeEventListener(eventName,handler);}
export function readMatchChatLaunch():MatchChatTarget|null{if(typeof window==='undefined')return null;const query=new URLSearchParams(window.location.search),kind=query.get('chatKind'),matchId=query.get('chatMatch');if((kind!=='fixture'&&kind!=='uzeflife')||!matchId||!/^[A-Za-z0-9:_-]{1,180}$/.test(matchId))return null;query.delete('chatKind');query.delete('chatMatch');const next=query.toString();window.history.replaceState(window.history.state,'',`${window.location.pathname}${next?`?${next}`:''}${window.location.hash}`);return {kind,matchId};}

async function call(path:string,options:RequestInit={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(`/api/match-chat${path}`,{...options,headers:getAuthHeaders(),signal:controller.signal});const data=await response.json().catch(()=>({}));if(!response.ok||!data.ok)throw Object.assign(new Error(data.error||'Chatni yuklab bo‘lmadi.'),{status:response.status,code:data.code});return data;}catch(error:any){if(error?.name==='AbortError')throw new Error('Chat javobi kechikdi. Qayta urinib ko‘ring.');throw error;}finally{clearTimeout(timer);}}
const path=(target:MatchChatTarget)=>`/${target.kind}/${encodeURIComponent(target.matchId)}`;
export const matchChatApi={
 read:async(target:MatchChatTarget):Promise<MatchChatView>=>(await call(path(target))).chat,
 send:async(target:MatchChatTarget,text:string):Promise<MatchChatView>=>(await call(`${path(target)}/messages`,{method:'POST',body:JSON.stringify({text})})).chat,
 block:async(target:MatchChatTarget,blocked:boolean):Promise<MatchChatView>=>(await call(`${path(target)}/block`,{method:'POST',body:JSON.stringify({blocked})})).chat,
 report:async(target:MatchChatTarget,reason:string):Promise<MatchChatView>=>(await call(`${path(target)}/report`,{method:'POST',body:JSON.stringify({reason})})).chat,
 reports:async():Promise<MatchChatAdminReport[]> => (await call('/reports')).reports,
 resolveReport:async(roomId:string,reportId:string)=>call(`/reports/${encodeURIComponent(roomId)}/${encodeURIComponent(reportId)}/resolve`,{method:'POST',body:'{}'}),
 adminBlock:async(roomId:string,blocked:boolean)=>call(`/reports/${encodeURIComponent(roomId)}/block`,{method:'POST',body:JSON.stringify({blocked})}),
};
