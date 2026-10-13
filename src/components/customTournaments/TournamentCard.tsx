import React from 'react';
import type {CustomTournament} from '../../types/customTournament';
import {Trophy, Users, ArrowRight} from 'lucide-react';
import {tournamentFormatLabel,tournamentStatusLabel} from '../../lib/customTournamentLabels';
export function TournamentCard({tournament:t,onClick}:{tournament:CustomTournament;onClick:()=>void}) {
  return <div role="button" tabIndex={0} onClick={onClick} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onClick();}}} className="min-w-0 bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 rounded-2xl p-4 cursor-pointer space-y-3">
    <div className="flex flex-wrap gap-2 text-xs"><span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400">{tournamentStatusLabel[t.status]}</span><span className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300">{t.visibility==='PRIVATE'?'Yopiq':t.visibility==='PUBLIC_MODERATED'?'Ariza bilan':'Ochiq'}</span></div>
    <div className="flex items-start gap-2 min-w-0"><Trophy className="w-5 h-5 shrink-0 text-emerald-400 mt-1" /><h3 className="min-w-0 text-base font-bold text-slate-100 break-words [overflow-wrap:anywhere]">{t.name}</h3></div>
    <p className="text-xs text-slate-400">{tournamentFormatLabel[t.format]}</p>
    {t.organizerUsername&&<p className="text-xs text-slate-400 break-words [overflow-wrap:anywhere]">Tashkilotchi: @{t.organizerUsername}</p>}
    {t.description&&<p className="text-xs text-slate-300 line-clamp-2 break-words [overflow-wrap:anywhere]">{t.description}</p>}
    <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-300 inline-flex items-center gap-1"><Users className="w-4 h-4 shrink-0" />{t.currentParticipantsCount} / {t.maxParticipants} qatnashchi</span><span className="text-emerald-400 inline-flex items-center gap-1">Ochish<ArrowRight className="w-4 h-4" /></span></div>
  </div>;
}
