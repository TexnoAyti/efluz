import React,{useEffect,useState} from 'react';
import {getSessionToken,getTelegramInitData} from '../../lib/api';
import {useAuth} from '../../context/AuthContext';

const cupChoices=[
 ['comp-community-shield-2026','FA Community Shield'],
 ['comp-supercopa-espana-2026','Supercopa de España'],
 ['comp-supercoppa-italiana-2026','Supercoppa Italiana'],
 ['comp-dfl-supercup-2026','DFL-Supercup'],
] as const;
type Preview={
 competitionId:string;size:2|4;canCreate:boolean;blockReasons:string[];
 sourceToken:string;sourceLeagueId:string;sourceCupId:string;
 qualifiers:Array<{clubId:string;reason:string}>;
 pairings:Array<{homeClubId:string;awayClubId:string}>;
 existingParticipants:number;
};
const labels:Record<string,string>={
 LEAGUE_NOT_COMPLETE:'Liga o‘yinlari hali to‘liq tasdiqlanmagan',
 CUP_FINAL_NOT_CONFIRMED:'Milliy kubok finali hali tasdiqlanmagan',
 SUPERCUP_ALREADY_GENERATED:'Superkubok uchrashuvlari allaqachon yaratilgan',
 SUPERCUP_PARTICIPANTS_ALREADY_REGISTERED:'Superkubok ishtirokchilari bazada mavjud',
 INVALID_LEAGUE_RANKING:'Liga reytingi noto‘g‘ri yoki to‘liq emas',
 INSUFFICIENT_DISTINCT_CLUBS:'Yetarli turli klublar mavjud emas',
 CUP_WINNER_OUTSIDE_LEAGUE:'Kubok g‘olibi manba ligada topilmadi',
 CUP_FINALIST_OUTSIDE_LEAGUE:'Finalchi klub manba ligada topilmadi',
};
async function guardedRequest<T>(url:string,init:RequestInit={}):Promise<T>{
 const headers:Record<string,string>={'Content-Type':'application/json'};
 const token=getSessionToken(),telegram=getTelegramInitData();
 if(token)headers.Authorization='Bearer '+token;
 else if(telegram)headers['x-telegram-init-data']=telegram;
 const res=await fetch(url,{...init,headers,cache:'no-store'});
 const payload=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(payload.error||'Server javob bermadi');
 return payload as T;
}
export const AdminSupercupPanel:React.FC=()=>{
 const {showToast}=useAuth();
 const [cupId,setCupId]=useState<string>(cupChoices[0][0]);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [loading,setLoading]=useState(false);
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const refresh=async()=>{
  setLoading(true);setPreview(null);setConfirmed(false);
  try{setPreview(await guardedRequest<Preview>('/api/admin/supercups/'+cupId+'/preview'));}
  catch(err:any){showToast(err.message||'Superkubok ma’lumoti olinmadi','error');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void refresh();},[cupId]);
 const create=async()=>{
  if(!preview||!preview.canCreate||!confirmed||busy)return;
  setBusy(true);
  try{
   await guardedRequest('/api/admin/supercups/'+cupId+'/create',{
    method:'POST',body:JSON.stringify({confirmation:true,previewToken:preview.sourceToken})
   });
   showToast('Superkubok uchrashuvlari yaratildi','success');
   await refresh();
  }catch(err:any){showToast(err.message||'Yaratish rad etildi','error');}
  finally{setBusy(false);}
 };
 return <section className="glass-panel p-4 rounded-2xl space-y-4">
  <header>
   <h3 className="text-base font-black text-white">Milliy Superkuboklar — 1-mavsum</h3>
   <p className="text-xs text-slate-400 mt-1">
    Liga yakuniy jadvali va tasdiqlangan milliy kubok finalidan saralash.
    Hech bir mavjud o‘yin qayta yozilmaydi.
   </p>
  </header>
  <div className="flex flex-wrap gap-2">
   <select value={cupId} onChange={e=>setCupId(e.target.value)}
    className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs">
    {cupChoices.map(([id,name])=><option key={id} value={id}>{name}</option>)}
   </select>
   <button type="button" onClick={()=>void refresh()} disabled={loading||busy}
    className="px-3 py-2 rounded-xl bg-slate-700 text-white text-xs font-bold disabled:opacity-50">
    {loading?'Tekshirilmoqda...':'Qayta tekshirish'}
   </button>
  </div>
  {preview&&<>
   <p className="text-xs text-slate-300">Format: <strong>{preview.size} klub</strong></p>
   {preview.blockReasons.length>0&&<div className="rounded-xl border border-amber-500/40 p-3 text-xs text-amber-200 space-y-1">
    <strong>Hozir yaratib bo‘lmaydi:</strong>
    {preview.blockReasons.map(code=><p key={code}>{labels[code]||code}</p>)}
   </div>}
   <div className="space-y-2">
    {preview.qualifiers.map((q,i)=><div key={q.clubId}
     className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200">
     {i+1}. <strong>{q.clubId}</strong> — {q.reason}
    </div>)}
   </div>
   {preview.canCreate&&<div className="space-y-3">
    <label className="flex gap-2 items-center text-xs text-slate-300">
     <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
     Ishtirokchilar va uchrashuvlarni yaratishni tasdiqlayman
    </label>
    <button type="button" disabled={!confirmed||busy} onClick={()=>void create()}
     className="rounded-xl bg-emerald-700 text-white px-4 py-2 text-xs font-black disabled:opacity-40">
     {busy?'Yaratilmoqda...':'Superkubokni yaratish'}
    </button>
   </div>}
  </>}
 </section>;
};
