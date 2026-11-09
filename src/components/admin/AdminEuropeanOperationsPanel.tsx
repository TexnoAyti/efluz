import React,{useEffect,useState} from 'react';
import {api,getSessionToken,getTelegramInitData} from '../../lib/api';
import {useAuth} from '../../context/AuthContext';

const cups=[
 ['comp-champions-league-2026','UEFA Champions League'],
 ['comp-europa-league-2026','UEFA Europa League'],
] as const;
type Overview={
 competitionId:string;name:string;phase:string;sourceToken:string;
 domesticLeaguesCompleted:boolean;qualificationFinal:boolean;drawPublished:boolean;
 participants:number;fixtures:number;confirmed:number;currentMatchday:number;
 canGenerateDraw:boolean;canGenerateKnockout:boolean;blockReasons:string[];
 rounds:Array<{matchday:number;count:number;confirmed:number;incomplete:number}>;
};
type Control={
 currentMatchday:number;updatedAt:string|null;totalMatchdays:number;
 rounds:Array<{matchday:number;fixtureCount:number;unfinished:Array<{id:string;status:string}>}>;
};
const messages:Record<string,string>={
 DOMESTIC_LEAGUES_INCOMPLETE:'Ichki ligalar yakunlanmagan',
 FINAL_QUALIFICATION_REQUIRED:'Yakuniy Yevropa saralashi tasdiqlanmagan',
 EXPECTED_32_UNIQUE_PARTICIPANTS:'32 ta noyob ishtirokchi talab qilinadi',
 DRAW_ALREADY_PUBLISHED:'Qur’a allaqachon e’lon qilingan',
 UNPUBLISHED_FIXTURES_REQUIRE_REVIEW:'Oldingi tugallanmagan qur’ani tekshirish kerak',
};
async function adminCall<T>(path:string,init:RequestInit={}):Promise<T>{
 const headers:Record<string,string>={'Content-Type':'application/json'};
 const token=getSessionToken(),tg=getTelegramInitData();
 if(token)headers.Authorization='Bearer '+token;
 else if(tg)headers['x-telegram-init-data']=tg;
 const response=await fetch(path,{...init,headers,cache:'no-store'});
 const value=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(value.error||'Server javob bermadi');
 return value as T;
}
/** Real stage actions. No automatic force-regeneration of an existing draw. */
export const AdminEuropeanOperationsPanel:React.FC=()=>{
 const {showToast}=useAuth();
 const [id,setId]=useState<string>(cups[0][0]);
 const [overview,setOverview]=useState<Overview|null>(null);
 const [control,setControl]=useState<Control|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [confirmation,setConfirmation]=useState(false);
 const [duration,setDuration]=useState(30);
 async function load(){
  setLoading(true);setOverview(null);setControl(null);setConfirmation(false);
  try{
   const data=await adminCall<Overview>('/api/admin/season-one/european/'+id+'/overview');
   setOverview(data);
   if(data.drawPublished)setControl(await api.getMatchdayControl(id));
  }catch(e:any){showToast(e.message||'Yevrokubok holati olinmadi','error');}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[id]);
 async function createDraw(){
  if(!overview?.canGenerateDraw||!confirmation||busy)return;
  setBusy(true);
  try{
   await adminCall('/api/admin/season-one/european/'+id+'/draw',{
    method:'POST',body:JSON.stringify({confirmation:true,previewToken:overview.sourceToken})
   });
   showToast('Yevrokubok qur’asi yaratildi va tekshirildi','success');
   await load();
  }catch(e:any){showToast(e.message||'Qur’a yaratilmadi','error');}
  finally{setBusy(false);}
 }
 async function createKnockout(){
  if(!overview?.canGenerateKnockout||!confirmation||busy)return;
  setBusy(true);
  try{
   await adminCall('/api/admin/season-one/european/'+id+'/knockout',{
    method:'POST',body:JSON.stringify({confirmation:true,previewToken:overview.sourceToken})
   });
   showToast('Yevrokubok pley-off bosqichi yaratildi','success');
   await load();
  }catch(e:any){showToast(e.message||'Pley-off yaratilmadi','error');}
  finally{setBusy(false);}
 }
 async function nextRound(){
  if(!overview?.drawPublished||!control||!confirmation||busy)return;
  setBusy(true);
  try{
   await adminCall('/api/admin/season-one/european/'+id+'/next-round',{
    method:'POST',body:JSON.stringify({
     nextMatchday:control.currentMatchday+1,
     expectedUpdatedAt:control.updatedAt,durationHours:duration
    })
   });
   showToast('Navbatdagi tur ochildi','success');
   await load();
  }catch(e:any){showToast(e.message||'Keyingi tur ochilmadi','error');}
  finally{setBusy(false);}
 }
 const next=control?.rounds.find(row=>row.matchday===control.currentMatchday+1);
 const now=control?.rounds.find(row=>row.matchday===control.currentMatchday);
 const nextAllowed=!!next?.fixtureCount &&
  (control!.currentMatchday<9||now?.unfinished.length===0);
 return <section className="glass-panel p-4 rounded-2xl space-y-4">
  <header>
   <h3 className="text-base font-black text-white">1-mavsum Yevrokuboklarini boshqarish</h3>
   <p className="text-xs text-slate-400 mt-1">
    Final saralash → xavfsiz qur’a → liga bosqichi → pley-off → final.
    Faqat 2026/27 mavsumiga tegishli.
   </p>
  </header>
  <div className="flex flex-wrap gap-2">
   <select value={id} onChange={e=>setId(e.target.value)}
    className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs">
    {cups.map(([key,name])=><option key={key} value={key}>{name}</option>)}
   </select>
   <button type="button" onClick={()=>void load()} disabled={loading||busy}
    className="px-3 py-2 rounded-xl bg-slate-700 text-white text-xs disabled:opacity-40">
    {loading?'Tekshirilmoqda...':'Yangilash'}
   </button>
  </div>
  {overview&&<div className="space-y-3">
   <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
    {[
     ['Bosqich',overview.phase],['Ishtirokchilar',String(overview.participants)+'/32'],
     ['O‘yinlar',String(overview.fixtures)],['Tasdiqlangan',String(overview.confirmed)]
    ].map(([label,value])=><div key={label}
      className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-xs text-white font-black mt-1">{value}</div>
    </div>)}
   </div>
   {overview.blockReasons.length>0&&<div className="border border-amber-500/30 p-3 rounded-xl text-xs text-amber-200">
    {overview.blockReasons.map(code=><div key={code}>{messages[code]||code}</div>)}
   </div>}
   {overview.rounds.length>0&&<div className="max-h-44 overflow-y-auto space-y-1">
    {overview.rounds.map(r=><div key={r.matchday}
      className="flex justify-between gap-2 text-xs px-2 py-1.5 border-b border-slate-800 text-slate-200">
      <span>{r.matchday}-tur</span><span>{r.confirmed}/{r.count} tasdiqlangan</span>
    </div>)}
   </div>}
   {(overview.canGenerateDraw||overview.canGenerateKnockout||nextAllowed)&&<label
    className="flex items-start gap-2 text-xs text-slate-300">
    <input type="checkbox" checked={confirmation} onChange={e=>setConfirmation(e.target.checked)}/>
    Ma’lumotlarni tekshirdim, musobaqani boshqarish amalini tasdiqlayman
   </label>}
   {overview.canGenerateDraw&&<button type="button" onClick={()=>void createDraw()}
     disabled={!confirmation||busy}
     className="bg-blue-700 text-white text-xs font-bold rounded-xl px-4 py-2 disabled:opacity-40">
     {busy?'Yaratilmoqda...':'32 klub uchun qur’ani yaratish'}
   </button>}
   {overview.canGenerateKnockout&&<button type="button" onClick={()=>void createKnockout()}
     disabled={!confirmation||busy}
     className="bg-amber-700 text-white text-xs font-bold rounded-xl px-4 py-2 disabled:opacity-40">
     {busy?'Yaratilmoqda...':'128 ta natijadan pley-off qur’asini yaratish'}
   </button>}
   {overview.drawPublished&&control&&<div className="space-y-2">
    <p className="text-xs text-slate-300">
     Joriy tur: {control.currentMatchday} / {control.totalMatchdays}
    </p>
    {nextAllowed&&<>
     <label className="text-xs text-slate-400 flex items-center gap-2">
      Tur muddati (soat)
      <input type="number" min={1} max={720} value={duration}
       onChange={e=>setDuration(Number(e.target.value))}
       className="w-20 bg-slate-900 border border-slate-700 text-white rounded-lg p-1.5"/>
     </label>
     <button type="button" disabled={!confirmation||busy||!Number.isFinite(duration)||duration<1||duration>720}
      onClick={()=>void nextRound()}
      className="rounded-xl px-4 py-2 text-xs font-black bg-emerald-700 text-white disabled:opacity-40">
      {busy?'Ochilmoqda...':'Navbatdagi turni ochish'}
     </button>
    </>}
    {!nextAllowed&&<p className="text-xs text-slate-400">
     Keyingi tur hali tayyor emas yoki bu so‘nggi tur.
    </p>}
   </div>}
  </div>}
 </section>;
};
