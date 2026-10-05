import React, { useEffect, useState } from 'react';
import { Calendar, Loader2, RefreshCw } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { MatchdayControlAction, MatchdayControlOverview } from '../../lib/matchdayState';

export function AdminMatchdayControl({ competitionId, onChanged }: { competitionId: string; onChanged: () => Promise<void> }) {
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<MatchdayControlOverview | null>(null);
  const [selected, setSelected] = useState(1);
  const [hours, setHours] = useState('30');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [blockers, setBlockers] = useState<{ id: string; status: string }[]>([]);
  const load = async (keepSelection = false) => {
    const result = await api.getMatchdayControl(competitionId);
    setState(result);
    if (!keepSelection) setSelected(result.currentMatchday);
  };
  const open = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true); setBusy(true); setError('');
    try { await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Tur holatini olish imkoni bo‘lmadi.'); }
    finally { setBusy(false); }
  };
  const act = async (action: MatchdayControlAction) => {
    if (!state) return;
    setBusy(true); setError(''); setFeedback(''); setBlockers([]);
    try {
      const result = await api.controlMatchday(competitionId, { action, matchday: selected, durationHours: Number(hours), expectedUpdatedAt: state.updatedAt });
      const updated = action === 'LOCK' ? `${selected}-tur yopildi.` : action === 'SELECT' ? `${selected}-tur faol qilindi va ochildi.` : `${selected}-tur holati va muddati yangilandi.`;
      setFeedback(updated + (result.channelPost === 'QUEUED' ? ' Kanal posti yuborish navbatiga qo‘yildi.' : result.channelPost === 'EXISTS' ? ' Bu turning kanal posti avval navbatga qo‘yilgan.' : ''));
      if (result.channelPost === 'FAILED') setError('Tur saqlandi, lekin kanal postini navbatga qo‘yib bo‘lmadi. Turni qayta ochish orqali takror urinishingiz mumkin.');
      await load(true);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Amalni bajarib bo‘lmadi.');
      if (err instanceof ApiError && Array.isArray(err.data?.blockers)) setBlockers(err.data.blockers);
      try { await load(true); } catch {}
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!expanded) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [expanded]);
  const selectedRound = state?.rounds.find(r => r.matchday === selected);
  const round = selectedRound ? { ...selectedRound, isOpen: selectedRound.isOpen && (!selectedRound.deadlineAt || Date.parse(selectedRound.deadlineAt) > now) } : undefined;
  const invalidHours = !Number.isFinite(Number(hours)) || Number(hours) <= 0 || Number(hours) > 720;
  const button = 'rounded-lg border border-white/10 bg-slate-800 px-2 py-2 text-[10px] font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40';
  return <div className="space-y-2">
    <button onClick={open} aria-expanded={expanded} disabled={busy} className={`${button} flex w-full items-center justify-center gap-1.5`}><Calendar className="h-3 w-3" />Tur boshqaruvi{busy && <Loader2 className="h-3 w-3 animate-spin" />}</button>
    {expanded && <div className="space-y-3 rounded-xl border border-white/10 bg-slate-950/50 p-3">
      {state && <>
        <div className="flex items-center justify-between text-[11px] text-slate-300"><span>Faol tur: <b>{state.currentMatchday}</b> / {state.totalMatchdays}</span><button aria-label="Tur holatini yangilash" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await load(true); } catch (err) { setError(err instanceof Error ? err.message : 'Yangilash xatosi'); } finally { setBusy(false); } }}><RefreshCw className="h-3 w-3" /></button></div>
        <label className="block space-y-1 text-[10px] text-slate-400"><span>Tur tanlash</span><select aria-label="Tur tanlash" value={selected} onChange={e => { setSelected(Number(e.target.value)); setFeedback(''); setError(''); setBlockers([]); }} disabled={busy} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white">{state.rounds.map(r => <option key={r.matchday} value={r.matchday}>{r.matchday}-tur · {r.isOpen && (!r.deadlineAt || Date.parse(r.deadlineAt) > now) ? 'Ochiq' : 'Yopiq'} · {r.unfinished.length} tugamagan</option>)}</select></label>
        <label className="block space-y-1 text-[10px] text-slate-400"><span>Muddat (soat)</span><input type="number" min="1" max="720" step="1" value={hours} onChange={e => setHours(e.target.value)} disabled={busy} className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-white" /></label>
        {round && <div className="space-y-1 text-[10px] text-slate-300"><p>{round.fixtureCount} ta o‘yin · {round.isOpen ? 'Ochiq' : 'Yopiq'}</p>{round.deadlineAt && <p>Muddat: {new Date(round.deadlineAt).toLocaleString('uz-UZ')}</p>}</div>}
        <button disabled={busy || invalidHours || !round?.fixtureCount} onClick={() => act('SELECT')} className={`${button} w-full border-indigo-500/30 text-indigo-300`}>Tanlangan turga o‘tish va ochish</button>
        <div className="grid grid-cols-2 gap-1.5">
          <button disabled={busy || invalidHours || !round?.fixtureCount} onClick={() => act('OPEN')} className={`${button} text-emerald-300`}>Turni ochish</button>
          <button disabled={busy || !round?.fixtureCount} onClick={() => act('LOCK')} className={`${button} text-rose-300`}>Turni yopish</button>
          <button disabled={busy || invalidHours || !round?.isOpen} onClick={() => act('EXTEND')} className={button}>Muddatni uzaytirish</button>
          <button disabled={busy || invalidHours || !round?.fixtureCount} onClick={() => act('RESTART')} className={button}>Muddatni qayta boshlash</button>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-500">Turga o‘tishda oldingi faol tur yopiladi. “Turni ochish” tanlangan turni alohida ochadi. Tasdiqlangan natijalar saqlanadi.</p>
        {!!round?.unfinished.length && <details className="text-[10px] text-amber-300"><summary className="cursor-pointer">{round.unfinished.length} ta tugamagan o‘yin</summary><ul className="mt-2 max-h-32 space-y-1 overflow-y-auto break-all text-slate-400">{round.unfinished.map(f => <li key={f.id}>{f.id} · {f.status}</li>)}</ul></details>}
      </>}
      {error && <p role="alert" className="text-[11px] text-rose-300">{error}</p>}
      {!!blockers.length && <ul className="max-h-32 space-y-1 overflow-y-auto break-all text-[10px] text-amber-300">{blockers.map(f => <li key={f.id}>{f.id} · {f.status}</li>)}</ul>}
      {feedback && <p role="status" className="text-[11px] text-emerald-300">{feedback}</p>}
      {!state && !busy && <button className={`${button} w-full`} onClick={async () => { setBusy(true); try { await load(); setError(''); } catch (err) { setError(err instanceof Error ? err.message : 'Qayta urinish xatosi'); } finally { setBusy(false); } }}>Qayta urinish</button>}
    </div>}
  </div>;
}
