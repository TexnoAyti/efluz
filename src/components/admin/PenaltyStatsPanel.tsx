import React,{useEffect,useState} from 'react';
import {RefreshCw,Trophy,Target,Shield} from 'lucide-react';
import {getAuthHeaders} from '../../lib/customTournamentApi';
type Player={userId:string;goals:number;shots:number;fixtures:number};
type Match={fixtureId:string;updatedAt:string;homeUserId:string;awayUserId:string;homeGoals:number;awayGoals:number;homeShots:number;awayShots:number};
type Statistics={sampledRaces:number;capped:boolean;totalGoals:number;totalShots:number;players:Player[];matches:Match[];official:false};
export function PenaltyStatsPanel(){
 const [stats,setStats]=useState<Statistics|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const load=async()=>{setLoading(true);setError('');try{
  const res=await fetch('/api/penalty-race/admin/stats',{headers:getAuthHeaders(),signal:AbortSignal.timeout(20000)});
  const data=await res.json();if(!res.ok||!data.ok)throw new Error(data.error||'Statistikani yuklab bo‘lmadi.');
  setStats(data.stats);
 }catch(e:any){setError(e.message||'Statistika yuklanmadi.');}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 return <section className="glass-panel p-4 sm:p-6 rounded-2xl space-y-4">
  <header className="flex items-center justify-between gap-3"><div><h3 className="font-black text-white flex items-center gap-2"><Target size={18}/> Penalti statistikasi</h3>
   <p className="text-xs text-slate-400 mt-1"><Shield size={12} className="inline mr-1"/>Sinov rejimi: faqat asosiy admin ko‘radi. Keyinchalik umumiy reyting sifatida ochiladi.</p></div>
   <button type="button" disabled={loading} onClick={()=>void load()} className="text-xs px-3 py-2 glass-card rounded-xl"><RefreshCw size={14} className="inline mr-1"/>Yangilash</button></header>
  {error&&<p role="alert" className="text-rose-300 text-xs">{error}</p>}
  {loading&&!stats&&<p role="status" className="text-sm text-slate-400">Statistika yuklanmoqda…</p>}
  {stats&&<><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
   {([['O‘yinlar',stats.sampledRaces],['Gollar',stats.totalGoals],['Tepishlar',stats.totalShots],['O‘yinchilar',stats.players.length]] as const).map(([name,value])=><div key={name} className="rounded-xl border border-white/10 p-3 bg-white/[0.03]"><p className="text-xs text-slate-400">{name}</p><p className="text-xl font-black text-white">{value}</p></div>)}</div>
   {stats.capped&&<p className="text-xs text-amber-300">Dastlabki 120 ta saqlangan o‘yin hisoblangan. To‘liq global statistikaga o‘tishda sahifalash qo‘shiladi.</p>}
   <p className="text-xs text-slate-400">Bu ko‘rsatkichlar penalti mini-o‘yinining eksperimental statistikasi. Rasmiy liga natijalariga qo‘shilmaydi.</p>
   <div className="space-y-2"><h4 className="font-bold text-sm text-white flex gap-1 items-center"><Trophy size={15}/> TOP o‘yinchilar</h4>
    {!stats.players.length?<p className="text-xs text-slate-400">Hali serverda penalti natijasi saqlanmagan.</p>:stats.players.map((p,i)=><div key={p.userId} className="flex justify-between gap-2 text-xs p-3 rounded-xl bg-slate-900/70 border border-white/5"><span className="truncate">{i+1}. {p.userId}</span><b className="text-emerald-300 shrink-0">{p.goals} gol · {p.shots} tepish · {p.fixtures} o‘yin</b></div>)}</div>
   <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-sm font-bold text-white">So‘nggi o‘yinlar ({stats.matches.length})</summary>
    <div className="space-y-2 mt-3">{stats.matches.map(m=><div key={m.fixtureId} className="text-xs rounded-lg bg-slate-900/70 p-2"><p className="font-semibold text-slate-300 break-all">{m.fixtureId}</p><p>{m.homeUserId} {m.homeGoals}:{m.awayGoals} {m.awayUserId} · {m.homeShots}+{m.awayShots} tepish</p></div>)}</div></details>
  </>}
 </section>;
}
