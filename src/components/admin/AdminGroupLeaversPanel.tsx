import React,{useEffect,useState} from 'react';
import {RefreshCw,Users,Clock,ShieldCheck} from 'lucide-react';
import {getAuthHeaders} from '../../lib/customTournamentApi';

type ExitClub={seasonId:string;clubId:string;clubName:string};
type ExitOwner={userId:string;name:string;username:string;state:'left'|'kicked';clubs:ExitClub[];
 exitedAt:string;verifiedAt?:string;discoveredBy?:'membership_audit';lastWebAppOpenedAt:string|null};
type Bucket={seasonId:string;label:string;total:number;owners:ExitOwner[]};
type Report={total:number;bySeason:Bucket[];activityNote:string};

function formatTashkent(value:string|null|undefined):string{
 if(!value)return 'Hali qayd etilmagan';
 const date=new Date(value);
 return Number.isNaN(date.getTime())?'Hali qayd etilmagan':
  new Intl.DateTimeFormat('uz-UZ',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
}
export function AdminGroupLeaversPanel(){
 const [report,setReport]=useState<Report|null>(null);
 const [selected,setSelected]=useState('season-2027-28');
 const [error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [search,setSearch]=useState('');
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const response=await fetch('/api/telegram/admin/group-club-owners-left',{
    headers:getAuthHeaders(),cache:'no-store',signal:AbortSignal.timeout(20000)});
   const data=await response.json();
   if(!response.ok||!data.ok)throw new Error(data.error||'Guruhdan chiqqanlar ro‘yxati ochilmadi.');
   setReport(data);
  }catch(e:any){setError(e.message||'Ro‘yxatni yuklab bo‘lmadi.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[]);
 const bucket=report?.bySeason.find(x=>x.seasonId===selected);
 const owners=(bucket?.owners||[]).filter(o=>
  (o.name+' '+o.username+' '+o.clubs.map(c=>c.clubName).join(' ')).toLowerCase().includes(search.toLowerCase()));
 return <section className="glass-panel border border-white/10 p-4 sm:p-5 rounded-2xl space-y-4">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div><h3 className="text-white font-black flex items-center gap-2"><Users size={18} className="text-amber-300"/>Guruhdan chiqqan klub egalari</h3>
    <p className="text-xs text-slate-400 mt-1">Mavsumlar bo‘yicha · faqat asosiy admin ko‘radi · jami {report?.total??'—'} kishi</p></div>
   <button type="button" onClick={()=>void load()} disabled={loading} className="glass-card rounded-xl px-3 py-2 text-xs font-bold text-slate-200">
    <RefreshCw size={15} className={`inline mr-1 ${loading?'animate-spin':''}`}/>Yangilash</button>
  </header>
  {error&&<p role="alert" className="text-xs text-rose-300">{error}</p>}
  {loading&&!report&&<p role="status" className="text-xs text-slate-400">Ro‘yxat yuklanmoqda…</p>}
  <div className="flex flex-wrap gap-2" role="group" aria-label="Guruhdan chiqqanlar mavsumi">
   {(report?.bySeason||[{seasonId:'season-2027-28',label:'2-mavsum',total:0},{seasonId:'season-2026-27',label:'1-mavsum',total:0}]).map(s=>
    <button key={s.seasonId} type="button" onClick={()=>setSelected(s.seasonId)} aria-pressed={selected===s.seasonId}
      className={`px-4 py-2.5 rounded-xl border border-white/10 text-xs font-bold ${selected===s.seasonId?'bg-emerald-600 text-white':'glass-card text-slate-300'}`}>{s.label} ({s.total})</button>)}
  </div>
  <input type="search" aria-label="Klub egasini qidirish" placeholder="Ism, username yoki klub…" value={search} onChange={e=>setSearch(e.target.value)}
    className="w-full bg-slate-950/60 border border-white/10 rounded-xl p-3 text-xs text-white"/>
  <div className="space-y-2">
   {owners.map(o=><article key={o.userId} className="rounded-2xl bg-slate-900/60 border border-white/10 p-3 sm:p-4 space-y-2">
    <div className="flex flex-wrap items-start justify-between gap-2">
     <div className="min-w-0"><b className="text-sm text-white break-words">{o.name}</b>
      {o.username&&<p className="text-xs text-sky-300">@{o.username.replace(/^@/,'')}</p>}</div>
     <span className="text-[11px] text-amber-300">{o.state==='kicked'?'Guruhdan chiqarilgan':'Guruhdan chiqqan'}</span>
    </div>
    <p className="text-xs text-slate-300">{o.clubs.map(c=>c.clubName).join(', ')}</p>
    <p className="text-[11px] text-slate-400 flex items-center gap-1"><Clock size={12}/>Web App oxirgi kirish: <b className="text-slate-200">{formatTashkent(o.lastWebAppOpenedAt)}</b></p>
    <p className="text-[11px] text-slate-500">{o.discoveredBy==='membership_audit'?'A’zolik tekshiruvi':'Chiqish hodisasi'}: {formatTashkent(o.exitedAt)}</p>
   </article>)}
   {!loading&&!owners.length&&<p className="rounded-xl p-4 border border-white/10 text-xs text-slate-400">Ushbu mavsumda mos yozuv topilmadi.</p>}
  </div>
  <p className="text-[11px] text-slate-500 flex gap-2 items-start"><ShieldCheck size={15} className="shrink-0"/>
   Faqat tasdiqlangan Web App autentifikatsiyasi sanasi ko‘rsatiladi; vaqt 30 daqiqada bir qayd qilinadi.
   Oldingi sessiya yozilmagan bo‘lsa, sana noma’lum. Klub ro‘yxati guruhdan chiqish paytidagi mavsumga tegishli;
   klub egaligi avtomatik bekor qilinmaydi.</p>
 </section>;
}
