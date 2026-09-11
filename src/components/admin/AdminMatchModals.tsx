import React, { useState } from 'react';
import { Fixture } from '../../types';
import { ClubCrest } from '../ClubCrest';
import {
  X,
  AlertTriangle,
  RotateCcw,
  Edit3,
  Trash2,
  Calendar,
  Layers,
  Clock,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

interface EditResultModalProps {
  fixture: Fixture;
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: { homeScore: number; awayScore: number; status?: string; notes?: string }) => Promise<void>;
}

export const AdminEditResultModal: React.FC<EditResultModalProps> = ({
  fixture,
  isOpen,
  onClose,
  onSave,
}) => {
  const [homeScore, setHomeScore] = useState<number>(fixture.homeScore ?? 0);
  const [awayScore, setAwayScore] = useState<number>(fixture.awayScore ?? 0);
  const [status, setStatus] = useState<string>(fixture.status === 'CONFIRMED' ? 'CONFIRMED' : 'CONFIRMED');
  const [notes, setNotes] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        homeScore: Number(homeScore),
        awayScore: Number(awayScore),
        status,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel p-5 max-w-lg w-full rounded-2xl border-emerald-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Edit3 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">Admin Match Result Editor</h3>
              <p className="text-[10px] text-slate-400">Directly set final score & standings</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Match Header */}
        <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClubCrest
              clubId={fixture.homeClubId}
              logoUrl={fixture.homeClub?.logoUrl}
              name={fixture.homeClub?.name}
              size="sm"
            />
            <span className="text-xs font-bold text-white">{fixture.homeClub?.name || fixture.homeClubId}</span>
          </div>
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest px-2">VS</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white">{fixture.awayClub?.name || fixture.awayClubId}</span>
            <ClubCrest
              clubId={fixture.awayClubId}
              logoUrl={fixture.awayClub?.logoUrl}
              name={fixture.awayClub?.name}
              size="sm"
            />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">
                {fixture.homeClub?.shortName || fixture.homeClub?.name || 'Home'} Score
              </label>
              <input
                type="number"
                min="0"
                max="99"
                value={homeScore}
                onChange={(e) => setHomeScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-center text-lg font-black text-white focus:outline-none focus:border-emerald-500"
                required
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">
                {fixture.awayClub?.shortName || fixture.awayClub?.name || 'Away'} Score
              </label>
              <input
                type="number"
                min="0"
                max="99"
                value={awayScore}
                onChange={(e) => setAwayScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-center text-lg font-black text-white focus:outline-none focus:border-emerald-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">Set Match Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="CONFIRMED">CONFIRMED (Final result & standings)</option>
              <option value="AWAITING_RESULT">AWAITING_RESULT (In play)</option>
              <option value="SCHEDULED">SCHEDULED (Not played yet)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">
              Admin Notes / Reason (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Corrected verified screenshot score"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Saving will immediately update the fixture record, write an audit log entry, and trigger standings recalculation.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors shadow-lg shadow-emerald-500/20"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save Result
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DeleteResultModalProps {
  fixture: Fixture;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: { deleteSubmissions: boolean; notes?: string }) => Promise<void>;
}

export const AdminDeleteResultModal: React.FC<DeleteResultModalProps> = ({
  fixture,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [deleteSubmissions, setDeleteSubmissions] = useState(true);
  const [notes, setNotes] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeleting(true);
    try {
      await onConfirm({
        deleteSubmissions,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-amber-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">Reset Match Result</h3>
              <p className="text-[10px] text-slate-400">Clear scores & return to SCHEDULED</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] text-center space-y-1">
          <div className="text-xs font-bold text-white">
            {fixture.homeClub?.name || fixture.homeClubId} vs {fixture.awayClub?.name || fixture.awayClubId}
          </div>
          <div className="text-sm font-black text-amber-400 font-mono">
            Current Score: {fixture.homeScore ?? '-'} : {fixture.awayScore ?? '-'} ({fixture.status})
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={deleteSubmissions}
              onChange={(e) => setDeleteSubmissions(e.target.checked)}
              className="rounded border-slate-700 text-amber-500 focus:ring-0 bg-slate-900"
            />
            <span>Also delete all user score submissions for this match</span>
          </label>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">Reason / Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Result entered by mistake; match rescheduled"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Standings will be automatically recalculated to subtract points and goals from this match.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDeleting}
              className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5"
            >
              {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Reset Result
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DeleteFixtureModalProps {
  fixture: Fixture;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

export const AdminDeleteFixtureModal: React.FC<DeleteFixtureModalProps> = ({
  fixture,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen) return null;

  const isConfirmed = confirmText === 'DELETE';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed || reason.trim().length < 3) return;
    setIsDeleting(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-rose-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">Delete Match Fixture</h3>
              <p className="text-[10px] text-rose-400 font-bold">Dangerous administrative action</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] text-xs text-slate-300 space-y-1">
          <p className="font-bold text-white">
            {fixture.homeClub?.name || fixture.homeClubId} vs {fixture.awayClub?.name || fixture.awayClubId}
          </p>
          <p className="text-[11px] text-slate-400 font-mono">
            Competition: {fixture.competitionName || fixture.competitionId} | Matchday: {fixture.matchday || '—'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">Reason for Deletion (Required)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate fixture test artifact"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              required
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">
              Type <span className="font-mono text-rose-400 font-black">DELETE</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-center text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isConfirmed || reason.trim().length < 3 || isDeleting}
              className="px-5 py-2 bg-rose-500 hover:bg-rose-400 disabled:opacity-50 disabled:hover:bg-rose-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5"
            >
              {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Permanently Delete Fixture
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
