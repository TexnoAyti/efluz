import React, { useCallback, useEffect, useState } from 'react';
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
  return <section className="rounded-2xl border border-white/10 bg-[#111522] p-4 sm:p-5 text-white space-y-3" aria-label="EFL 2-mavsum qabuli">
    <div className="flex items-center justify-between gap-3">
      <div><div className="text-[10px] font-bold uppercase tracking-[.16em] text-amber-400">EFL · 2027/28</div>
        <h3 className="text-lg font-black mt-1">2-mavsum · Klub qabuli</h3></div>
      <span className="rounded-full border border-white/15 px-3 py-1 text-[11px] font-bold text-white/75">
        {phase === 'PRIORITY' ? 'Ustuvor tanlov' : phase === 'PUBLIC' ? 'Umumiy qabul' : '20:00 da boshlanadi'}
      </span>
    </div>
    <p className="text-xs text-white/60">1-mavsum davom etadi. Bu qaror faqat 2-mavsumga tegishli.</p>
    {phase === 'NOT_STARTED' && <div className="text-sm font-bold">Ustuvor qabul ochilishigacha: <span className="tabular-nums text-amber-300">{display}</span></div>}
    {phase === 'PRIORITY' && <div className="text-sm font-bold">Klubni saqlash muddati: <span className="tabular-nums text-amber-300">{display}</span></div>}
    {phase === 'NOT_ACTIVATED' && <div className="space-y-2"><p className="text-xs text-amber-300">2-mavsum qabuli hali faollashtirilmagan.</p>{user?.isAdmin && <button className="rounded-lg border border-amber-400/40 px-3 py-2 text-xs font-bold text-amber-300 disabled:opacity-50" disabled={!!busy} onClick={() => void activate()}>Qabulni 20:00 uchun faollashtirish (asosiy admin)</button>}</div>}
    {mine?.banned && <p role="alert" className="text-sm text-rose-300">Klub tanlash banningiz faol. Ushbu qabulda ishtirok eta olmaysiz.</p>}
    {!mine?.banned && phase === 'PRIORITY' && mine?.clubs.filter(c => c.eligible).map(club =>
      <div key={club.clubId} className="rounded-xl border border-white/10 bg-white/[.04] p-3">
        <strong className="text-sm">{clubNames.get(club.clubId) || club.clubId}</strong>
        {club.choice ? <p className="text-xs mt-2 text-emerald-300">{club.choice === 'KEEP' ? '2-mavsum uchun saqlandi' : 'Rad etildi · 20:15 da umumiy tanlov'}</p> :
          <div className="flex gap-2 mt-3">
            <button className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black text-black disabled:opacity-50" disabled={!!busy}
              onClick={() => setConfirm({ id: club.clubId, choice: 'KEEP' })}>Ha, qolaman</button>
            <button className="rounded-lg border border-white/20 px-4 py-2 text-xs font-bold disabled:opacity-50" disabled={!!busy}
              onClick={() => setConfirm({ id: club.clubId, choice: 'RELEASE' })}>Yo‘q, ketaman</button>
          </div>}
      </div>)}
    {confirm && <div className="rounded-xl border border-amber-400/30 p-3 space-y-2">
      <p className="text-xs">Qaroringiz yakuniy: {clubNames.get(confirm.id)} — {confirm.choice === 'KEEP' ? 'saqlansinmi?' : '2-mavsumda bo‘shatilsinmi?'}</p>
      <div className="flex gap-2"><button className="rounded-lg bg-amber-400 text-black font-bold text-xs px-3 py-2" onClick={() => void decide(confirm.id, confirm.choice)}>Tasdiqlash</button>
      <button className="rounded-lg border border-white/20 text-xs px-3 py-2" onClick={() => setConfirm(null)}>Bekor qilish</button></div>
    </div>}
    {phase === 'PUBLIC' && !mine?.banned && <div className="space-y-2"><p className="text-xs text-white/70">Umumiy klub qabuli ochildi. Bo‘sh klublarni ko‘rishingiz mumkin.</p><button className="rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-black text-black" onClick={() => setActiveSeasonId(EFL_SECOND_SEASON.id)}>2-mavsum klublarini tanlash</button></div>}
    {notice && <p role="status" className="text-xs text-emerald-300">{notice}</p>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    <button className="text-xs font-semibold text-white/60 underline" onClick={() => void load()}>Yangilash</button>
  </section>;
}
