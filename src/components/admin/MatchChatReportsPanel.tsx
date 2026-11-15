import React,{useEffect,useState} from 'react';
import {CheckCircle2,Flag,Lock,MessageCircle,RefreshCw,Unlock} from 'lucide-react';
import {matchChatApi} from '../../lib/matchChat';
import type {MatchChatAdminReport,MatchChatAdminRoomSummary,MatchChatAdminRoomDetail} from '../../types/matchChat';

export function MatchChatReportsPanel(){const [rooms,setRooms]=useState<MatchChatAdminRoomSummary[]>([]),[selected,setSelected]=useState<MatchChatAdminRoomDetail|null>(null),[roomLoading,setRoomLoading]=useState(false),[roomError,setRoomError]=useState(''),[filter,setFilter]=useState('');const [reports,setReports]=useState<MatchChatAdminReport[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const load=async()=>{setLoading(true);try{const [list,reports]=await Promise.all([matchChatApi.adminRooms(),matchChatApi.reports()]);setRooms(list);setReports(reports);setError('');}catch(e:any){setError(e.message);}finally{setLoading(false);}};
 const openRoom=async(roomId:string)=>{setRoomLoading(true);setRoomError('');try{setSelected(await matchChatApi.adminRoom(roomId));}catch(e:any){setRoomError(e.message||'Chat ochilmadi.');}finally{setRoomLoading(false);}};useEffect(()=>{void load();},[]);
 const action=async(id:string,run:()=>Promise<any>)=>{setBusy(id);try{await run();await load();}catch(e:any){setError(e.message);}finally{setBusy('');}};
 return <section className="glass-panel p-5 rounded-2xl border-slate-800 space-y-4">
  <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white flex items-center gap-2"><MessageCircle className="w-4 h-4 text-sky-400"/>O‘yin chatlari nazorati</h3><p className="text-[10px] text-slate-500 mt-1">Barcha chatlar hamda shikoyatlar ko‘rinadi.</p></div><button className="px-3 py-2 glass-card rounded-xl text-xs font-bold" onClick={()=>void load()} disabled={loading}><RefreshCw className={`inline w-3.5 h-3.5 mr-1 ${loading?'animate-spin':''}`}/>Yangilash</button></div>
  <div className="space-y-3 rounded-xl border border-white/10 p-3">
   <h4 className="text-xs font-black text-slate-100">Barcha ochilgan o‘yin chatlari</h4>
   <p className="text-[11px] text-slate-400">So‘nggi 50 ta chat. Admin faqat o‘qiydi, foydalanuvchilar bundan xabardor.</p>
   <input type="search" aria-label="Chatni qidirish" placeholder="Klub, o‘yinchi yoki o‘yin ID" value={filter} onChange={e=>setFilter(e.target.value)}
    className="w-full rounded-xl border border-white/10 bg-slate-900 p-2.5 text-xs text-white"/>
   <div className="max-h-72 overflow-y-auto space-y-1.5">
    {rooms.filter(r=>(r.title+' '+r.subtitle+' '+r.participantNames.join(' ')+' '+r.matchId).toLowerCase().includes(filter.toLowerCase())).map(room=>
    <button type="button" key={room.roomId} onClick={()=>void openRoom(room.roomId)}
     className="block w-full text-left rounded-xl border border-white/5 bg-slate-900/70 p-3 hover:border-sky-400/40">
      <b className="block text-xs text-slate-100 truncate">{room.title||room.matchId}</b>
      <span className="text-[10px] text-slate-400">{room.participantNames.join(' ↔ ')} · {room.messageCount} xabar · {room.kind==='uzeflife'?'UZEFLIFE':'Liga'}</span>
    </button>)}
    {!rooms.length&&!loading&&<p className="text-xs text-slate-400">Hozircha ochilgan chat yo‘q.</p>}
   </div>
   {roomError&&<p role="alert" className="text-xs text-rose-300">{roomError}</p>}
   {roomLoading&&<p role="status" className="text-xs text-slate-300">Chat yuklanmoqda…</p>}
   {selected&&<div className="rounded-xl border border-sky-500/20 p-3 space-y-2"><div className="flex items-center justify-between"><b className="text-xs text-sky-200">{selected.title}</b><button type="button" onClick={()=>setSelected(null)} className="text-xs text-slate-400">Yopish</button></div>
    <div className="max-h-80 overflow-y-auto space-y-2 bg-slate-950 rounded-lg p-2">
      {selected.messages.length?selected.messages.map(m=><p key={m.id} className="text-xs text-slate-300 break-words"><strong className="text-sky-300">{m.senderName}:</strong> {m.text}</p>):<p className="text-xs text-slate-500">Hali xabar yo‘q.</p>}
    </div><button type="button" disabled={roomLoading} className="text-xs text-sky-300 underline" onClick={()=>void openRoom(selected.roomId)}>Yangilash</button>
   </div>}
  </div>
  {error&&<p className="text-xs text-rose-300" role="alert">{error}</p>}
  {!loading&&!reports.length&&<div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs text-emerald-300"><CheckCircle2 className="inline w-4 h-4 mr-2"/>Ochiq shikoyat yo‘q.</div>}
  <div className="space-y-3">{reports.map(report=><details key={report.reportId} className="rounded-2xl border border-amber-500/20 bg-slate-950/50 p-4"><summary className="cursor-pointer list-none"><div className="flex items-start gap-3"><Flag className="w-4 h-4 mt-0.5 text-amber-300 shrink-0"/><div className="min-w-0 flex-1"><b className="block text-xs text-white truncate">{report.title}</b><span className="block text-[10px] text-slate-400 mt-1">{report.kind==='uzeflife'?'UZEFLIFE':'EFL liga'} · {new Date(report.createdAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}</span><p className="mt-2 text-xs text-amber-200">{report.reason}</p></div></div></summary><div className="mt-4 space-y-2 border-t border-white/5 pt-3"><p className="text-[10px] text-slate-500">{report.participantNames.join(' ↔ ')}</p><div className="max-h-64 overflow-auto space-y-1.5 rounded-xl bg-slate-950 p-3">{report.messages.map(message=><div key={message.id} className="text-[11px] text-slate-300"><b className="text-sky-300">{message.senderName}:</b> {message.text}<time className="ml-2 text-[9px] text-slate-600">{new Date(message.createdAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}</time></div>)}</div><div className="flex flex-wrap gap-2 pt-2"><button disabled={!!busy} onClick={()=>void action(`block:${report.roomId}`,()=>matchChatApi.adminBlock(report.roomId,!report.blocked))} className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs font-bold">{report.blocked?<Unlock className="inline w-3.5 h-3.5 mr-1"/>:<Lock className="inline w-3.5 h-3.5 mr-1"/>}{report.blocked?'Admin blokini ochish':'Chatni admin bloklashi'}</button><button disabled={!!busy} onClick={()=>void action(`resolve:${report.reportId}`,()=>matchChatApi.resolveReport(report.roomId,report.reportId))} className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-bold"><CheckCircle2 className="inline w-3.5 h-3.5 mr-1"/>Ko‘rib chiqildi</button></div></div></details>)}</div>
 </section>;
}
