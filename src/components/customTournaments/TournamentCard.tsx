import React from 'react';
import type {CustomTournament} from '../../types/customTournament';
import {ArrowUpRight, Users, Lock} from 'lucide-react';
import {tournamentFormatLabel,tournamentStatusLabel} from '../../lib/customTournamentLabels';
export function TournamentCard({tournament:t,onClick,roleLabel}:{tournament:CustomTournament;onClick:()=>void;roleLabel?:string}) {
 const tone=t.status==='REGISTRATION_OPEN'?'open':t.status==='IN_PROGRESS'?'live':t.status==='CANCELLED'?'closed':'';
 return <button type="button" onClick={onClick} className="tourney-card">
  <span className="tourney-chips"><span className={`tourney-chip ${tone}`}>{tournamentStatusLabel[t.status]}</span>{roleLabel&&<span className="tourney-chip">{roleLabel}</span>}{t.visibility==='PRIVATE'&&<span className="tourney-chip"><Lock size={11}/>Yopiq</span>}</span>
  <h3>{t.name}</h3>
  <span className="tourney-muted">{tournamentFormatLabel[t.format]} · {t.visibility==='PUBLIC_MODERATED'?'Ariza bilan':t.visibility==='PRIVATE'?'Taklif bilan':'Erkin qo‘shilish'}</span>
  {t.description&&<span className="tourney-muted line-clamp-2 break-words">{t.description}</span>}
  <span className="tourney-card-footer"><span className="inline-flex items-center gap-1"><Users size={14}/>{t.currentParticipantsCount} / {t.maxParticipants} qatnashchi</span><span className="inline-flex items-center gap-1">{t.status==='REGISTRATION_OPEN'?'Turnirni ko‘rish':'Natijalarni ko‘rish'}<ArrowUpRight size={14}/></span></span>
 </button>;
}
