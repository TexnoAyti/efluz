import {CompetitionEntry} from '../CompetitionWorkspace';
import React from 'react';
import type {CustomTournament} from '../../types/customTournament';
import {Trophy, Users, Lock} from 'lucide-react';
import {tournamentFormatLabel,tournamentStatusLabel} from '../../lib/customTournamentLabels';
export function TournamentCard({tournament:t,onClick,roleLabel}:{tournament:CustomTournament;onClick:()=>void;roleLabel?:string}) {
 const tone=t.status==='REGISTRATION_OPEN'?'open':t.status==='IN_PROGRESS'?'live':t.status==='CANCELLED'?'closed':'';
 return <CompetitionEntry onClick={onClick} emblem={<Trophy size={28}/>} title={t.name}
  status={<span className={`tourney-chip ${tone}`}>{tournamentStatusLabel[t.status]}</span>}
  meta={<>{tournamentFormatLabel[t.format]} · {t.visibility==='PUBLIC_MODERATED'?'Ariza bilan':t.visibility==='PRIVATE'?'Taklif bilan':'Erkin qo‘shilish'}</>}
  description={t.description}
  preview={roleLabel||t.visibility==='PRIVATE'?<span className="tourney-chips">{roleLabel&&<span className="tourney-chip">{roleLabel}</span>}{t.visibility==='PRIVATE'&&<span className="tourney-chip"><Lock size={11}/>Yopiq</span>}</span>:undefined}
  footer={<span className="inline-flex items-center gap-1"><Users size={14}/>{t.currentParticipantsCount} / {t.maxParticipants} qatnashchi</span>}/>
}
