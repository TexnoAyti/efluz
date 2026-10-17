import React from 'react';
import { Fixture } from '../types';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { AdminEditResultModal } from './admin/AdminMatchModals';

export function CupMatchModal({ fixture, onClose, onSuccess }: { fixture: Fixture; onClose: () => void; onSuccess: (fixture: Fixture) => void }) {
  const { user } = useAuth();
  if (user?.isAdmin) return <AdminEditResultModal fixture={fixture} isOpen onClose={onClose} onSave={async (params) => {
    const result = await api.adminEditFixtureResult(fixture.id, params);
    onSuccess(result.fixture);
  }} />;
  return (
    <div role="dialog" aria-modal="true" aria-label="Uchrashuv tafsilotlari" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="preview-surface rounded-2xl border p-6 space-y-3 text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold">{fixture.roundName}</h3>
        <p>{fixture.homeClub?.name || 'TBD'} — {fixture.awayClub?.name || 'TBD'}</p>
        <p className="text-2xl font-black">{fixture.homeScore ?? '–'} : {fixture.awayScore ?? '–'}</p>
        {fixture.homeExtraTimeScore != null && <p>Qo‘shimcha vaqtdan keyin: {fixture.homeExtraTimeScore} : {fixture.awayExtraTimeScore}</p>}
        {fixture.homePenaltyScore != null && <p>Penaltilar: {fixture.homePenaltyScore} : {fixture.awayPenaltyScore}</p>}
        <p>{fixture.status}</p>
        <button className="rounded-xl bg-blue-600 text-white px-4 py-2" onClick={onClose}>Yopish</button>
      </div>
    </div>
  );
}
