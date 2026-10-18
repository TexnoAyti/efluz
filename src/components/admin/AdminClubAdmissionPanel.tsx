import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, LockKeyholeOpen, RefreshCw } from 'lucide-react';
import { api, type ClubAdmissionStatus } from '../../lib/api';
import { isLeagueSelectionOpen } from '../../lib/clubAdmission';
import { CompetitionMark } from '../CompetitionMark';

export function AdminClubAdmissionPanel({ seasonId }: { seasonId: string }) {
  const [admission, setAdmission] = useState<ClubAdmissionStatus | null>(null);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const currentSeason = useRef(seasonId); currentSeason.current = seasonId;
  const readVersion = useRef(0);

  const refresh = async () => {
    const version = ++readVersion.current;
    const requestedSeason = seasonId;
    try {
      const result = await api.getClubAdmission(requestedSeason);
      if (currentSeason.current !== requestedSeason || readVersion.current !== version) return;
      setAdmission(result.admission); setUnavailable(Boolean(result.unavailable)); setError('');
    } catch (err: any) {
      if (currentSeason.current === requestedSeason && readVersion.current === version) setError(err?.message || 'Qabul holati yuklanmadi.');
    }
  };
  useEffect(() => {
    setAdmission(null); setUnavailable(false); setError(''); setBusy(null); setNotice('');
    void refresh();
    return () => { readVersion.current++; };
  }, [seasonId]);

  const mutate = async (key: string, action: () => Promise<{ admission: ClubAdmissionStatus }>, message: string) => {
    if (!admission || busy) return;
    const requestedSeason = seasonId;
    readVersion.current++; setBusy(key); setError(''); setNotice('');
    try {
      const result = await action();
      if (currentSeason.current === requestedSeason) { setAdmission(result.admission); setUnavailable(false); setNotice(message); }
    } catch (err: any) {
      if (currentSeason.current !== requestedSeason) return;
      await refresh();
      if (currentSeason.current === requestedSeason) setError(err?.data?.message || err?.message || 'Holatni saqlab bo‘lmadi.');
    } finally { if (currentSeason.current === requestedSeason) setBusy(null); }
  };
  const next = admission?.leagues[admission.stage + 1];

  return <section className="glass-panel p-4 sm:p-5 space-y-4" aria-label="Liga bo‘yicha klub tanlash">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-sm font-black text-[var(--efl-text)]">Klub tanlashni boshqarish</h2><p className="mt-1 text-xs leading-relaxed text-[var(--efl-text-2)]">Har bir ligani alohida oching yoki yoping. Yopilganda yangi klub tanlanmaydi; mavjud klub egalari va o‘yinlar saqlanadi.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={Boolean(busy)} aria-label="Qabul holatini yangilash" className="shrink-0 p-2 rounded-xl border border-[var(--efl-border)] text-[var(--efl-text-2)] disabled:opacity-50"><RefreshCw size={16} /></button>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      {admission?.leagues.map(league => {
        const open = isLeagueSelectionOpen(admission, league.id);
        const Icon = open ? LockKeyholeOpen : LockKeyhole;
        return <div key={league.id} className="flex items-center gap-3 rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-3">
          <CompetitionMark competition={{ id: league.id, name: league.name, leagueId: league.id, type: 'LEAGUE' }} className="h-8 w-8" />
          <div className="min-w-0 flex-1"><h3 className="text-xs font-bold text-[var(--efl-text)] truncate">{league.name}</h3><span className="mt-1 flex items-center gap-1 text-[11px] text-[var(--efl-text-2)]"><Icon size={12} />{open ? 'Tanlash ochiq' : 'Tanlash yopiq'}</span></div>
          <button type="button" disabled={Boolean(busy) || unavailable} aria-label={`${league.name}: klub tanlashni ${open ? 'yopish' : 'ochish'}`} onClick={() => void mutate(league.id, () => api.setLeagueClubSelection(seasonId, league.id, !open, admission.revision ?? admission.updatedAt), `${league.name}: klub tanlash ${open ? 'yopildi' : 'ochildi'}.`)} className={`${open ? 'border border-[var(--efl-border)] text-[var(--efl-text)] hover:bg-[var(--efl-surface)]' : 'btn-glass-primary'} min-h-[40px] rounded-xl px-3 text-xs font-bold disabled:opacity-50`}>
            {busy === league.id ? 'Saqlanmoqda…' : open ? 'Yopish' : 'Ochish'}
          </button>
        </div>;
      })}
    </div>
    {!admission && <p role="status" className="text-xs text-[var(--efl-text-2)]">{unavailable || error ? 'Qabul holatini tekshirib bo‘lmadi. Yangilashni bosing.' : 'Holat yuklanmoqda…'}</p>}
    {admission && <details className="border-t border-[var(--efl-border)] pt-3 text-xs text-[var(--efl-text-2)]"><summary className="cursor-pointer font-bold">Ligalarni navbat bilan ochish</summary><p className="mt-2 leading-relaxed">Bu amal qo‘lda belgilangan holatlarni bekor qiladi va faqat navbatdagi ligani ochadi.</p>{admission.stage < admission.leagues.length && <button type="button" disabled={Boolean(busy) || unavailable} onClick={() => void mutate('advance', () => api.advanceClubAdmission(seasonId, admission.stage), 'Qabul bosqichi yangilandi.')} className="mt-2 btn-glass-primary rounded-xl px-3 py-2 font-bold disabled:opacity-50">{busy === 'advance' ? 'Saqlanmoqda…' : next ? `${next.name} qabulini ochish` : 'Qabulni yakunlash'}</button>}</details>}
    {admission?.stale && <p role="status" className="text-xs text-[var(--efl-muted)]">Oxirgi saqlangan holat ko‘rsatilmoqda. O‘zgartirishda server joriy holatni qayta tekshiradi.</p>}
    {notice && <p role="status" className="text-xs text-[var(--efl-primary)]">{notice}</p>}
    {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
  </section>;
}
