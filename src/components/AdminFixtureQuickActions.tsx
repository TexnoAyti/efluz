import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeft,CheckCircle2,MessageCircle,ShieldCheck, X} from 'lucide-react';
import type {Fixture} from '../types';
import {ClubCrest} from './ClubCrest';
import {PremiumClubBadge} from './PremiumClubBadge';
import {api} from '../lib/api';
import {openMatchChat} from '../lib/matchChat';
import {getClubOwnerDisplay} from '../lib/ownerUtils';
import {canManageFixture,canUseDangerZone} from '../lib/adminPermissions';
import {useAuth} from '../context/AuthContext';

/** Identical match-center presentation to a player's selected fixture.
 * Authorization for administrative actions remains enforced by server routes.
 */
export function AdminFixtureQuickActions({fixture,onClose,onScoreSaved}:{fixture:Fixture;onClose:()=>void;onScoreSaved:()=>void}){
 const {user}=useAuth();
 const [editing,setEditing]=useState(false);
 const [error,setError]=useState(''),[saving,setSaving]=useState(false),[confirm,setConfirm]=useState(false);
 const [home,setHome]=useState(String(fixture.homeScore??0)),[away,setAway]=useState(String(fixture.awayScore??0));
 useEffect(()=>{setEditing(false);setError('');setConfirm(false);setHome(String(fixture.homeScore??0));setAway(String(fixture.awayScore??0));},[fixture.id]);
 if(!canManageFixture(user,fixture.competitionId))return null;
 const homeOwner=getClubOwnerDisplay(fixture.homeClub,fixture.homeOwner||fixture.homeUser,fixture.homeOwnerId,'Egasi aniqlanmagan');
 const awayOwner=getClubOwnerDisplay(fixture.awayClub,fixture.awayOwner||fixture.awayUser,fixture.awayOwnerId,'Egasi aniqlanmagan');
 const openChat=()=>{
  // Open the real user-facing chat component with a read-only owner transport.
  onClose();
  openMatchChat({kind:'fixture',matchId:fixture.id,
   title:(fixture.homeClub?.name||fixture.homeClubId)+' — '+(fixture.awayClub?.name||fixture.awayClubId),
   adminSpectator:true,
   matchInfo:{
    homeName:fixture.homeClub?.name||fixture.homeClubId,
    awayName:fixture.awayClub?.name||fixture.awayClubId,
    homeLogoUrl:fixture.homeClub?.logoUrl||null,
    awayLogoUrl:fixture.awayClub?.logoUrl||null,
    homeScore:fixture.status==='CONFIRMED'?fixture.homeScore??null:null,
    awayScore:fixture.status==='CONFIRMED'?fixture.awayScore??null:null,
    matchday:fixture.matchday,
    status:fixture.status,
   },
  });
 };
 const submit=async()=>{
  const h=Number(home),a=Number(away);
  if(!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0||h>99||a>99){setError('Hisob 0–99 oralig‘ida butun son bo‘lishi kerak.');return;}
  if(!confirm){setConfirm(true);return;}
  setSaving(true);setError('');
  try{await api.adminEditFixtureResult(fixture.id,{homeScore:h,awayScore:a,status:'CONFIRMED',notes:'Asosiy admin o‘yin kartasidan tasdiqladi'});onScoreSaved();onClose();}
  catch(e:any){setError(e.message||'Natija saqlanmadi.');}finally{setSaving(false);}
 };
 if (typeof document === "undefined") return null;
 return createPortal(<div className="fixed inset-0 z-[99999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
  <section role="dialog" aria-modal="true" aria-label="Uchrashuv markazi" className="glass-panel preview-match-center w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface)] text-[var(--efl-text)] p-4 sm:p-6 shadow-2xl space-y-5">
   <header className="flex items-center justify-between border-b border-white/[0.08] pb-3.5 gap-3">
    <div><span className="text-xs font-black uppercase tracking-wider text-emerald-400">{fixture.competitionName}</span><p className="text-[11px] text-slate-400 mt-1">{fixture.roundName||fixture.matchday+'-tur'}</p></div>
    <button type="button" onClick={onClose} aria-label="Yopish" className="p-2 glass-card rounded-xl text-slate-300"><X size={19}/></button>
   </header>
   <div className="grid grid-cols-7 items-center gap-2 py-3">
    <div className="col-span-3 flex flex-col items-center text-center min-w-0">
     <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-950/80 p-2.5 border border-white/[0.08] flex items-center justify-center mb-2 shadow-inner">
      <ClubCrest clubId={fixture.homeClubId} logoUrl={fixture.homeClub?.logoUrl} name={fixture.homeClub?.name} shortName={fixture.homeClub?.shortName} size="xl" className="w-full h-full"/>
     </div>
     <h4 className="font-black text-xs sm:text-sm text-white truncate w-full">{fixture.homeClub?.name||fixture.homeClubId}</h4>
     <PremiumClubBadge clubId={fixture.homeClubId}/>
     <span className="text-[11px] text-slate-400 mt-1 truncate w-full">{homeOwner.displayText}</span>
    </div>
    <div className="col-span-1 flex flex-col justify-center items-center">
     {fixture.status==='CONFIRMED'
       ?<div className="flex items-center gap-1 px-2 py-1.5 glass-card font-black text-white text-base sm:text-xl"><b>{fixture.homeScore}</b><span className="text-slate-500">:</span><b>{fixture.awayScore}</b></div>
       :<div className="w-9 h-9 rounded-full glass-card flex items-center justify-center text-xs font-black text-slate-400">VS</div>}
    </div>
    <div className="col-span-3 flex flex-col items-center text-center min-w-0">
     <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-950/80 p-2.5 border border-white/[0.08] flex items-center justify-center mb-2 shadow-inner">
      <ClubCrest clubId={fixture.awayClubId} logoUrl={fixture.awayClub?.logoUrl} name={fixture.awayClub?.name} shortName={fixture.awayClub?.shortName} size="xl" className="w-full h-full"/>
     </div>
     <h4 className="font-black text-xs sm:text-sm text-white truncate w-full">{fixture.awayClub?.name||fixture.awayClubId}</h4>
     <PremiumClubBadge clubId={fixture.awayClubId}/>
     <span className="text-[11px] text-slate-400 mt-1 truncate w-full">{awayOwner.displayText}</span>
    </div>
   </div>
   <div className="glass-card p-3 rounded-xl flex flex-wrap gap-2 justify-between items-center text-xs">
    <span className="text-[var(--efl-text-2)]">{fixture.status==='CONFIRMED'?'Natija tasdiqlangan':fixture.status==='PENDING_CONFIRMATION'?'Raqib tasdig‘i kutilmoqda':fixture.status==='DISPUTED'?'Hisob bo‘yicha nizo':'Uchrashuv rejalashtirilgan'}</span>
    <span className="text-[var(--efl-primary)] inline-flex items-center gap-1"><ShieldCheck size={13}/> {canUseDangerZone(user)?'Admin kuzatuvi':'Liga nazorati'}</span>
   </div>
   {editing?<div className="space-y-4">
    <button type="button" onClick={()=>{setEditing(false);setConfirm(false);setError('');}} className="text-xs font-bold text-slate-400 flex gap-1 items-center"><ArrowLeft size={15}/> Uchrashuvga qaytish</button>
    <p className="text-xs text-amber-300">Hisobni tasdiqlash jadvalni o‘zgartiradi. O‘yinchilar natijasi bilan solishtirib tekshiring.</p>
    <div className="grid grid-cols-2 gap-3">
     <label className="text-xs text-slate-300">Uy jamoasi<input aria-label="Uy jamoasi hisobi" type="number" min="0" max="99" value={home} onChange={e=>{setHome(e.target.value);setConfirm(false);}} className="mt-2 w-full rounded-xl bg-slate-900 border border-white/15 p-3 text-xl font-bold text-white"/></label>
     <label className="text-xs text-slate-300">Mehmon jamoa<input aria-label="Mehmon jamoa hisobi" type="number" min="0" max="99" value={away} onChange={e=>{setAway(e.target.value);setConfirm(false);}} className="mt-2 w-full rounded-xl bg-slate-900 border border-white/15 p-3 text-xl font-bold text-white"/></label>
    </div>
    {confirm&&<p className="text-xs text-amber-200" role="status">Natija: {home}:{away}. Buni rasmiy tasdiqlangan hisob sifatida saqlaysizmi?</p>}
    <button type="button" disabled={saving} onClick={()=>void submit()} className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-black disabled:opacity-50">{saving?'Saqlanmoqda…':confirm?'Tasdiqlab saqlash':'Hisobni tekshirish'}</button>
   </div>:<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    {canUseDangerZone(user)&&<button type="button" onClick={openChat} className="w-full px-4 py-3.5 rounded-xl glass-card border border-sky-500/30 text-[var(--efl-primary)] font-bold flex gap-2 justify-center items-center">
     <MessageCircle size={19}/> Uchrashuv chati
    </button>}
    <button type="button" onClick={()=>{setEditing(true);setError('');}} className="w-full px-4 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex gap-2 justify-center items-center">
     <CheckCircle2 size={19}/> Hisob kiritish
    </button>
   </div>}
   {error&&<p role="alert" className="text-rose-300 text-xs">{error}</p>}
  </section>
 </div>, document.body);
}
