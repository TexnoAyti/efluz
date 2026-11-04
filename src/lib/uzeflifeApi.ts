import {getAuthHeaders} from './customTournamentApi';
import {isDesignPreview} from '../designPreview';
import {uzeflifeDemo} from './uzeflifeDemo';
import type {UState,UPermission} from '../types/uzeflife';
export type UViewState = UState & {topicResults?:{id:string;matchId:string;summary:string;home:number;away:number;penaltyHome:number|null;penaltyAway:number|null;url:string;expiresAt:number}[];permissions:UPermission[];isSuper:boolean;isOwner:boolean};
export async function uzeflifeRequest(action='',body?:unknown,options?:{signal?:AbortSignal;timeoutMs?:number}):Promise<any> {
  if(isDesignPreview) {
    if(body!==undefined) throw new Error('Namoyish rejimida turnirni o‘zgartirib bo‘lmaydi.');
    return structuredClone(uzeflifeDemo);
  }
  const mutation=body!==undefined;
  const timeoutMs=options?.timeoutMs??(mutation?30000:20000);
  const controller=new AbortController();
  const run=async()=>{
    const res=await fetch(`/api/uzeflife${action?`/${action}`:''}`,{
      method:body===undefined?'GET':'POST',headers:getAuthHeaders(),signal:controller.signal,
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    });
    const data=await res.json().catch(()=>{throw Error('Serverdan to‘g‘ri javob kelmadi. Holatni yangilang.');});
    if(!res.ok||!data.ok) throw Object.assign(new Error(data.error||'Turnirni yuklab bo‘lmadi.'),{channels:data.channels,knownRejection:res.status<500});
    return data;
  };
  // Bound fetch and body parsing even when the transport ignores abort.
  // An uncertain mutation is never automatically retried.
  return new Promise((resolve,reject)=>{
    let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{if(timer)clearTimeout(timer);options?.signal?.removeEventListener('abort',abort);};
    const finish=(error:any,value?:any)=>{if(settled)return;settled=true;cleanup();if(error){controller.abort();reject(error);}else resolve(value);};
    const abort=()=>finish(new DOMException('So‘rov bekor qilindi.','AbortError'));
    if(options?.signal?.aborted){abort();return;}
    options?.signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(Object.assign(new Error(mutation?'Javob kechikdi. Amal bajarilgan bo‘lishi mumkin. Holatni yangilang.':'So‘rov cho‘zilib ketdi. Holatni yangilab, qayta urinib ko‘ring.'),{code:'UZEFLIFE_REQUEST_TIMEOUT',uncertain:mutation})),Math.max(1,timeoutMs));
    run().then(value=>finish(null,value),error=>{if(mutation&&!error.knownRejection&&error.name!=='AbortError')error.uncertain=true;finish(error);});
  });
}
