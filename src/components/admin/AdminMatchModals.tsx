import React, { useEffect, useMemo, useState } from 'react';
import { Fixture } from '../../types';
import { ClubCrest } from '../ClubCrest';
import { api, getDevUserId, getSessionToken, getTelegramInitData } from '../../lib/api';
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
  Activity,
  BellRing,
  FileImage,
  History,
  ShieldAlert,
  UserRound,
  Send,
  ExternalLink,
} from 'lucide-react';

interface EditResultModalProps {
  fixture: Fixture;
  isOpen: boolean;
  onClose: () => void;
  onSave: (params: { homeScore: number; awayScore: number; status?: string; notes?: string }) => Promise<void>;
}

async function adminFetch(path: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getSessionToken();
  const telegramData = getTelegramInitData();
  const devId = getDevUserId();
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (telegramData) headers['x-telegram-init-data'] = telegramData;
  else if (devId) headers['x-dev-user-id'] = devId;
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
  return payload;
}

function playerLabel(fixture: any, side: 'home' | 'away') {
  const user = side === 'home' ? fixture.homeUser : fixture.awayUser;
  const owner = side === 'home' ? fixture.homeOwner : fixture.awayOwner;
  const username = user?.username || owner?.username || (side === 'home' ? fixture.homeClub?.claimedByUsername : fixture.awayClub?.claimedByUsername);
  const userId = user?.id || owner?.userId || (side === 'home' ? fixture.homeOwnerId : fixture.awayOwnerId);
  return {
    username: username ? `@${String(username).replace(/^@+/, '')}` : 'Unassigned player',
    userId: userId || '—',
  };
}

