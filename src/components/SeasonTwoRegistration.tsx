import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, ChevronRight, LockKeyhole, RefreshCw, ShieldCheck, Trophy, X } from 'lucide-react';
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
export function SeasonTwoRegistration({ onOpenLeagues }: { onOpenLeagues?: () => void } = {}) {
  const { user, setActiveSeasonId } = useAuth();
  const [status, setStatus] = useState<Admission | null>(null);
  const [mine, setMine] = useState<MyClubs | null>(null);
  const [time, setTime] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; choice: Decision } | null>(null);
  const pendingLoad = useRef<Promise<void> | null>(null);
  const lastLoadAt = useRef(0);
  const load = useCallback((force = false): Promise<void> => {
    if (pendingLoad.current && !force) return pendingLoad.current;
    lastLoadAt.current = Date.now();
    const work = (async () => {
      try {
        // Personal ownership is needed only once priority registration begins.
        // Do not serialize the public status and personalized reads.
        const personalRequest = Date.now() >= Date.parse(S2_OPENS_AT)
          ? readJson<MyClubs>('/api/season-two-admission/mine').catch(() => null)
          : Promise.resolve(null);
        const next = await readJson<Admission>('/api/season-two-admission/status');
        setStatus(next);
        if (next.registrationOpen) {
          const personal = await personalRequest;
          if (personal) setMine(personal);
        }
        setError('');
      } catch (e: any) { setError(e.message || 'Ma’lumotlar yuklanmadi'); }
    })();
    pendingLoad.current = work;
    void work.finally(() => { if (pendingLoad.current === work) pendingLoad.current = null; });
    return work;
  }, []);
  useEffect(() => {
    void load();
    // The countdown is visual-only: ticking must not trigger database traffic.
    const clock = window.setInterval(() => setTime(Date.now()), 1000);
    const refresh = window.setInterval(() => { if (!document.hidden) void load(); }, 60000);
    const onFocus = () => {
      setTime(Date.now());
      if (Date.now() - lastLoadAt.current > 15000) void load();
    };
    const boundaryTimers = [S2_OPENS_AT, S2_PUBLIC_AT]
      .map(at => Date.parse(at) - Date.now())
      .filter(delay => delay > 0 && delay <= 2147483647)
      .map(delay => window.setTimeout(() => void load(true), delay + 100));
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
      boundaryTimers.forEach(window.clearTimeout);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);
  const phase = time < Date.parse(S2_OPENS_AT) ? 'NOT_STARTED' :
    !status?.registrationOpen ? 'NOT_ACTIVATED' :
    time < Date.parse(S2_PUBLIC_AT) ? 'PRIORITY' : 'PUBLIC';
  async function activate() {
    setBusy('activate'); setError('');
    try { await readJson('/api/season-two-admission/activate', { method: 'POST' }); await load(true); setNotice('Qabul sozlamalari saqlandi.'); }
    catch (e: any) { setError(e.message || 'Qabul faollashtirilmadi'); }
    finally { setBusy(null); }
  }
  async function decide(id: string, choice: Decision) {
    setConfirm(null); setBusy(id); setError(''); setNotice('');
    try {
      await readJson('/api/season-two-admission/decision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clubId: id, choice }),
      });
      setNotice(choice === 'KEEP' ? 'Klubingiz 2-mavsum uchun saqlandi.' : '2-mavsum uchun klubdan voz kechildi.');
      await load(true);
    } catch (e: any) { setError(e.message || 'Qaror saqlanmadi'); }
    finally { setBusy(null); }
  }
  const ready = phase === 'PUBLIC';
  const priority = phase === 'PRIORITY';
  const statusLabel = phase === 'PUBLIC' ? 'UMUMIY QABUL' :
    phase === 'PRIORITY' ? 'USTUVOR TANLOV' :
    phase === 'NOT_STARTED' ? 'OCHILISH KUTILMOQDA' : 'QABUL TEKSHIRILMOQDA';
  const eligibleClubs = mine?.clubs.filter(c => c.eligible) || [];
  return (
    <section aria-label="EFL 2-mavsum klublar qabuli" className="relative isolate min-w-0 overflow-hidden rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface)] text-[var(--efl-text)] shadow-sm dark:shadow-black/20 transition-colors duration-200">
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-[.09] blur-3xl" style={{ background: 'var(--efl-primary)' }} />
      <div className="relative min-w-0 space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] shadow-xs dark:shadow-black/20">
              <Trophy size={23} strokeWidth={2} className="text-[var(--efl-primary)]" />
            </span>
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--efl-text-2)]">EFLUZ <span className="px-1 opacity-40">/</span> 2027–28</div>
              <h3 className="text-lg sm:text-xl font-black leading-snug tracking-tight text-[var(--efl-text)]">2-mavsum · Klub qabuli</h3>
            </div>
          </div>
          <span className="inline-flex min-h-[29px] items-center gap-1.5 rounded-full border border-[var(--efl-primary)]/25 bg-[var(--efl-primary-soft)] px-3 py-1 text-[10px] font-black tracking-wide text-[var(--efl-primary)] dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--efl-primary)]" />
            {statusLabel}
          </span>
        </header>

        {phase === 'NOT_ACTIVATED' && <div className="rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] px-3 py-3">
          <p className="flex items-start gap-2 text-xs text-[var(--efl-text-2)]"><LockKeyhole size={15} className="mt-0.5 shrink-0" /> Qabul hozircha faollashmagan. Holatni yangilab tekshiring.</p>
          {user?.isAdmin && <button type="button" disabled={!!busy} onClick={() => void activate()}
            className="mt-3 inline-flex min-h-[38px] items-center justify-center rounded-xl bg-[var(--efl-primary)] px-4 text-xs font-black text-white shadow-sm disabled:opacity-50 dark:text-white">
            Qabulni faollashtirish <ChevronRight size={15} className="ml-1" />
          </button>}
        </div>}

        {mine?.banned && <p role="alert" className="rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3 text-xs font-bold text-[var(--efl-text)]">Klub tanlash banningiz faol. Qabulda qatnasha olmaysiz.</p>}

        {priority && !mine?.banned && eligibleClubs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[11px] font-black uppercase tracking-widest text-[var(--efl-text-2)]">Sizning klublaringiz</h4>
            {eligibleClubs.map(club => <div key={club.clubId} className="rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface)]"><ShieldCheck size={17} className="text-[var(--efl-primary)]" /></span>
                  <strong className="min-w-0 break-words text-sm font-black text-[var(--efl-text)]">{clubNames.get(club.clubId) || club.clubId}</strong>
                </div>
                {club.choice && <span className="flex items-center gap-1 text-[10px] font-black text-[var(--efl-primary)]">{club.choice === 'KEEP' ? <CheckCircle2 size={15} /> : <X size={15} />}{club.choice === 'KEEP' ? 'SAQLANDI' : 'RAD ETILDI'}</span>}
              </div>
              {!club.choice && <div className="mt-3 grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                <button type="button" disabled={!!busy} onClick={() => setConfirm({ id: club.clubId, choice: 'KEEP' })}
                  className="flex min-h-[46px] min-w-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--efl-primary)] px-2 text-xs font-black text-white shadow-sm disabled:opacity-50"><Check size={16} /> Ha, qolaman</button>
                <button type="button" disabled={!!busy} onClick={() => setConfirm({ id: club.clubId, choice: 'RELEASE' })}
                  className="flex min-h-[46px] min-w-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface)] px-2 text-xs font-black text-[var(--efl-text)] disabled:opacity-50"><X size={16} /> Yo‘q, ketaman</button>
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

        {ready && !mine?.banned && <button type="button" onClick={() => { setActiveSeasonId(EFL_SECOND_SEASON.id); onOpenLeagues?.(); }}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--efl-primary)] px-4 text-sm font-black text-white shadow-sm dark:shadow-black/25 transition-[transform,opacity] duration-200 hover:opacity-90 active:scale-[.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--efl-primary)]">
          <Trophy size={18} /> 2-mavsum klublarini tanlash <ArrowRight size={18} />
        </button>}

        {notice && <p role="status" className="flex items-center gap-2 text-xs font-bold text-[var(--efl-primary)]"><CheckCircle2 size={16} />{notice}</p>}
        {error && <p role="alert" className="rounded-xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3 text-xs text-[var(--efl-text)]">{error}</p>}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--efl-border)] pt-3">
          <p className="text-[11px] leading-relaxed text-[var(--efl-text-2)]">1-mavsumdagi klub va o‘yinlar o‘zgarmaydi.</p>
          <button type="button" onClick={() => void load()} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold text-[var(--efl-text-2)] hover:text-[var(--efl-primary)]"><RefreshCw size={14} /> Yangilash</button>
        </footer>
      </div>
    </section>
  );
}
