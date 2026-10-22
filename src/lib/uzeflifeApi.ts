import {getAuthHeaders} from './customTournamentApi';
import {isDesignPreview} from '../designPreview';
import {uzeflifeDemo} from './uzeflifeDemo';
import type {UState,UPermission} from '../types/uzeflife';
export type UViewState = UState & {permissions:UPermission[];isSuper:boolean;isOwner:boolean};
export async function uzeflifeRequest(action='',body?:unknown):Promise<any> {
  if(isDesignPreview) {
    if(body!==undefined) throw new Error('Namoyish rejimida turnirni o‘zgartirib bo‘lmaydi.');
    return structuredClone(uzeflifeDemo);
  }
  const res=await fetch(`/api/uzeflife${action?`/${action}`:''}`,{
    method:body===undefined?'GET':'POST',headers:getAuthHeaders(),
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const data=await res.json();
  if(!res.ok||!data.ok) throw Object.assign(new Error(data.error||'Turnirni yuklab bo‘lmadi.'),{channels:data.channels});
  return data;
}
