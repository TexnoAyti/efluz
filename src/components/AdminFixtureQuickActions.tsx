import React,{useEffect,useState} from 'react';
import {X,MessageCircle,CheckCircle2,Loader2,ShieldCheck} from 'lucide-react';
import type {Fixture} from '../types';
import type {MatchChatAdminRoomDetail} from '../types/matchChat';
import {api} from '../lib/api';
import {matchChatApi} from '../lib/matchChat';

export function AdminFixtureQuickActions({fixture,onClose,onScoreSaved}:{fixture:Fixture;onClose:()=>void;onScoreSaved:()=>void}){
 const [view,setView]=useState<'choose'|'chat'|'score'>('choose');
 const [room,setRoom]=useState<MatchChatAdminRoomDetail|null>(null),[loading,setLoading]=useState(false);
 const [error,setError]=useState(''),[saving,setSaving]=useState(false),[confirm,setConfirm]=useState(false);
 const [home,setHome]=useState(String(fixture.homeScore??0)),[away,setAway]=useState(String(fixture.awayScore??0));
 useEffect(()=>{setView('choose');setRoom(null);setError('');setConfirm(false);setHome(String(fixture.homeScore??0));setAway(String(fixture.awayScore??0));},[fixture.id]);
 const openChat=async()=>{setView('chat');setLoading(true);setError('');try{setRoom(await matchChatApi.adminFixtureRoom('fixture',fixture.id));}catch(e:any){setError(e.message||'Chatni o‘qib bo‘lmadi.');}finally{setLoading(false);}};
 const submit=async()=>{const h=Number(home),a=Number(away);
  if(!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0||h>99||a>99){setError('Hisob 0–99 oralig‘ida butun son bo‘lishi kerak.');return;}
  if(!confirm){setConfirm(true);return;}
  setSaving(true);setError('');try{await api.adminEditFixtureResult(fixture.id,{homeScore:h,awayScore:a,status:'CONFIRMED',notes:'Asosiy admin o‘yin kartasidan tasdiqladi'});onScoreSaved();onClose();}catch(e:any){setError(e.message||'Natija saqlanmadi.');}finally{setSaving(false);}
 };
 return <div role="presentation" className="fixed inset-0 z-[1000] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section role="dialog" aria-modal="true" aria-label="O‘yin boshqaruvi" className="w-full max-w-lg rounded-2xl border border-white/15 bg-slate-950 text-slate-100 p-4 sm:p-5 shadow-2xl max-h-[88vh] overflow-y-auto">
   <header className="flex items-start justify-between gap-3 mb-4"><div><h3 className="text-sm font-black">{fixture.homeClub?.name||fixture.homeClubId} — {fixture.awayClub?.name||fixture.awayClubId}</h3><p className="text-xs text-slate-400 mt-1">{fixture.competitionName} · {fixture.roundName||fixture.matchday+'-tur'}</p></div><button className="p-2 rounded-xl glass-card" onClick={onClose} aria-label="Yopish"><X size={18}/></button></header>
   {view==='choose'&&<div className="grid grid-cols-2 gap-3">
    <button className="rounded-xl p-4 border border-sky-400/30 bg-sky-500/10 text-sm font-bold flex flex-col items-center gap-2" onClick={()=>void openChat()}><MessageCircle size={20}/> Chatni ko‘rish</button>
    <button className="rounded-xl p-4 border border-emerald-400/30 bg-emerald-500/10 text-sm font-bold flex flex-col items-center gap-2" onClick={()=>{setView('score');setError('');}}><CheckCircle2 size={20}/> Hisob kiritish</button>
   </div>}
   {view==='chat'&&<div className="space-y-3">
    <div className="flex items-center justify-between"><span className="text-xs text-sky-300 font-semibold flex items-center gap-1"><ShieldCheck size={14}/> Adminning faqat o‘qish rejimi</span><button className="text-xs text-slate-300 underline" onClick={()=>setView('choose')}>Orqaga</button></div>
    {loading?<div className="flex justify-center p-6"><Loader2 className="animate-spin"/></div>:room?<><p className="text-xs text-slate-400">{room.participants.map(p=>p.name).join(' ↔ ')}</p><div className="max-h-80 overflow-y-auto rounded-xl bg-black/30 p-3 space-y-2">{room.messages.length?room.messages.map(m=><div key={m.id} className="text-xs"><b className="text-sky-300">{m.senderName}</b><time className="text-[10px] text-slate-500 ml-2">{new Date(m.createdAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}</time><p className="whitespace-pre-wrap break-words mt-0.5">{m.text}</p></div>):<p className="text-xs text-slate-400">Hali xabar yozilmagan.</p>}</div></>:!error&&<p className="text-xs text-slate-400">Bu o‘yin uchun chat hali ochilmagan.</p>}
   </div>}
   {view==='score'&&<div className="space-y-4"><div className="flex justify-between"><span className="text-xs text-amber-300">Asosiy admin · natija tahriri</span><button className="text-xs underline" onClick={()=>{setView('choose');setConfirm(false);}}>Orqaga</button></div>
    <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-300">Uy jamoasi<input aria-label="Uy jamoasi hisobi" type="number" min="0" max="99" value={home} onChange={e=>{setHome(e.target.value);setConfirm(false);}} className="mt-2 w-full rounded-xl bg-slate-900 border border-white/15 p-3 text-xl font-bold text-white"/></label><label className="text-xs text-slate-300">Mehmon jamoa<input aria-label="Mehmon jamoa hisobi" type="number" min="0" max="99" value={away} onChange={e=>{setAway(e.target.value);setConfirm(false);}} className="mt-2 w-full rounded-xl bg-slate-900 border border-white/15 p-3 text-xl font-bold text-white"/></label></div>
    {confirm&&<p className="text-xs text-amber-200">Siz {home}:{away} natijani CONFIRMED sifatida saqlamoqchisiz. Bu jadvalni o‘zgartiradi. Tasdiqlang.</p>}
    <button disabled={saving} className="w-full rounded-xl p-3 bg-emerald-600 text-white font-black text-sm disabled:opacity-60" onClick={()=>void submit()}>{saving?'Saqlanmoqda…':confirm?'Tasdiqlab saqlash':'Hisobni tekshirish'}</button>
   </div>}
   {error&&<p className="text-rose-300 text-xs mt-3" role="alert">{error}</p>}
  </section>
 </div>;
}
