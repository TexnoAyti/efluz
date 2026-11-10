import React,{useEffect,useState} from 'react';
import {api,getSessionToken,getTelegramInitData} from '../../lib/api';
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
 availableClubs:Array<{id:string;name:string}>;
};
type SupercupRoundControl={
 currentMatchday:number;updatedAt:string|null;totalMatchdays:number;
 rounds:Array<{matchday:number;isOpen:boolean;fixtureCount:number;unfinished:Array<{id:string;status:string}>}>;
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
 const [chosen,setChosen]=useState<string[]>([]);
 const [roundControl,setRoundControl]=useState<SupercupRoundControl|null>(null);
 const [roundHours,setRoundHours]=useState(30);
 const refresh=async()=>{
  setLoading(true);setPreview(null);setChosen([]);setConfirmed(false);setRoundControl(null);
  try{
   const data=await guardedRequest<Preview>('/api/admin/supercups/'+cupId+'/preview');
   setPreview(data);setChosen(Array(data.size).fill(''));
   if(data.blockReasons.includes('SUPERCUP_ALREADY_GENERATED')){
    try { setRoundControl(await api.getMatchdayControl(cupId) as SupercupRoundControl); }
    catch(err:any) { showToast(err.message||'Yaratilgan Superkubok turini yuklab bo‘lmadi','error'); }
   }
  }catch(err:any){showToast(err.message||'Superkubok ma’lumoti olinmadi','error');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void refresh();},[cupId]);
 const create=async()=>{
  if(!preview||!preview.canCreate||!confirmed||busy||chosen.length!==preview.size||chosen.some(id=>!id)||new Set(chosen).size!==chosen.length)return;
  setBusy(true);
  try{
   await guardedRequest('/api/admin/supercups/'+cupId+'/create',{
    method:'POST',body:JSON.stringify({confirmation:true,previewToken:preview.sourceToken,selectedClubIds:chosen})
   });
   showToast('Superkubok uchrashuvlari yaratildi','success');
   await refresh();
  }catch(err:any){showToast(err.message||'Yaratish rad etildi','error');}
  finally{setBusy(false);}
 };
 const startExistingSupercupRound=async(action:'OPEN'|'NEXT')=>{
  if(!roundControl||!confirmed||busy)return;
  const current=roundControl.rounds.find(r=>r.matchday===roundControl.currentMatchday);
  if(action==='OPEN' && (!current?.fixtureCount||current.isOpen))return;
  if(action==='NEXT' && (roundControl.currentMatchday>=roundControl.totalMatchdays||
       current?.unfinished.length!==0))return;
  if(!Number.isFinite(roundHours)||roundHours<1||roundHours>720)return;
  setBusy(true);
  try{
   await guardedRequest('/api/admin/supercups/'+cupId+'/round',{
    method:'POST',body:JSON.stringify({action,expectedUpdatedAt:roundControl.updatedAt,durationHours:roundHours})
   });
   showToast('Superkubok turi ochildi','success');
   await refresh();
  }catch(err:any){showToast(err.message||'Superkubok turi ochilmadi','error');}
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
    <strong>{preview.blockReasons.includes('SUPERCUP_ALREADY_GENERATED') ? 'Uchrashuvlar avval yaratilgan — quyidagi boshqaruvdan foydalaning:' : 'Hozir yaratib bo‘lmaydi:'}</strong>
    {preview.blockReasons.map(code=><p key={code}>{labels[code]||code}{code==='SUPERCUP_PARTICIPANTS_ALREADY_REGISTERED' ? ' — eski ishtirokchilar bor, o‘yinlarni yaratishdan oldin ro‘yxatni tekshirish zarur.' : ''}</p>)}
   </div>}
   {preview.canCreate&&<div className="space-y-2">
    <p className="text-xs text-slate-300">Ishtirokchilarni tartib bilan tanlang. {preview.size===2?'Ikki klub bir final o‘ynaydi.':'1–4 va 2–3 yarim finalda uchrashadi.'}</p>
    {chosen.map((id,i)=><label key={i} className="flex items-center gap-3 text-xs text-slate-200">
     <span className="w-16">{i+1}-klub</span>
     <select value={id} onChange={e=>{setChosen(old=>old.map((v,j)=>j===i?e.target.value:v));setConfirmed(false);}}
      className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white">
      <option value="">Klubni tanlang</option>
      {preview.availableClubs.map(club=><option key={club.id} value={club.id}>{club.name}</option>)}
     </select>
    </label>)}
    {chosen.filter(Boolean).length!==new Set(chosen.filter(Boolean)).size&&<p className="text-amber-300 text-xs">Bir klub ikki marta qatnasha olmaydi.</p>}
   </div>}
   {preview.canCreate&&<div className="space-y-3">
    <label className="flex gap-2 items-center text-xs text-slate-300">
     <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
     Ishtirokchilar va uchrashuvlarni yaratishni tasdiqlayman
    </label>
    <button type="button" disabled={!confirmed||busy||chosen.some(id=>!id)||new Set(chosen).size!==chosen.length} onClick={()=>void create()}
     className="rounded-xl bg-emerald-700 text-white px-4 py-2 text-xs font-black disabled:opacity-40">
     {busy?'Yaratilmoqda...':'Superkubokni yaratish'}
    </button>
   </div>}
  </>}
  {roundControl&&<div className="rounded-xl border border-emerald-700/50 p-3 space-y-3">
   <p className="text-sm font-bold text-white">Yaratilgan Superkubok o‘yinlarini boshlash</p>
   <p className="text-xs text-slate-300">Joriy tur: {roundControl.currentMatchday} / {roundControl.totalMatchdays}</p>
   <p className="text-xs text-slate-400">Holat: {roundControl.rounds.find(r=>r.matchday===roundControl.currentMatchday)?.isOpen?'Ochiq':'Yopiq'}</p>
   <label className="text-xs text-slate-300 flex gap-2 items-center">Tur muddati (soat)
    <input type="number" min={1} max={720} value={roundHours}
     onChange={e=>setRoundHours(Number(e.target.value))}
     className="w-20 bg-slate-900 text-white rounded p-1.5" />
   </label>
   <label className="text-xs text-slate-300 flex gap-2 items-center">
    <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />
    Joriy uchrashuvlarni boshlashni tasdiqlayman
   </label>
   <div className="flex gap-2 flex-wrap">
    <button type="button" disabled={busy||!confirmed||
       !roundControl.rounds.find(r=>r.matchday===roundControl.currentMatchday)?.fixtureCount||
       !!roundControl.rounds.find(r=>r.matchday===roundControl.currentMatchday)?.isOpen}
     onClick={()=>void startExistingSupercupRound('OPEN')}
     className="bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-xs font-bold">
     Joriy turni ochish
    </button>
    {roundControl.currentMatchday<roundControl.totalMatchdays&&<button type="button"
     disabled={busy||!confirmed||!!roundControl.rounds.find(r=>r.matchday===roundControl.currentMatchday)?.unfinished.length}
     onClick={()=>void startExistingSupercupRound('NEXT')}
     className="bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-xs font-bold">
     Finalga o‘tish
    </button>}
   </div>
  </div>}
 </section>;
};
