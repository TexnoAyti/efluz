import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, LockKeyhole, RefreshCw, ShieldCheck, Trophy, X } from 'lucide-react';
import { getSessionToken, getTelegramInitData, getDevUserId } from '../lib/api';
import { EFL_SECOND_SEASON } from '../lib/seasonPreparation';
import { useAuth } from '../context/AuthContext';
import { S2_OPENS_AT, S2_PUBLIC_AT } from '../lib/seasonTwoAdmissionWindow';

type Admission = { phase: 'NOT_ACTIVATED' | 'NOT_STARTED' | 'PRIORITY' | 'PUBLIC'; registrationOpen: boolean };
type MyClubs = { banned: boolean; clubs: { clubId: string; eligible: boolean; choice: 'KEEP' | 'RELEASE' | null }[] };
type Decision = 'KEEP' | 'RELEASE';
const clubNames = new Map(EFL_SECOND_SEASON.leagues.flatMap(l => l.roster.clubs.map(c => [c.id, c.name] as const)));
function authHeaders(): Record<string,string> {
  const token = getSessionToken();
  if (token) return { Authorization: `Bearer ${token}` };
  const telegram = getTelegramInitData();
  if (telegram) return { 'x-telegram-init-data': telegram };
  const dev = getDevUserId();
  return dev ? { 'x-dev-user-id': dev } : {};
}
async function readJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init, headers: { ...authHeaders(), ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.code || body.message || 'So‘rov bajarilmadi');
  return body;
}
export function SeasonTwoRegistration() {
  const { user, setActiveSeasonId } = useAuth();
  const [status, setStatus] = useState<Admission | null>(null);
  const [mine, setMine] = useState<MyClubs | null>(null);
  const [time, setTime] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; choice: Decision } | null>(null);
  const load = useCallback(async () => {
    try {
      const next = await readJson<Admission>('/api/season-two-admission/status');
      setStatus(next);
      if (next.registrationOpen) {
        const personal = await readJson<MyClubs>('/api/season-two-admission/mine');
        setMine(personal);
      }
      setError('');
    } catch (e: any) { setError(e.message || 'Ma’lumotlar yuklanmadi'); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      setTime(Date.now());
      void load();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  const phase = !status?.registrationOpen ? 'NOT_ACTIVATED' :
    time < Date.parse(S2_OPENS_AT) ? 'NOT_STARTED' : time < Date.parse(S2_PUBLIC_AT) ? 'PRIORITY' : 'PUBLIC';
  const remaining = Math.max(0, Math.ceil((Date.parse(phase === 'NOT_STARTED' ? S2_OPENS_AT : S2_PUBLIC_AT) - time) / 1000));
  const display = `${String(Math.floor(remaining / 60)).padStart(2,'0')}:${String(remaining % 60).padStart(2,'0')}`;
  async function activate() {
    setBusy('activate'); setError('');
    try { await readJson('/api/season-two-admission/activate', { method: 'POST' }); await load(); setNotice('Qabul sozlamalari saqlandi. Ustuvor tanlov 20:00 da ochiladi.'); }
    catch (e: any) { setError(e.message || 'Qabul faollashtirilmadi'); }
    finally { setBusy(null); }
  }
  async function decide(id: string, choice: Decision) {
    setConfirm(null); setBusy(id); setError(''); setNotice('');
    try {
      await readJson('/api/season-two-admission/decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clubId: id, choice }),
      });
      setNotice(choice === 'KEEP' ? 'Klubingiz 2-mavsum uchun saqlandi.' : '2-mavsum uchun klubdan voz kechildi. Umumiy qabulni kuting.');
      await load();
    } catch (e: any) { setError(e.message || 'Qaror saqlanmadi'); }
    finally { setBusy(null); }
  }
  const ready = phase === 'PUBLIC';
  const priority = phase === 'PRIORITY';
  const statusLabel = phase === 'PUBLIC' ? 'UMUMIY QABUL' :
    phase === 'PRIORITY' ? 'USTUVOR TANLOV' :
    phase === 'NOT_STARTED' ? 'OCHILISH KUTILMOQDA' : 'FAOLLASHTIRILMOQDA';
  const eligibleClubs = mine?.clubs.filter(c => c.eligible) || [];
  return (
    <section aria-label="EFL 2-mavsum klublar qabuli" className="relative isolate overflow-hidden rounded-[22px] border border-[var(--efl-border)] bg-[var(--efl-surface)] shadow-sm">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-[.09] blur-3xl" style={{ background: 'var(--efl-primary)' }} />
      <div className="relative space-y-4 p-4 sm:p-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] shadow-xs">
              <Trophy size={23} strokeWidth={2} className="text-[var(--efl-primary)]" />
            </span>
            <div>
              <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--efl-text-2)]">EFLUZ <span className="px-1 opacity-40">/</span> 2027–28</div>
              <h3 className="text-xl font-black tracking-tight text-[var(--efl-text)]">2-mavsum · Klub qabuli</h3>
            </div>
          </div>
          <span className="inline-flex min-h-[29px] items-center gap-1.5 rounded-full border border-[var(--efl-border)] bg-[var(--efl-surface-2)] px-3 py-1 text-[10px] font-black tracking-wide text-[var(--efl-primary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--efl-primary)]" />
            {statusLabel}
          </span>
        </header>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--efl-text-2)]"><ShieldCheck size={14} /> Klub egalari</div>
            <div className="mt-1.5 text-lg font-black tabular-nums text-[var(--efl-text)]">20:00 <span className="text-[11px] text-[var(--efl-text-2)]">– 20:15</span></div>
            <p className="mt-1 text-[10px] text-[var(--efl-text-2)]">Klubni saqlash huquqi</p>
          </div>
          <div className="rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--efl-text-2)]"><CalendarDays size={14} /> Barcha o‘yinchilar</div>
            <div className="mt-1.5 text-lg font-black tabular-nums text-[var(--efl-text)]">20:15 <span className="text-[11px] text-[var(--efl-text-2)]">dan</span></div>
            <p className="mt-1 text-[10px] text-[var(--efl-text-2)]">Bo‘sh klublarni tanlash</p>
          </div>
        </div>

        {(phase === 'NOT_STARTED' || priority) && (
          <div className="flex items-center justify-between rounded-xl border border-[var(--efl-border)] bg-[var(--efl-primary-soft)] px-3 py-3">
            <span className="flex items-center gap-2 text-xs font-bold text-[var(--efl-text)]"><Clock3 size={16} className="text-[var(--efl-primary)]" /> {priority ? 'Ustuvor muddat tugashiga' : 'Qabul ochilishigacha'}</span>
            <span className="font-mono text-xl font-black tabular-nums tracking-tight text-[var(--efl-primary)]">{display}</span>
          </div>
        )}

        {phase === 'NOT_ACTIVATED' && <div className="rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] px-3 py-3">
          <p className="flex items-start gap-2 text-xs text-[var(--efl-text-2)]"><LockKeyhole size={15} className="mt-0.5 shrink-0" /> Qabul hali faollashmagan. Belgilangan vaqtda avtomatik ochilishi sozlangan.</p>
          {user?.isAdmin && <button type="button" disabled={!!busy} onClick={() => void activate()}
            className="mt-3 inline-flex min-h-[38px] items-center justify-center rounded-xl bg-[var(--efl-primary)] px-4 text-xs font-black text-white shadow-sm disabled:opacity-50">
            Qabulni faollashtirish <ChevronRight size={15} className="ml-1" />
          </button>}
        </div>}

        {mine?.banned && <p role="alert" className="rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3 text-xs font-bold text-[var(--efl-text)]">Klub tanlash banningiz faol. Qabulda qatnasha olmaysiz.</p>}

        {priority && !mine?.banned && eligibleClubs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-[var(--efl-text-2)]">Sizning klublaringiz</h4>
            {eligibleClubs.map(club => <div key={club.clubId} className="rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface)]"><ShieldCheck size={17} className="text-[var(--efl-primary)]" /></span>
                  <strong className="truncate text-sm font-black text-[var(--efl-text)]">{clubNames.get(club.clubId) || club.clubId}</strong>
                </div>
                {club.choice && <span className="flex items-center gap-1 text-[10px] font-black text-[var(--efl-primary)]">{club.choice === 'KEEP' ? <CheckCircle2 size={15} /> : <X size={15} />}{club.choice === 'KEEP' ? 'SAQLANDI' : 'RAD ETILDI'}</span>}
              </div>
              {!club.choice && <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={!!busy} onClick={() => setConfirm({ id: club.clubId, choice: 'KEEP' })}
                  className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-[var(--efl-primary)] px-2 text-xs font-black text-white shadow-sm disabled:opacity-50"><Check size={16} /> Ha, qolaman</button>
                <button type="button" disabled={!!busy} onClick={() => setConfirm({ id: club.clubId, choice: 'RELEASE' })}
                  className="flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface)] px-2 text-xs font-black text-[var(--efl-text)] disabled:opacity-50"><X size={16} /> Yo‘q, ketaman</button>
              </div>}
            </div>)}
          </div>
        )}

        {confirm && <div className="rounded-xl border border-[var(--efl-primary)]/40 bg-[var(--efl-primary-soft)] p-3">
          <p className="text-xs font-bold text-[var(--efl-text)]">{clubNames.get(confirm.id)} — {confirm.choice === 'KEEP' ? '2-mavsum uchun saqlansinmi?' : '2-mavsumda klubni bo‘shatishni tasdiqlaysizmi?'}</p>
          <p className="mt-1 text-[11px] text-[var(--efl-text-2)]">Bu qaror 1-mavsumdagi klubingizga ta’sir qilmaydi.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void decide(confirm.id, confirm.choice)} className="min-h-[38px] rounded-xl bg-[var(--efl-primary)] px-4 text-xs font-black text-white">Tasdiqlash</button>
            <button type="button" onClick={() => setConfirm(null)} className="min-h-[38px] rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface)] px-4 text-xs font-bold text-[var(--efl-text)]">Bekor qilish</button>
          </div>
        </div>}

        {ready && !mine?.banned && <button type="button" onClick={() => setActiveSeasonId(EFL_SECOND_SEASON.id)}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--efl-primary)] px-4 text-sm font-black text-white shadow-sm transition hover:opacity-90">
          <Trophy size={18} /> 2-mavsum klublarini tanlash <ArrowRight size={18} />
        </button>}

        {notice && <p role="status" className="flex items-center gap-2 text-xs font-bold text-[var(--efl-primary)]"><CheckCircle2 size={16} />{notice}</p>}
        {error && <p role="alert" className="rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3 text-xs text-[var(--efl-text)]">{error}</p>}

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--efl-border)] pt-3">
          <p className="text-[11px] leading-relaxed text-[var(--efl-text-2)]">1-mavsumdagi klub va o‘yinlar o‘zgarmaydi.</p>
          <button type="button" onClick={() => void load()} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[var(--efl-text-2)] hover:text-[var(--efl-primary)]"><RefreshCw size={14} /> Yangilash</button>
        </footer>
      </div>
    </section>
  );
}
