import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import {
  FileText,
  Search,
  Trash2,
  ExternalLink,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react';

export const AdminSubmissionsSection: React.FC<{
  onSubmissionDeleted?: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string) => void;
}> = ({ onSubmissionDeleted, showToast }) => {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSubForDelete, setSelectedSubForDelete] = useState<any | null>(null);
  const [deleteNotes, setDeleteNotes] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      const res = await api.adminGetSubmissions({ limit: 100 });
      if (res?.submissions) {
        setSubmissions(res.submissions);
      }
    } catch (err: any) {
      console.error('Failed to load submissions:', err);
      showToast('error', 'Failed to load result submissions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
  }, []);

  const filteredSubmissions = submissions.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.fixtureId?.toLowerCase().includes(q) ||
      s.submitterUsername?.toLowerCase().includes(q) ||
      s.submittedByUserId?.toLowerCase().includes(q) ||
      s.id?.toLowerCase().includes(q)
    );
  });

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubForDelete) return;
    setIsDeleting(true);
    try {
      const res = await api.adminDeleteSubmission(selectedSubForDelete.id, deleteNotes.trim() || undefined);
      if (res.success) {
        showToast('success', res.message || 'Submission deleted.');
        setSubmissions((prev) => prev.filter((s) => s.id !== selectedSubForDelete.id));
        setSelectedSubForDelete(null);
        setDeleteNotes('');
        onSubmissionDeleted?.();
      }
    } catch (err: any) {
      showToast('error', err.message || 'Failed to delete submission.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass-panel p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-white/[0.08]">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            Result Submissions Archive
          </h3>
          <p className="text-[11px] text-slate-400">
            Inspect all player-submitted scores, match screenshots, and audit logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fixture ID, player..."
              className="w-48 sm:w-64 pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="button"
            onClick={fetchSubmissions}
            disabled={loading}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 transition-colors"
            title="Refresh submissions"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
          <span>Loading result submissions...</span>
        </div>
      ) : filteredSubmissions.length === 0 ? (
        <div className="glass-panel p-8 text-center text-slate-400 text-xs">
          No result submissions found.
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-[10px] uppercase font-black text-slate-400 bg-slate-950/40">
                  <th className="p-3">Fixture</th>
                  <th className="p-3">Submitted By</th>
                  <th className="p-3 text-center">Score</th>
                  <th className="p-3">Proof</th>
                  <th className="p-3">Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredSubmissions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-3 font-mono text-[11px] text-slate-300">
                      {sub.fixtureId}
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-white">@{sub.submitterUsername || 'player'}</span>
                      <div className="text-[10px] text-slate-500 font-mono">{sub.submittedByUserId}</div>
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-2.5 py-1 rounded-lg font-black text-sm font-mono bg-slate-900 border border-slate-700 text-white">
                        {sub.homeScore} : {sub.awayScore}
                      </span>
                    </td>
                    <td className="p-3">
                      {sub.proofUrl ? (
                        <a
                          href={sub.proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 text-[11px] underline"
                        >
                          <ExternalLink className="w-3 h-3" /> View Proof
                        </a>
                      ) : (
                        <span className="text-slate-500 text-[10px]">No image</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-400 font-mono text-[11px]">
                      {sub.createdAt ? new Date(sub.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedSubForDelete(sub)}
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 transition-colors"
                        title="Delete invalid submission"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Submission Modal */}
      {selectedSubForDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-rose-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">Delete Result Submission</h3>
                  <p className="text-[10px] text-slate-400">Remove fraudulent or invalid score entry</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSubForDelete(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] text-xs text-slate-300 space-y-1">
              <p className="font-bold text-white">
                Player: @{selectedSubForDelete.submitterUsername || 'player'}
              </p>
              <p className="font-mono text-emerald-400">
                Score: {selectedSubForDelete.homeScore} : {selectedSubForDelete.awayScore}
              </p>
              <p className="font-mono text-[10px] text-slate-500">
                Fixture: {selectedSubForDelete.fixtureId}
              </p>
            </div>

            <form onSubmit={handleDelete} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1">Reason / Admin Note</label>
                <input
                  type="text"
                  value={deleteNotes}
                  onChange={(e) => setDeleteNotes(e.target.value)}
                  placeholder="e.g. Invalid proof screenshot; incorrect matchday"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedSubForDelete(null)}
                  disabled={isDeleting}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeleting}
                  className="px-5 py-2 bg-rose-500 hover:bg-rose-400 text-white rounded-xl text-xs font-black flex items-center gap-1.5"
                >
                  {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
