import { useEffect, useState } from 'react';
import { api, type ClubAdmissionStatus } from '../../lib/api';

export function AdminClubAdmissionPanel({ seasonId }: { seasonId: string }) {
  const [admission, setAdmission] = useState<ClubAdmissionStatus | null>(null);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    setAdmission(null);
    setUnavailable(false);
    setError('');
    api.getClubAdmission(seasonId).then(({ admission: status, unavailable: degraded }) => {
      if (mounted) { setAdmission(status); setUnavailable(Boolean(degraded)); }
    }).catch((err) => { if (mounted) setError(err?.message || 'Qabul holati yuklanmadi.'); });
    return () => { mounted = false; };
  }, [seasonId]);

  const next = admission?.leagues[admission.stage + 1];
  const advance = async () => {
    if (!admission || busy || !next && admission.stage !== admission.leagues.length - 1) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.advanceClubAdmission(seasonId, admission.stage);
      setAdmission(result.admission);
    } catch (err: any) {
      setError(err?.data?.message || err?.message || 'Bosqichni o‘zgartirib bo‘lmadi.');
      try {
        const refreshed = await api.getClubAdmission(seasonId);
        setAdmission(refreshed.admission);
        setUnavailable(Boolean(refreshed.unavailable));
      } catch { /* Retain last known state. */ }
    } finally {
      setBusy(false);
    }
  };

  return <section className="glass-panel p-4 space-y-3" aria-label="Liga bo‘yicha klub qabuli">
    <div>
      <h2 className="text-sm font-black text-white">Liga bo‘yicha klub qabuli</h2>
      <p className="mt-1 text-xs text-slate-400">Har safar faqat bitta liga ochiq bo‘ladi. Keyingi ligani ochish avvalgisini yopadi; mavjud klub egalari saqlanadi.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      {admission?.leagues.map((league, index) => <span key={league.id} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${admission.stage === index ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300' : 'border-white/10 text-slate-400'}`}>{index + 1}. {league.name}{admission.stage === index ? ' · Ochiq' : admission.stage > index ? ' · Yopilgan' : ' · Navbatda'}</span>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-slate-300">{!admission ? unavailable || error ? 'Qabul holati hozircha tekshirib bo‘lmadi.' : 'Holat yuklanmoqda…' : !admission.enabled ? 'Bosqichli qabul hali boshlanmagan.' : admission.activeLeagueId ? `Hozir: ${admission.leagues[admission.stage].name}` : 'Qabul yakunlangan.'}</span>
      {admission && admission.stage < admission.leagues.length && <button type="button" onClick={advance} disabled={busy || admission.stale} className="btn-glass-primary px-3 py-2 text-xs font-black disabled:opacity-50">{busy ? 'Saqlanmoqda…' : next ? `${next.name} qabulini ochish` : 'Klub qabulini yakunlash'}</button>}
    </div>
    {admission?.stale && <p role="status" className="text-xs text-amber-300">Oxirgi saqlangan qabul holati ko‘rsatilmoqda. Firestore tiklangach bosqichni o‘zgartirish mumkin.</p>}
    {unavailable && <p role="status" className="text-xs text-amber-300">Baza vaqtincha javob bermayapti. Qabul bosqichi noma’lum; tekshiruv tiklanguncha o‘zgartirish bloklangan.</p>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
  </section>;
}
