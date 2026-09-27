import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock3,
  ExternalLink,
  FileImage,
  Flag,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Swords,
  TimerReset,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { matchOpsApi } from '../lib/matchOpsApi';
import { seasonOpsApi } from '../lib/seasonOpsApi';
import { ClubCrest } from './ClubCrest';
import { PremiumClubBadge } from './PremiumClubBadge';

function tashkent(value?: string | null) {
  if (!value) return 'Deadline belgilanmagan';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date) + ' (Toshkent)';
}

function deadlineTone(state?: string) {
  if (state === 'OVERDUE') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  if (state === 'DUE_6H') return 'border-orange-500/30 bg-orange-500/10 text-orange-300';
  if (state === 'DUE_24H') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (state === 'CLOSED') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  return 'border-slate-700 bg-slate-900/70 text-slate-300';
}

function submissionLabel(submission: any) {
  if (!submission) return 'Yuborilmagan';
  return `${submission.homeScore ?? '–'} : ${submission.awayScore ?? '–'}`;
}

export const MatchOperationsV4Panel: React.FC = () => {
  const { activeSeasonId, currentClub, showToast } = useAuth();
  const [data, setData] = useState<any>(null);
  const [selectedId, setSelectedId] = useState('');
  const [h2h, setH2h] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('Raqib javob bermayapti yoki kelishilgan vaqtda o‘yinga chiqmagan.');
  const [evidenceUrl, setEvidenceUrl] = useState('');

  const load = async (soft = false) => {
    if (!soft) setLoading(true);
    try {
      const result = await matchOpsApi.my(activeSeasonId);
      setData(result);
      const rows = result.rows || [];
      const keep = rows.find((row: any) => row.fixture.id === selectedId);
      const next = keep || rows.find((row: any) => !['CONFIRMED', 'CANCELLED'].includes(row.fixture.status)) || rows[0];
      if (next) setSelectedId(next.fixture.id);
    } catch (error: any) {
      showToast?.(error?.message || 'Match Operations yuklanmadi.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(false); }, [activeSeasonId, currentClub?.id]);

  const selected = useMemo(() => (data?.rows || []).find((row: any) => row.fixture.id === selectedId) || null, [data, selectedId]);

  useEffect(() => {
    const fixture = selected?.fixture;
    if (!fixture || !currentClub?.id || !fixture.homeClubId || !fixture.awayClubId) {
      setH2h(null);
      return;
    }
    const opponent = fixture.homeClubId === currentClub.id ? fixture.awayClubId : fixture.homeClubId;
    if (!opponent) return;
    seasonOpsApi.h2h(currentClub.id, opponent, activeSeasonId).then(setH2h).catch(() => setH2h(null));
  }, [selectedId, currentClub?.id, activeSeasonId]);

  const reportNoShow = async () => {
    if (!selected || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const result = await matchOpsApi.reportNoShow(selected.fixture.id, reason.trim(), evidenceUrl.trim() || null, activeSeasonId);
      showToast?.(result.duplicate ? 'Bu match uchun no-show report allaqachon ochilgan.' : 'No-show report adminga yuborildi.', 'success');
      setEvidenceUrl('');
      await load(true);
    } catch (error: any) {
      showToast?.(error?.message || 'No-show report yuborilmadi.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="glass-panel p-5 flex items-center justify-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2 text-emerald-400" />Match Operations yuklanmoqda…</div>;
  }
  if (!data?.rows?.length) return null;

  const fixture = selected?.fixture;
  const deadline = selected?.deadline;
  const report = selected?.noShowReport;
  const conflict = fixture?.status === 'DISPUTED';

  return (
    <section data-match-operations-v4 className="glass-panel p-4 sm:p-5 border-cyan-500/15 space-y-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-400"><Swords className="w-4 h-4" />Match Center V4</div>
          <h3 className="text-lg font-black text-white mt-1">Deadline • H2H • Evidence • No-show</h3>
          <p className="text-[10px] text-slate-500 mt-1">24h / 6h Telegram reminders event-driven ishlaydi; minute-level cron yo‘q.</p>
        </div>
        <button onClick={() => load(true)} className="p-2 rounded-xl bg-white/[0.04] text-slate-400 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white">
        {(data.rows || []).map((row: any) => (
          <option key={row.fixture.id} value={row.fixture.id}>
            {row.fixture.competitionName || row.fixture.competitionId} • {row.fixture.homeClub?.name || row.fixture.homeClubId} vs {row.fixture.awayClub?.name || row.fixture.awayClubId} • {row.fixture.status}
          </option>
        ))}
      </select>

      {fixture && (
        <>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-white/[0.06] bg-slate-950/50 p-4">
            <div className="flex items-center gap-2 min-w-0"><ClubCrest clubId={fixture.homeClubId} logoUrl={fixture.homeClub?.logoUrl} name={fixture.homeClub?.name} size="sm" /><div className="min-w-0"><div className="text-xs font-black text-white truncate">{fixture.homeClub?.name || fixture.homeClubId}</div><PremiumClubBadge clubId={fixture.homeClubId} /><div className="text-[9px] text-slate-500">HOME</div></div></div>
            <div className="text-center"><div className="text-[9px] text-slate-600 font-bold">{fixture.competitionName}</div><div className="text-lg font-black text-white">{fixture.status === 'CONFIRMED' ? `${fixture.homeScore} : ${fixture.awayScore}` : 'VS'}</div><div className="text-[9px] text-slate-500">{fixture.roundName || `MD ${fixture.matchday}`}</div></div>
            <div className="flex items-center justify-end gap-2 min-w-0 text-right"><div className="min-w-0"><div className="text-xs font-black text-white truncate">{fixture.awayClub?.name || fixture.awayClubId}</div><PremiumClubBadge clubId={fixture.awayClubId} /><div className="text-[9px] text-slate-500">AWAY</div></div><ClubCrest clubId={fixture.awayClubId} logoUrl={fixture.awayClub?.logoUrl} name={fixture.awayClub?.name} size="sm" /></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={`rounded-2xl border p-4 ${deadlineTone(deadline?.state)}`}>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase"><Clock3 className="w-4 h-4" />Deadline</div>
              <div className="text-xs font-bold mt-2">{tashkent(deadline?.deadlineAt)}</div>
              <div className="text-[10px] opacity-80 mt-1">{deadline?.state || 'NONE'}{deadline?.reminder24SentAt ? ' • 24h ✓' : ''}{deadline?.reminder6SentAt ? ' • 6h ✓' : ''}</div>
            </div>

            <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase text-violet-300"><UsersRound className="w-4 h-4" />Head-to-Head</div>
              {h2h?.summary?.played > 0 ? <div className="mt-2"><div className="text-lg font-black text-white">{h2h.summary.aWins}–{h2h.summary.draws}–{h2h.summary.bWins}</div><div className="text-[10px] text-slate-400">Goals {h2h.summary.aGoals}:{h2h.summary.bGoals} • {h2h.summary.played} games</div></div> : <div className="text-[10px] text-slate-500 mt-3">Oldingi uchrashuv yo‘q.</div>}
            </div>

            <div className={`rounded-2xl border p-4 ${conflict ? 'border-rose-500/30 bg-rose-500/10' : 'border-white/[0.07] bg-white/[0.03]'}`}>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-300"><ShieldAlert className="w-4 h-4" />Verification</div>
              <div className="text-xs font-bold text-white mt-2">{conflict ? 'RESULT DISPUTED' : fixture.status}</div>
              <div className="text-[10px] text-slate-500 mt-1">Siz: {submissionLabel(fixture.userSubmission)} • Raqib: {submissionLabel(fixture.opponentSubmission)}</div>
            </div>
          </div>

          {(fixture.userSubmission || fixture.opponentSubmission) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[['Sizning submission', fixture.userSubmission], ['Raqib submission', fixture.opponentSubmission]].map(([label, submission]: any) => submission && (
                <div key={label} className="rounded-xl border border-white/[0.06] bg-black/20 p-3 flex items-center justify-between gap-2">
                  <div><div className="text-[10px] text-slate-500">{label}</div><div className="text-sm font-black text-white">{submissionLabel(submission)}</div></div>
                  {submission.proofUrl && <a href={submission.proofUrl} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-sky-300 flex items-center gap-1"><FileImage className="w-3.5 h-3.5" />Proof <ExternalLink className="w-3 h-3" /></a>}
                </div>
              ))}
            </div>
          )}

          {!['CONFIRMED', 'CANCELLED'].includes(fixture.status) && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-black text-amber-300"><Flag className="w-4 h-4" />No-show / Opponent unavailable</div>{report && <span className="text-[9px] font-black px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300">{report.status}</span>}</div>
              {report && ['OPEN', 'UNDER_REVIEW'].includes(report.status) ? (
                <div className="text-[11px] text-slate-300">Report yuborilgan: <strong>{report.reason}</strong>{report.evidenceUrl && <a href={report.evidenceUrl} target="_blank" rel="noreferrer" className="ml-2 text-sky-300 underline">Evidence</a>}</div>
              ) : (
                <>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="w-full min-h-20 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
                  <input value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="Evidence URL (https://...) — optional" className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white" />
                  <button onClick={reportNoShow} disabled={busy || !selected?.canReportNoShow} className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs py-2.5 disabled:opacity-40 flex items-center justify-center gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}Send no-show report</button>
                </>
              )}
            </div>
          )}

          {deadline?.state === 'OVERDUE' && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] text-rose-200 flex items-center gap-2"><TimerReset className="w-4 h-4 shrink-0" />Deadline o‘tgan. Natijani yuboring yoki no-show report oching.</div>}
        </>
      )}
    </section>
  );
};
