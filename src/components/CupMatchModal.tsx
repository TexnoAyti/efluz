import React,{useEffect,useRef} from 'react';
import {X} from 'lucide-react';
import { Fixture } from '../types';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { AdminEditResultModal } from './admin/AdminMatchModals';

export function CupMatchModal({ fixture, onClose, onSuccess }: { fixture: Fixture; onClose: () => void; onSuccess: (fixture: Fixture) => void }) {
  const { user } = useAuth();
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(!user?.isAdmin)dialog.current?.showModal();},[user?.isAdmin]);
  if (user?.isAdmin) return <AdminEditResultModal fixture={fixture} isOpen onClose={onClose} onSave={async (params) => {
    const result = await api.adminEditFixtureResult(fixture.id, params);
    onSuccess(result.fixture);
  }} />;
  return (
    <dialog ref={dialog} className="competition-dialog" aria-labelledby="cup-match-title" onCancel={e=>{e.preventDefault();onClose();}}>
      <header><div><p className="competition-eyebrow">EFLUZ · KUBOK</p><h2 id="cup-match-title">{fixture.roundName||'Uchrashuv tafsilotlari'}</h2></div><button type="button" className="competition-button" aria-label="Uchrashuvni yopish" onClick={onClose}><X size={18}/></button></header>
      <div className="competition-dialog-body text-center">
        <p>{fixture.homeClub?.name || 'TBD'} — {fixture.awayClub?.name || 'TBD'}</p>
        <p className="text-2xl font-black">{fixture.homeScore ?? '–'} : {fixture.awayScore ?? '–'}</p>
        {fixture.homeExtraTimeScore != null && <p>Qo‘shimcha vaqtdan keyin: {fixture.homeExtraTimeScore} : {fixture.awayExtraTimeScore}</p>}
        {fixture.homePenaltyScore != null && <p>Penaltilar: {fixture.homePenaltyScore} : {fixture.awayPenaltyScore}</p>}
        <p className="competition-muted">{({SCHEDULED:'O‘yin kutilmoqda',PENDING:'O‘yin kutilmoqda',LIVE:'Davom etmoqda',COMPLETED:'Yakunlangan',FINISHED:'Yakunlangan',CANCELLED:'Bekor qilingan'} as Record<string,string>)[fixture.status]||fixture.status}</p>
        <button className="competition-button primary" onClick={onClose}>Yopish</button>
      </div>
    </dialog>
  );
}
