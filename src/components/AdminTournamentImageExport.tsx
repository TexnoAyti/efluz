import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Share2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import type { Competition, Fixture } from '../types';
import { canExportTournamentImage, exportCopy, imageFilename, matchdayImageModel, standingsImageModel, tournamentImageBlob } from '../lib/tournamentImage';

export const AdminTournamentImageExport: React.FC<{ competition?: Pick<Competition,'id'|'name'|'currentMatchday'> | null; kind: 'standings'|'matchday'; matchday?: number; availableFixtures?: Fixture[]; disabled?: boolean }> = ({ competition, kind, matchday, availableFixtures = [], disabled }) => {
  const { user, activeSeasonId, showToast } = useAuth(); const { language } = useI18n(); const copy=exportCopy[language];
  const dialogRef=useRef<HTMLDivElement>(null); const triggerRef=useRef<HTMLButtonElement>(null);
  const [round,setRound]=useState(competition?.currentMatchday||1); const [busy,setBusy]=useState(false);
  const [preview,setPreview]=useState<{url:string;blob:Blob;filename:string}|null>(null);
  const scope=`${user?.id}:${activeSeasonId}:${competition?.id}:${matchday ?? round}`; const scopeRef=useRef(scope);scopeRef.current=scope;
  useEffect(()=>{setRound(competition?.currentMatchday||(availableFixtures.length ? Math.min(...availableFixtures.map(f=>f.matchday)) : 1));},[competition?.id]);
  useEffect(()=>{setPreview(null);},[scope]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
  useEffect(()=>{
    if(!preview)return;
    const previous=document.activeElement as HTMLElement|null;
    const controls=()=>Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('a[href],button')||[]);
    controls()[0]?.focus();
    const keys=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setPreview(null);return;}
      if(event.key==='Tab'){
        const items=controls(), first=items[0],last=items[items.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',keys);
    return()=>{document.removeEventListener('keydown',keys);if(previous?.isConnected)previous.focus();else triggerRef.current?.focus();};
  },[preview]);
  const rounds=[...new Set(availableFixtures.map(f=>f.matchday))].sort((a,b)=>a-b);
  const selectedRound=matchday??(rounds.includes(round)?round:rounds[0]??round);
  if(!canExportTournamentImage(user)||!competition)return null;
  async function prepare(){
    if(busy||!competition)return;setBusy(true);const requestScope=scope;
    try{
      await api.getAdminAccess(); // Every admin can export public tournament data, irrespective of management scope.
      let model;
      if(kind==='standings'){
        const data=await api.getCompetitionStandings(competition.id,true);
        model=standingsImageModel(competition.name,activeSeasonId,data.standings,language);
        model.cached=Boolean((data as any).degraded||(data as any).stale);
      }else{
        const data=await api.getCompetitionFixtures(competition.id,selectedRound,undefined,true);
        model=matchdayImageModel(competition.name,activeSeasonId,data.fixtures,selectedRound,language);
        model.cached=Boolean((data as any).degraded||(data as any).stale);
      }
      const blob=await tournamentImageBlob(model);
      if(scopeRef.current!==requestScope)return;
      setPreview({url:URL.createObjectURL(blob),blob,filename:imageFilename(competition.id,kind,kind==='matchday'?selectedRound:undefined)});
    }catch(error){if(scopeRef.current===requestScope)showToast(error instanceof Error?error.message:copy.failed,'error');}
    finally{setBusy(false);}
  }
  async function share(){if(!preview)return;try{await navigator.share({files:[new File([preview.blob],preview.filename,{type:'image/png'})]});}catch(error){if((error as Error).name!=='AbortError')showToast(copy.failed,'error');}}
  const canShare=preview&&typeof navigator.canShare==='function'&&navigator.canShare({files:[new File([preview.blob],preview.filename,{type:'image/png'})]});
  return <div className="flex flex-wrap items-center justify-end gap-2">
    {kind==='matchday'&&matchday==null&&rounds.length>0&&<select aria-label={copy.round} value={selectedRound} onChange={e=>setRound(Number(e.target.value))} className="rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface)] px-2 py-2 text-xs text-[var(--efl-text)]">{rounds.map(md=><option key={md} value={md}>{copy.round} {md}</option>)}</select>}
    <button ref={triggerRef} type="button" onClick={prepare} disabled={busy||disabled} className="flex items-center gap-1.5 min-h-[40px] px-3 py-2 rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface)] text-[var(--efl-text)] text-xs font-bold disabled:opacity-40">{busy?<Loader2 className="w-4 h-4 animate-spin"/>:<Download className="w-4 h-4"/>}{busy?copy.busy:kind==='standings'?copy.tableDownload:copy.roundDownload}</button>
    {preview&&<div ref={dialogRef} role="dialog" aria-modal="true" aria-label={copy.download} className="fixed inset-0 z-[100] bg-black/85 p-4 flex flex-col items-center justify-center gap-3">
      <div className="flex items-center justify-end gap-2 w-full max-w-lg"><a href={preview.url} download={preview.filename} className="px-3 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1"><Download className="w-4 h-4"/>{copy.save}</a>{canShare&&<button type="button" onClick={share} className="px-3 py-2 rounded-xl bg-slate-800 text-white text-xs flex items-center gap-1"><Share2 className="w-4 h-4"/>{copy.share}</button>}<button type="button" aria-label={copy.close} onClick={()=>setPreview(null)} className="p-2 rounded-xl bg-slate-800 text-white"><X className="w-5 h-5"/></button></div>
      <img src={preview.url} alt={`${competition.name} ${kind==='matchday'?selectedRound:copy.standings}`} className="max-h-[75vh] max-w-full object-contain rounded-xl"/>
    </div>}
  </div>;
};
