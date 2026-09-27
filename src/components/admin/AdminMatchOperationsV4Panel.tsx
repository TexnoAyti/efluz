import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileImage,
  Flag,
  Gavel,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TimerReset,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { matchOpsApi } from '../../lib/matchOpsApi';

function localDateTimeValue(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function tashkent(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d) + ' (Toshkent)';
}

function stateClass(state?: string) {
  if (state === 'OVERDUE') return 'text-rose-300 border-rose-500/30 bg-rose-500/10';
  if (state === 'DUE_6H') return 'text-orange-300 border-orange-500/30 bg-orange-500/10';
  if (state === 'DUE_24H') return 'text-amber-300 border-amber-500/30 bg-amber-500/10';
  return 'text-slate-300 border-slate-700 bg-slate-900/70';
}

function proofLink(submission: any) {
  if (!submission?.proofUrl) return null;
  return <a href={submission.proofUrl} target="_blank" rel="noreferrer" className="text-sky-300 text-[10px] font-bold inline-flex items-center gap-1"><FileImage className="w-3.5 h-3.5" />Proof <ExternalLink className="w-3 h-3" /></a>;
}

export const AdminMatchOperationsV4Panel: React.FC = () => {
  const { activeSeasonId, showToast } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [fixtureId, setFixtureId] = useState('');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [deadlineNote, setDeadlineNote] = useState('');
  const [postponeDates, setPostponeDates] = useState<Record<string, string>>({});
  const [manualScores, setManualScores] = useState<Record<string, { home: string; away: string }>>({});

  const load = async (soft = false) => {
    if (!soft) setLoading(true);
    try {
      setData(await matchOpsApi.adminControl(activeSeasonId));
    } catch (error: any) {
      showToast?.(error?.message || 'Match Operations admin panel yuklanmadi.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(false); }, [activeSeasonId]);

  const openNoShows = useMemo(() => (data?.noShowReports || []).filter((item: any) => ['OPEN', 'UNDER_REVIEW'].includes(String(item.status))), [data]);
  const deadlines = (data?.deadlines || []).slice(0, 20);
  const disputes = data?.disputes || [];

  const run = async (key: string, task: () => Promise<any>, success: string) => {
    setBusy(key);
    try {
      await task();
      showToast?.(success, 'success');
      await load(true);
    } catch (error: any) {
      showToast?.(error?.message || 'Action bajarilmadi.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const setDeadline = async () => {
    if (!fixtureId.trim() || !deadlineLocal) return;
    const iso = new Date(deadlineLocal).toISOString();
    await run(`deadline:${fixtureId}`, () => matchOpsApi.setDeadline(fixtureId.trim(), iso, deadlineNote.trim() || undefined), 'Deadline saqlandi.');
    setDeadlineNote('');
  };

  const resolveNoShow = async (report: any, action: 'WALKOVER_HOME' | 'WALKOVER_AWAY' | 'POSTPONE' | 'REJECT') => {
    const postponeLocal = postponeDates[report.id] || '';
    const deadlineAt = action === 'POSTPONE' && postponeLocal ? new Date(postponeLocal).toISOString() : null;
    if (action === 'POSTPONE' && !deadlineAt) {
      showToast?.('Postpone uchun yangi deadline kiriting.', 'error');
      return;
    }
    await run(`no-show:${report.id}`, () => matchOpsApi.resolveNoShow(report.id, action, `Admin Match Operations V4: ${action}`, deadlineAt), `No-show: ${action}`);
  };

  const resolveDispute = async (dispute: any, action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH') => {
    const scores = manualScores[dispute.id] || { home: '', away: '' };
    const params: any = { notes: `Resolved from Dispute Center V2: ${action}` };
    if (action === 'MANUAL_SCORE') {
      const home = Number(scores.home);
      const away = Number(scores.away);
      if (!Number.isInteger(home) || home < 0 || !Number.isInteger(away) || away < 0) {
        showToast?.('Manual score uchun ikkala hisobni kiriting.', 'error');
        return;
      }
      params.manualHomeScore = home;
      params.manualAwayScore = away;
    }
    await run(`dispute:${dispute.id}`, () => matchOpsApi.resolveDispute(dispute.id, action, params), `Dispute: ${action}`);
  };

  if (loading) return <div className="glass-panel p-5 flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2 text-emerald-400" />Match Operations V4 admin yuklanmoqda…</div>;

  return (
    <section data-admin-match-operations-v4 className="glass-panel p-4 sm:p-5 border-cyan-500/20 space-y-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-400 flex items-center gap-2"><Gavel className="w-4 h-4" />Match Operations V4</div><h3 className="text-lg font-black text-white mt-1">Deadline Queue • No-show • Dispute Center V2</h3></div>
        <button onClick={() => load(true)} className="p-2 rounded-xl bg-white/[0.04] text-slate-400 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
        {[
          ['Deadlines', data?.counters?.deadlines ?? 0, Clock3],
          ['24h', data?.counters?.due24h ?? 0, BellRing],
          ['6h', data?.counters?.due6h ?? 0, TimerReset],
          ['Overdue', data?.counters?.overdue ?? 0, Flag],
          ['No-show', data?.counters?.openNoShows ?? 0, AlertTriangle],
          ['Disputes', data?.counters?.openDisputes ?? 0, ShieldAlert],
        ].map(([label, value, Icon]: any) => <div key={label} className="rounded-xl border border-white/[0.06] bg-slate-950/50 p-3"><Icon className="w-4 h-4 text-emerald-400" /><div className="text-lg font-black text-white mt-1 tabular-nums">{value}</div><div className="text-[9px] uppercase font-bold text-slate-500">{label}</div></div>)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2"><div><div className="text-xs font-black text-white">Deadline Manager</div><div className="text-[10px] text-slate-500">Fixture ID + exact deadline. 24h/6h reminders Telegram queue orqali.</div></div><button onClick={() => run('sweep', () => matchOpsApi.runDeadlineSweep(activeSeasonId), 'Deadline reminder sweep bajarildi.')} disabled={busy === 'sweep'} className="px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[10px] font-black disabled:opacity-40">{busy === 'sweep' ? 'Running…' : 'Run sweep'}</button></div>
          <input value={fixtureId} onChange={(e) => setFixtureId(e.target.value)} placeholder="Fixture ID" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
          <input type="datetime-local" value={deadlineLocal} onChange={(e) => setDeadlineLocal(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
          <input value={deadlineNote} onChange={(e) => setDeadlineNote(e.target.value)} placeholder="Admin note (optional)" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
          <button onClick={setDeadline} disabled={!fixtureId.trim() || !deadlineLocal || Boolean(busy)} className="w-full rounded-xl bg-emerald-500 text-slate-950 font-black text-xs py-2.5 disabled:opacity-40">Set fixture deadline</button>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 space-y-2 max-h-80 overflow-y-auto">
          <div className="text-xs font-black text-white">Deadline Queue</div>
          {deadlines.length === 0 && <div className="text-[10px] text-slate-500 py-6 text-center">Deadline yo‘q.</div>}
          {deadlines.map((item: any) => <div key={item.fixtureId} className={`rounded-xl border p-3 ${stateClass(item.state)}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="text-[11px] font-black truncate">{item.homeClubName} vs {item.awayClubName}</div><div className="text-[9px] opacity-70 truncate">{item.competitionName} • MD {item.matchday}</div></div><span className="text-[9px] font-black">{item.state}</span></div><div className="text-[10px] mt-1">{tashkent(item.deadlineAt)}</div><div className="flex items-center justify-between mt-2"><span className="text-[9px] opacity-70">24h {item.reminder24SentAt ? '✓' : '–'} • 6h {item.reminder6SentAt ? '✓' : '–'} • overdue {item.overdueSentAt ? '✓' : '–'}</span><button onClick={() => run(`remind:${item.fixtureId}`, () => matchOpsApi.remindFixture(item.fixtureId, activeSeasonId), 'Reminder queued.')} disabled={Boolean(busy)} className="text-[9px] font-black underline disabled:opacity-40">Remind</button></div></div>)}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-amber-500/15 bg-amber-500/[0.035] p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-black text-amber-300"><AlertTriangle className="w-4 h-4" />No-show Review Queue ({openNoShows.length})</div>
          {openNoShows.length === 0 && <div className="text-[10px] text-slate-500 py-6 text-center">Open no-show report yo‘q.</div>}
          {openNoShows.slice(0, 20).map((report: any) => <div key={report.id} className="rounded-xl border border-white/[0.07] bg-slate-950/60 p-3 space-y-2"><div className="flex items-start justify-between gap-2"><div><div className="text-xs font-black text-white">{report.homeClubName || report.homeClubId} vs {report.awayClubName || report.awayClubId}</div><div className="text-[9px] text-slate-500">Reporter @{report.reporterUsername || report.reporterUserId} • {report.reporterSide || '—'} • MD {report.matchday || '—'}</div></div><span className="text-[9px] text-amber-300 font-black">{report.status}</span></div><div className="text-[10px] text-slate-300">{report.reason}</div>{report.evidenceUrl && <a href={report.evidenceUrl} target="_blank" rel="noreferrer" className="text-[10px] text-sky-300 inline-flex items-center gap-1"><FileImage className="w-3.5 h-3.5" />Evidence <ExternalLink className="w-3 h-3" /></a>}<div className="text-[9px] text-slate-500">Deadline snapshot: {tashkent(report.deadlineAt)}</div><div className="grid grid-cols-2 gap-1.5"><button onClick={() => resolveNoShow(report, 'WALKOVER_HOME')} disabled={Boolean(busy)} className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 py-2 text-[9px] font-black">Home 3–0</button><button onClick={() => resolveNoShow(report, 'WALKOVER_AWAY')} disabled={Boolean(busy)} className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 py-2 text-[9px] font-black">Away 0–3</button><input type="datetime-local" value={postponeDates[report.id] || localDateTimeValue(report.deadlineAt)} onChange={(e) => setPostponeDates((prev) => ({ ...prev, [report.id]: e.target.value }))} className="rounded-lg bg-slate-950 border border-slate-700 px-2 text-[9px] text-white" /><button onClick={() => resolveNoShow(report, 'POSTPONE')} disabled={Boolean(busy)} className="rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 py-2 text-[9px] font-black">Postpone</button><button onClick={() => resolveNoShow(report, 'REJECT')} disabled={Boolean(busy)} className="col-span-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 py-2 text-[9px] font-black">Reject report</button></div></div>)}
        </div>

        <div className="rounded-2xl border border-rose-500/15 bg-rose-500/[0.035] p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-black text-rose-300"><ShieldAlert className="w-4 h-4" />Dispute Center V2 ({disputes.length})</div>
          {disputes.length === 0 && <div className="text-[10px] text-slate-500 py-6 text-center">Open dispute yo‘q.</div>}
          {disputes.slice(0, 20).map((dispute: any) => { const fixture = dispute.fixture || {}; const home = dispute.homeSubmission; const away = dispute.awaySubmission; const score = manualScores[dispute.id] || { home: '', away: '' }; return <div key={dispute.id} className="rounded-xl border border-white/[0.07] bg-slate-950/60 p-3 space-y-2"><div className="flex items-start justify-between gap-2"><div><div className="text-xs font-black text-white">{fixture.homeClub?.name || fixture.homeClubId || 'Home'} vs {fixture.awayClub?.name || fixture.awayClubId || 'Away'}</div><div className="text-[9px] text-slate-500">{fixture.competitionName || fixture.competitionId} • {fixture.roundName || `MD ${fixture.matchday || '—'}`}</div></div><span className="text-[9px] text-rose-300 font-black">{dispute.status}</span></div><div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-black/20 p-2"><div className="text-[9px] text-slate-500">Home submission</div><div className="text-sm font-black text-white">{home ? `${home.homeScore}:${home.awayScore}` : '—'}</div>{proofLink(home)}</div><div className="rounded-lg bg-black/20 p-2"><div className="text-[9px] text-slate-500">Away submission</div><div className="text-sm font-black text-white">{away ? `${away.homeScore}:${away.awayScore}` : '—'}</div>{proofLink(away)}</div></div><div className="grid grid-cols-2 gap-1.5"><button onClick={() => resolveDispute(dispute, 'CONFIRM_HOME_SUBMISSION')} disabled={!home || Boolean(busy)} className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 py-2 text-[9px] font-black disabled:opacity-35">Use home</button><button onClick={() => resolveDispute(dispute, 'CONFIRM_AWAY_SUBMISSION')} disabled={!away || Boolean(busy)} className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 py-2 text-[9px] font-black disabled:opacity-35">Use away</button><input inputMode="numeric" value={score.home} onChange={(e) => setManualScores((prev) => ({ ...prev, [dispute.id]: { ...score, home: e.target.value } }))} placeholder="H" className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-xs text-white" /><input inputMode="numeric" value={score.away} onChange={(e) => setManualScores((prev) => ({ ...prev, [dispute.id]: { ...score, away: e.target.value } }))} placeholder="A" className="rounded-lg bg-slate-950 border border-slate-700 px-2 py-2 text-xs text-white" /><button onClick={() => resolveDispute(dispute, 'MANUAL_SCORE')} disabled={Boolean(busy)} className="rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 py-2 text-[9px] font-black">Manual score</button><button onClick={() => resolveDispute(dispute, 'CANCEL_MATCH')} disabled={Boolean(busy)} className="rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 py-2 text-[9px] font-black">Cancel match</button></div></div>; })}
        </div>
      </div>

      <div className="text-[9px] text-slate-600 flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />All mutations use existing official result/dispute pipelines; standings and read models stay consistent.</div>
    </section>
  );
};