export const AdminEditResultModal: React.FC<EditResultModalProps> = ({ fixture, isOpen, onClose, onSave }) => {
  const [homeScore, setHomeScore] = useState<number>(fixture.homeScore ?? 0);
  const [awayScore, setAwayScore] = useState<number>(fixture.awayScore ?? 0);
  const [status, setStatus] = useState<string>(fixture.status === 'CONFIRMED' ? 'CONFIRMED' : 'CONFIRMED');
  const [notes, setNotes] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [pane, setPane] = useState<'control' | 'evidence' | 'audit'>('control');
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [quickBusy, setQuickBusy] = useState<string | null>(null);
  const [quickMessage, setQuickMessage] = useState<string | null>(null);
  const [dangerReason, setDangerReason] = useState('');

  const homePlayer = useMemo(() => playerLabel(fixture as any, 'home'), [fixture]);
  const awayPlayer = useMemo(() => playerLabel(fixture as any, 'away'), [fixture]);
  const hasResult = fixture.homeScore !== null && fixture.homeScore !== undefined && fixture.awayScore !== null && fixture.awayScore !== undefined;

  useEffect(() => {
    if (!isOpen) return;
    setHomeScore(fixture.homeScore ?? 0);
    setAwayScore(fixture.awayScore ?? 0);
    setStatus(fixture.status === 'CONFIRMED' ? 'CONFIRMED' : 'CONFIRMED');
    setNotes('');
    setPane('control');
    setQuickMessage(null);
    setDangerReason('');
    setLoadingRecord(true);
    Promise.all([
      api.adminGetSubmissions({ fixtureId: fixture.id, limit: 20 }).catch(() => ({ submissions: [], total: 0 })),
      api.getAdminAuditLogs(200, true).catch(() => ({ logs: [] })),
    ]).then(([submissionResult, auditResult]) => {
      setSubmissions(submissionResult.submissions || []);
      setAuditLogs((auditResult.logs || []).filter((log: any) => log.entityId === fixture.id || String(log.notes || '').includes(fixture.id)));
    }).finally(() => setLoadingRecord(false));
  }, [isOpen, fixture.id]);

  if (!isOpen) return null;

  const refreshAfterMutation = () => {
    onClose();
    if (typeof window !== 'undefined') setTimeout(() => window.location.reload(), 120);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({ homeScore: Number(homeScore), awayScore: Number(awayScore), status, notes: notes.trim() || undefined });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const sendReminder = async () => {
    setQuickBusy('remind');
    setQuickMessage(null);
    try {
      const result = await adminFetch(`/api/admin/fixtures/${encodeURIComponent(fixture.id)}/remind`, { seasonId: fixture.seasonId || 'season-2026-27' });
      setQuickMessage(`Reminder queued for ${result.queued || 0}/${result.recipients || 0} player(s).`);
    } catch (err: any) {
      setQuickMessage(err?.message || 'Reminder failed.');
    } finally {
      setQuickBusy(null);
    }
  };

  const reopen = async () => {
    if (!window.confirm('Reopen this fixture and remove the confirmed result from official flow?')) return;
    setQuickBusy('reopen');
    try {
      await api.reopenFixture(fixture.id, notes.trim() || 'Reopened from Match Control Center');
      refreshAfterMutation();
    } catch (err: any) {
      setQuickMessage(err?.message || 'Reopen failed.');
      setQuickBusy(null);
    }
  };

  const resetResult = async () => {
    if (!window.confirm('Reset this score and delete its result submissions?')) return;
    setQuickBusy('reset');
    try {
      await api.adminDeleteFixtureResult(fixture.id, { deleteSubmissions: true, notes: notes.trim() || 'Reset from Match Control Center' });
      refreshAfterMutation();
    } catch (err: any) {
      setQuickMessage(err?.message || 'Reset failed.');
      setQuickBusy(null);
    }
  };

  const deleteFixture = async () => {
    if (dangerReason.trim().length < 3) return;
    if (!window.confirm('Permanently delete this fixture? This cannot be undone.')) return;
    setQuickBusy('delete');
    try {
      await api.adminDeleteFixture(fixture.id, dangerReason.trim());
      refreshAfterMutation();
    } catch (err: any) {
      setQuickMessage(err?.message || 'Delete failed.');
      setQuickBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-4xl max-h-[94vh] overflow-hidden rounded-[26px] border border-emerald-400/25 bg-[radial-gradient(circle_at_8%_0%,rgba(16,185,129,0.12),transparent_28%),linear-gradient(155deg,#0f172a,#020617)] shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] p-4 sm:p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400"><Activity className="w-3.5 h-3.5" /> Match Control Center</div>
            <h3 className="mt-1 text-base sm:text-lg font-black text-white truncate">{fixture.competitionName || fixture.competitionId} • {fixture.roundName || `Matchday ${fixture.matchday || 1}`}</h3>
            <p className="mt-0.5 text-[10px] text-slate-500 font-mono truncate">{fixture.id}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-white/[0.06] text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="overflow-y-auto max-h-[calc(94vh-80px)] p-4 sm:p-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-center rounded-2xl border border-white/[0.07] bg-black/20 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <ClubCrest clubId={fixture.homeClubId} logoUrl={fixture.homeClub?.logoUrl} name={fixture.homeClub?.name} size="md" />
              <div className="min-w-0"><div className="text-sm font-black text-white truncate">{fixture.homeClub?.name || fixture.homeClubId || 'TBD'}</div><div className="text-[10px] text-emerald-300 truncate">{homePlayer.username}</div><div className="text-[9px] text-slate-600 font-mono">ID {homePlayer.userId}</div></div>
            </div>
            <div className="text-center px-2"><div className="text-[9px] font-black uppercase tracking-widest text-slate-600">Current</div><div className="text-2xl font-black text-white tabular-nums">{fixture.homeScore ?? '–'} : {fixture.awayScore ?? '–'}</div><div className="mt-1 inline-flex rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[9px] font-black text-slate-300">{fixture.status}</div></div>
            <div className="flex items-center justify-end gap-3 min-w-0 text-right"><div className="min-w-0"><div className="text-sm font-black text-white truncate">{fixture.awayClub?.name || fixture.awayClubId || 'TBD'}</div><div className="text-[10px] text-emerald-300 truncate">{awayPlayer.username}</div><div className="text-[9px] text-slate-600 font-mono">ID {awayPlayer.userId}</div></div><ClubCrest clubId={fixture.awayClubId} logoUrl={fixture.awayClub?.logoUrl} name={fixture.awayClub?.name} size="md" /></div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Meta icon={<Layers className="w-3.5 h-3.5" />} label="Competition" value={fixture.competitionName || fixture.competitionId} />
            <Meta icon={<Calendar className="w-3.5 h-3.5" />} label="Round" value={fixture.roundName || `MD ${fixture.matchday || 1}`} />
            <Meta icon={<Clock className="w-3.5 h-3.5" />} label="Deadline" value={fixture.scheduledAt ? new Date(fixture.scheduledAt).toLocaleString() : 'Not set'} />
            <Meta icon={<ShieldAlert className="w-3.5 h-3.5" />} label="Evidence" value={`${submissions.length} submission${submissions.length === 1 ? '' : 's'}`} />
          </div>

          <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/20 p-1.5">
            {([['control', Edit3, 'Control'], ['evidence', FileImage, `Evidence ${submissions.length}`], ['audit', History, `Audit ${auditLogs.length}`]] as const).map(([id, Icon, label]) => (
              <button key={id} onClick={() => setPane(id)} className={`shrink-0 rounded-lg px-3 py-2 text-[10px] font-black flex items-center gap-1.5 transition ${pane === id ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}><Icon className="w-3.5 h-3.5" />{label}</button>
            ))}
          </div>

          {pane === 'control' && (
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <form onSubmit={handleSubmit} className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 space-y-4">
                <div><div className="text-xs font-black text-white">Official Result Editor</div><div className="text-[10px] text-slate-500 mt-0.5">Writes audit log and recalculates official standings.</div></div>
                <div className="grid grid-cols-2 gap-3">
                  <ScoreField label={fixture.homeClub?.shortName || fixture.homeClub?.name || 'Home'} value={homeScore} setValue={setHomeScore} />
                  <ScoreField label={fixture.awayClub?.shortName || fixture.awayClub?.name || 'Away'} value={awayScore} setValue={setAwayScore} />
                </div>
                <div><label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">Result state</label><select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-semibold text-white focus:outline-none focus:border-emerald-500"><option value="CONFIRMED">CONFIRMED — official final</option><option value="AWAITING_RESULT">AWAITING_RESULT — reopen play</option><option value="SCHEDULED">SCHEDULED — not played</option></select></div>
                <div><label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">Admin note</label><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Correction reason, verification note…" className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500" /></div>
                <button type="submit" disabled={isSaving} className="w-full min-h-[42px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50">{isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save Official Result</button>
              </form>

              <div className="space-y-3">
                <div className="rounded-2xl border border-blue-400/15 bg-blue-400/[0.045] p-4 space-y-3">
                  <div><div className="text-xs font-black text-white">Live Operations</div><div className="text-[10px] text-slate-500 mt-0.5">Actions for this fixture only.</div></div>
                  <button onClick={sendReminder} disabled={Boolean(quickBusy) || ['CONFIRMED', 'CANCELLED'].includes(fixture.status)} className="w-full min-h-[40px] rounded-xl border border-blue-400/20 bg-blue-400/10 text-blue-200 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-35"><BellRing className="w-4 h-4" /> {quickBusy === 'remind' ? 'Queueing…' : 'Send Player Reminder'}</button>
                  {fixture.status === 'CONFIRMED' && <button onClick={reopen} disabled={Boolean(quickBusy)} className="w-full min-h-[40px] rounded-xl border border-amber-400/20 bg-amber-400/10 text-amber-200 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-35"><RotateCcw className="w-4 h-4" /> Reopen Fixture</button>}
                  {hasResult && <button onClick={resetResult} disabled={Boolean(quickBusy)} className="w-full min-h-[40px] rounded-xl border border-orange-400/20 bg-orange-400/10 text-orange-200 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-35"><RotateCcw className="w-4 h-4" /> Reset Result + Submissions</button>}
                  {quickMessage && <div className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5 text-[10px] text-slate-300">{quickMessage}</div>}
                </div>

                <div className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.035] p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-rose-300"><Trash2 className="w-3.5 h-3.5" /> Danger Zone</div>
                  <input value={dangerReason} onChange={(e) => setDangerReason(e.target.value)} placeholder="Required deletion reason…" className="w-full px-3 py-2.5 bg-slate-950 border border-rose-500/15 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500" />
                  <button onClick={deleteFixture} disabled={dangerReason.trim().length < 3 || Boolean(quickBusy)} className="w-full min-h-[40px] rounded-xl bg-rose-500/15 border border-rose-500/25 text-rose-200 text-xs font-black flex items-center justify-center gap-2 disabled:opacity-30"><Trash2 className="w-4 h-4" /> Permanently Delete Fixture</button>
                </div>
              </div>
            </div>
          )}

          {pane === 'evidence' && (
            <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
              <div className="flex items-center justify-between"><div><div className="text-xs font-black text-white">Submission Evidence</div><div className="text-[10px] text-slate-500">Both players’ raw score claims and screenshots.</div></div>{loadingRecord && <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />}</div>
              <div className="mt-3 space-y-2">
                {!loadingRecord && submissions.length === 0 ? <div className="rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-[11px] text-slate-500">No submissions recorded for this fixture.</div> : submissions.map((submission) => (
                  <div key={submission.id} className="rounded-xl border border-white/[0.06] bg-slate-950/60 p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-400/15 flex items-center justify-center text-indigo-300"><UserRound className="w-4 h-4" /></div>
                    <div className="min-w-0 flex-1"><div className="text-[11px] font-black text-white truncate">@{submission.submitterUsername || submission.submittedByUserId}</div><div className="text-[10px] text-slate-500">Claim: <span className="font-black text-emerald-300">{submission.homeScore}–{submission.awayScore}</span> • {submission.createdAt ? new Date(submission.createdAt).toLocaleString() : '—'}</div></div>
                    {submission.proofUrl && <a href={submission.proofUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-indigo-400/20 bg-indigo-400/10 px-2.5 py-1.5 text-[10px] font-black text-indigo-200 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Proof</a>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {pane === 'audit' && (
            <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
              <div className="flex items-center justify-between"><div><div className="text-xs font-black text-white">Fixture Audit Trail</div><div className="text-[10px] text-slate-500">Administrative actions linked to this fixture.</div></div>{loadingRecord && <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />}</div>
              <div className="mt-3 space-y-2">
                {!loadingRecord && auditLogs.length === 0 ? <div className="rounded-xl border border-dashed border-white/[0.08] p-6 text-center text-[11px] text-slate-500">No fixture-specific audit events found in the recent log window.</div> : auditLogs.map((log) => (
                  <div key={log.id} className="flex gap-3 rounded-xl border border-white/[0.05] bg-slate-950/50 p-3"><div className="mt-1 w-2 h-2 rounded-full bg-emerald-400 shrink-0" /><div className="min-w-0"><div className="text-[10px] font-black text-white break-words">{log.action}</div><div className="mt-0.5 text-[9px] text-slate-500">{log.actorUsername ? `@${log.actorUsername}` : log.actorUserId || 'system'} • {log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</div>{log.notes && <div className="mt-1 text-[10px] text-slate-400 break-words">{log.notes}</div>}</div></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-white/[0.06] bg-black/20 p-2.5"><div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-600">{icon}{label}</div><div className="mt-1 text-[10px] font-bold text-slate-300 truncate">{value}</div></div>;
}

function ScoreField({ label, value, setValue }: { label: string; value: number; setValue: (value: number) => void }) {
  return <div><label className="text-[10px] font-black uppercase tracking-wider text-slate-500 block mb-1">{label}</label><input type="number" min="0" max="99" value={value} onChange={(e) => setValue(Math.max(0, parseInt(e.target.value, 10) || 0))} className="w-full px-3 py-3 bg-slate-950 border border-slate-800 rounded-xl text-center text-xl font-black text-white focus:outline-none focus:border-emerald-500" /></div>;
}

interface DeleteResultModalProps {
  fixture: Fixture;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (options: { deleteSubmissions: boolean; notes?: string }) => Promise<void>;
}

export const AdminDeleteResultModal: React.FC<DeleteResultModalProps> = ({ fixture, isOpen, onClose, onConfirm }) => {
  const [deleteSubmissions, setDeleteSubmissions] = useState(true);
  const [notes, setNotes] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeleting(true);
    try {
      await onConfirm({ deleteSubmissions, notes: notes.trim() || undefined });
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
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><div className="flex items-center gap-2"><div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20"><RotateCcw className="w-4 h-4" /></div><div><h3 className="text-sm font-black text-white">Reset Match Result</h3><p className="text-[10px] text-slate-400">Clear scores & return to SCHEDULED</p></div></div><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button></div>
        <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] text-center space-y-1"><div className="text-xs font-bold text-white">{fixture.homeClub?.name || fixture.homeClubId} vs {fixture.awayClub?.name || fixture.awayClubId}</div><div className="text-sm font-black text-amber-400 font-mono">Current Score: {fixture.homeScore ?? '-'} : {fixture.awayScore ?? '-'} ({fixture.status})</div></div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none"><input type="checkbox" checked={deleteSubmissions} onChange={(e) => setDeleteSubmissions(e.target.checked)} className="rounded border-slate-700 text-amber-500 focus:ring-0 bg-slate-900" /><span>Also delete all user score submissions for this match</span></label>
          <div><label className="text-xs font-bold text-slate-300 block mb-1">Reason / Notes</label><input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Result entered by mistake; match rescheduled" className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500" /></div>
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-start gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>Standings will be automatically recalculated to subtract points and goals from this match.</span></div>
          <div className="flex items-center justify-end gap-2 pt-2"><button type="button" onClick={onClose} disabled={isDeleting} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold">Cancel</button><button type="submit" disabled={isDeleting} className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5">{isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Reset Result</button></div>
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

export const AdminDeleteFixtureModal: React.FC<DeleteFixtureModalProps> = ({ fixture, isOpen, onClose, onConfirm }) => {
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
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3"><div className="flex items-center gap-2"><div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20"><Trash2 className="w-4 h-4" /></div><div><h3 className="text-sm font-black text-white">Delete Match Fixture</h3><p className="text-[10px] text-rose-400 font-bold">Dangerous administrative action</p></div></div><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button></div>
        <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] text-xs text-slate-300 space-y-1"><p className="font-bold text-white">{fixture.homeClub?.name || fixture.homeClubId} vs {fixture.awayClub?.name || fixture.awayClubId}</p><p className="text-[11px] text-slate-400 font-mono">Competition: {fixture.competitionName || fixture.competitionId} | Matchday: {fixture.matchday || '—'}</p></div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div><label className="text-xs font-bold text-slate-300 block mb-1">Reason for Deletion (Required)</label><input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate fixture test artifact" className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500" required /></div>
          <div><label className="text-xs font-bold text-slate-300 block mb-1">Type <span className="font-mono text-rose-400 font-black">DELETE</span> to confirm:</label><input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-center text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500" required /></div>
          <div className="flex items-center justify-end gap-2 pt-2"><button type="button" onClick={onClose} disabled={isDeleting} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold">Cancel</button><button type="submit" disabled={!isConfirmed || reason.trim().length < 3 || isDeleting} className="px-5 py-2 bg-rose-500 hover:bg-rose-400 disabled:opacity-50 disabled:hover:bg-rose-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5">{isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Permanently Delete Fixture</button></div>
        </form>
      </div>
    </div>
  );
};
