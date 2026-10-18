import React, { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError } from '../../lib/api';
import { fromTashkentInput, toTashkentInput } from '../../lib/fixtureScheduling';
import { clubStadium } from '../../constants/clubStadiums';
import type { Competition, Fixture } from '../../types';

type Preview = Awaited<ReturnType<typeof api.previewFixtureSchedule>>;
export function AdminFixtureSchedule({ fixture, competitionId: initialCompetitionId, competitions = [], onSaved }: {
  fixture?:Fixture;competitionId?:string;competitions?:Competition[];onSaved?:(scheduledAt:string)=>void;
}) {
  const { activeSeasonId }=useAuth();
  const [expanded,setExpanded]=useState(false);
  const [category,setCategory]=useState('ALL');
  const [competitionId,setCompetitionId]=useState(initialCompetitionId || '');
  const [matchday,setMatchday]=useState('');
  const [includeCompleted,setIncludeCompleted]=useState(false);
  const [datetime,setDatetime]=useState(toTashkentInput(fixture?.scheduledAt));
  const [venue,setVenue]=useState(fixture?.venue || '');
  const [draftTouched,setDraftTouched]=useState(false);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const selector=useMemo(()=>({seasonId:fixture?.seasonId || activeSeasonId,...(fixture ? {fixtureId:fixture.id,includeCompleted:true} : {category,includeCompleted,...(competitionId?{competitionId}:{}),...(matchday?{matchday:Number(matchday)}:{})})}),[fixture?.id,fixture?.seasonId,activeSeasonId,category,competitionId,matchday,includeCompleted]);
  const clearPreview=()=>{setPreview(null);setMessage('');setError('');};
  const inspect=async()=>{
    setBusy(true);setError('');setMessage('');
    try { const result=await api.previewFixtureSchedule(selector);setPreview(result);if(fixture && result.fixtures[0] && !draftTouched){setDatetime(toTashkentInput(result.fixtures[0].scheduledAt));setVenue(result.fixtures[0].venue || '');} }
    catch(e){setError(e instanceof Error?e.message:'O‘yinlarni yuklab bo‘lmadi.');}
    finally{setBusy(false);}
  };
  const save=async()=>{
    if(!preview?.count)return;
    setBusy(true);setError('');setMessage('');
    try {
      const scheduledAt=fromTashkentInput(datetime);
      const result=await api.updateFixtureSchedule({...selector,scheduledAt,expected:preview.expected,...(fixture?{venue:venue.trim() || null}:{})});
      setMessage(`${result.updated} ta o‘yin vaqti ${scheduledAt?'yangilandi':'olib tashlandi'}.`);setPreview(null);onSaved?.(result.scheduledAt);
    } catch(e){
      const apiError=e instanceof ApiError?e:null;
      setError(apiError?.data?.partial?`${apiError.data.updated} ta o‘yin saqlandi. Qolganlari o‘zgarmadi. Ro‘yxatni qayta tekshiring.`:apiError?.data?.error==='SCHEDULE_PREVIEW_CHANGED'?'O‘yinlar o‘zgargan. Ro‘yxatni qayta tekshiring.':e instanceof Error?e.message:'Saqlab bo‘lmadi.');
      setPreview(null);
    } finally{setBusy(false);}
  };
  const input='w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white';
  return <section className="rounded-2xl border border-blue-400/20 bg-slate-900/70 p-4 space-y-3">
    <button type="button" className="text-xs font-black text-blue-200" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>O‘yin vaqtini {fixture?'tahrirlash':'guruh bo‘yicha belgilash'}</button>
    {expanded && <div className="space-y-3">
      <p className="text-xs text-slate-400">Toshkent vaqti (UTC+5). Hisoblar va natijalar o‘zgarmaydi.</p>
      {!fixture && <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-300">Kategoriya<select className={input} value={category} disabled={busy} onChange={e=>{setCategory(e.target.value);setCompetitionId('');clearPreview();}}>{[['ALL','Barchasi'],['LEAGUE','Ligalar'],['KNOCKOUT','Kuboklar'],['SUPER_CUP','Superkuboklar'],['EUROPEAN','Yevropa musobaqalari']].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs text-slate-300">Musobaqa<select className={input} value={competitionId} disabled={busy || !!initialCompetitionId} onChange={e=>{setCompetitionId(e.target.value);clearPreview();}}><option value="">Tanlangan kategoriyadagi barchasi</option>{competitions.filter(c=>category==='ALL'||(category==='EUROPEAN'?c.type.startsWith('EUROPEAN'):c.type===category)).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}{initialCompetitionId&&!competitions.some(c=>c.id===initialCompetitionId)&&<option value={initialCompetitionId}>{initialCompetitionId}</option>}</select></label>
        <label className="text-xs text-slate-300">Tur / bosqich raqami<input className={input} type="number" min={1} max={100} placeholder="Barcha turlar" value={matchday} disabled={busy} onChange={e=>{setMatchday(e.target.value);clearPreview();}} /></label>
      </div>}
      {!fixture && <label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={includeCompleted} disabled={busy} onChange={e=>{setIncludeCompleted(e.target.checked);clearPreview();}} />Yakunlangan va bekor qilingan o‘yinlar ham</label>}
      <label className="block text-xs text-slate-300">Sana va boshlanish vaqti<input aria-label="O‘yin boshlanish vaqti (Toshkent)" className={input} type="datetime-local" value={datetime} disabled={busy} onChange={e=>{setDatetime(e.target.value);setDraftTouched(true);}} /></label>
      <p className="text-[11px] text-slate-400">Vaqtni bo‘sh qoldirib saqlasangiz, sana va vaqt olib tashlanadi.</p>
      {fixture && <label className="block text-xs text-slate-300">Stadion<input aria-label="Uchrashuv stadioni" className={input} maxLength={150} value={venue} placeholder={clubStadium(fixture.homeClubId,fixture.homeClub?.stadium)||'Mezbon klub stadioni'} disabled={busy} onChange={e=>{setVenue(e.target.value);setDraftTouched(true);}} /><span className="text-[11px] text-slate-400">Bo‘sh qoldirilsa mezbon klubning stadioni ishlatiladi.</span></label>}
      <button type="button" disabled={busy} onClick={inspect} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{busy?'Kutilmoqda…':'O‘yinlar ro‘yxatini tekshirish'}</button>
      {preview && <div className="space-y-2 text-xs text-slate-300"><p><b>{preview.count}</b> ta o‘yin tanlandi. {datetime?`Yangi vaqt: ${datetime.replace('T',' ')} (Toshkent)`:'Sana va vaqt olib tashlanadi.'}</p><ul className="max-h-52 overflow-y-auto space-y-1">{preview.fixtures.map(f=><li key={f.id}>{f.competitionName} · {f.roundName||`${f.matchday}-tur`} · {f.homeClub?.name||'TBD'} — {f.awayClub?.name||'TBD'} · {toTashkentInput(f.scheduledAt).replace('T',' ')||'Belgilanmagan'}</li>)}</ul><button type="button" disabled={busy||!preview.count} onClick={save} className="rounded-xl bg-emerald-500 px-4 py-2 font-black text-slate-950 disabled:opacity-50">{preview.count} ta o‘yinga saqlash</button></div>}
    </div>}
    {error&&<p role="alert" className="text-xs text-rose-300">{error}</p>}{message&&<p role="status" className="text-xs text-emerald-300">{message}</p>}
  </section>;
}
