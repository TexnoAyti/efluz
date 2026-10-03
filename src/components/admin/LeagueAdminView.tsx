import React, { useEffect, useState } from 'react';
import type { AdminPermissions, Club, Competition, Fixture } from '../../types';
import { permittedAdminLeagues } from '../../lib/adminPermissions';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

export const LeagueAdminView: React.FC<{ permissions: AdminPermissions }> = ({ permissions }) => {
  const { activeSeasonId, showToast } = useAuth();
  const leagues = permittedAdminLeagues({ adminPermissions: permissions });
  const [leagueId, setLeagueId] = useState(leagues[0]?.id || '');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [tab, setTab] = useState<'clubs' | 'fixtures' | 'rounds'>('fixtures');
  const [round, setRound] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [assignClub, setAssignClub] = useState<Club | null>(null);
  const [username, setUsername] = useState('');
  const [scoreFixture, setScoreFixture] = useState<Fixture | null>(null);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [notes, setNotes] = useState('');
  const [reload, setReload] = useState(0);
  const league = leagues.find(item => item.id === leagueId);
  const competition = competitions.find(item => item.id === league?.competitionId);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    api.getLeagueAdminOverview(activeSeasonId).then(data => {
      if (cancelled) return;
      setClubs(data.clubs); setFixtures(data.fixtures); setCompetitions(data.competitions);
    }).catch(err => { if (!cancelled) setError(err.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeSeasonId, reload]);
  useEffect(() => { setRound(competition?.currentMatchday || 1); setAssignClub(null); setScoreFixture(null); }, [leagueId, competition?.currentMatchday]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); setAssignClub(null); setScoreFixture(null); setReload(value => value + 1); showToast('Saqlandi.', 'success'); }
    catch (err: any) { showToast(err.message || 'Amal bajarilmadi.', 'error'); }
    finally { setBusy(false); }
  };
  const button = 'rounded-xl px-3 py-2 bg-slate-800 text-sm text-white disabled:opacity-50';
  if (!leagues.length) return <p role="alert" className="p-6 text-slate-300">Sizga boshqarish uchun liga biriktirilmagan.</p>;
  return <div className="space-y-5 text-white p-4">
    <div className="glass-panel p-4 space-y-3">
      <h1 className="font-bold text-xl">Liga boshqaruvi</h1>
      <label className="flex items-center gap-3">Liga <select className="bg-slate-900 p-2 rounded-xl" value={leagueId} onChange={event => setLeagueId(event.target.value)}>{leagues.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="flex flex-wrap gap-2">{(['fixtures', 'clubs', 'rounds'] as const).map(item => <button key={item} className={button} aria-pressed={tab === item} onClick={() => setTab(item)}>{({ fixtures: 'O‘yinlar va natijalar', clubs: 'Klublar', rounds: 'Turlar' })[item]}</button>)}<button className={button} disabled={loading || busy} onClick={() => setReload(value => value + 1)}>Yangilash</button></div>
    </div>
    {loading && <p role="status">Yuklanmoqda...</p>}
    {error && <p role="alert" className="text-rose-400">{error}</p>}
    {!loading && !error && tab === 'clubs' && <div className="grid sm:grid-cols-2 gap-3">{clubs.filter(club => club.leagueId === leagueId).map(club => <div className="glass-panel p-4 space-y-2" key={club.id}>
      <h2 className="font-bold">{club.name}</h2><p className="text-sm text-slate-400">{club.claimedByUsername || club.occupancy?.username || (club.isTaken ? 'Band' : 'Bo‘sh')}</p>
      <div className="flex gap-2"><button disabled={busy} className={button} onClick={() => { setAssignClub(club); setUsername(''); }}>Biriktirish</button>{club.isTaken && <button disabled={busy} className={button} onClick={() => run(() => api.adminReleaseClub(club.id, activeSeasonId))}>Bo‘shatish</button>}</div>
    </div>)}</div>}
    {!loading && !error && tab === 'fixtures' && <div className="space-y-3">
      <label className="flex gap-3 items-center">Tur <select value={round} onChange={event => setRound(Number(event.target.value))} className="bg-slate-900 p-2 rounded-xl">{Array.from({ length: competition?.totalMatchdays || 19 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
      {fixtures.filter(fixture => fixture.competitionId === league?.competitionId && fixture.matchday === round).map(fixture => <div key={fixture.id} className="glass-panel p-4 space-y-2">
        <h2 className="font-bold">{fixture.homeClub?.name || fixture.homeClubId} — {fixture.awayClub?.name || fixture.awayClubId}</h2>
        <p className="text-sm text-slate-400">{fixture.homeScore ?? '–'} : {fixture.awayScore ?? '–'} · {fixture.status}</p>
        <div className="flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={() => { setScoreFixture(fixture); setHomeScore(fixture.homeScore || 0); setAwayScore(fixture.awayScore || 0); setNotes(''); }}>Natijani tasdiqlash / tuzatish</button><button disabled={busy} className={button} onClick={() => run(() => api.reopenFixture(fixture.id, 'Liga admini o‘yinni qayta ochdi'))}>Qayta ochish</button></div>
      </div>)}
    </div>}
    {!loading && !error && tab === 'rounds' && competition && <div className="glass-panel p-4 space-y-3">
      <h2 className="font-bold">{league?.name} · {competition.currentMatchday || 1}-tur</h2>
      <div className="flex flex-wrap gap-2">{(['FORCE_OPEN', 'FORCE_LOCKED', 'PAUSED', 'AUTO'] as const).map(status => <button key={status} disabled={busy} className={button} onClick={() => run(() => api.overrideCompetitionMatchday(competition.id, status, { seasonId: activeSeasonId }))}>{({ FORCE_OPEN: 'Ochish', FORCE_LOCKED: 'Yopish', PAUSED: 'Pauza', AUTO: 'Avtomatik' })[status]}</button>)}<button className={button} disabled={busy} onClick={() => run(() => api.advanceCompetitionMatchday(competition.id))}>Keyingi tur</button></div>
    </div>}
    {assignClub && <form className="glass-panel p-4 space-y-3" onSubmit={event => { event.preventDefault(); run(() => api.adminAssignClub(assignClub.id, username.trim(), activeSeasonId)); }}>
      <h2 className="font-bold">{assignClub.name} — foydalanuvchiga biriktirish</h2><label className="block">Username yoki ID<input required value={username} onChange={event => setUsername(event.target.value)} className="block bg-slate-900 rounded-xl p-3 mt-1 w-full" placeholder="@username" /></label><button className={button} disabled={busy || !username.trim()}>Biriktirish</button><button type="button" className={button} disabled={busy} onClick={() => setAssignClub(null)}>Bekor qilish</button>
    </form>}
    {scoreFixture && <form className="glass-panel p-4 space-y-3" onSubmit={event => { event.preventDefault(); run(() => api.adminApproveResult(scoreFixture.id, homeScore, awayScore, notes)); }}>
      <h2 className="font-bold">Natija</h2><div className="flex gap-3"><label>Uy jamoa<input required type="number" min={0} step={1} value={homeScore} onChange={event => setHomeScore(Number(event.target.value))} className="block bg-slate-900 p-2 rounded-xl w-24" /></label><label>Mehmon jamoa<input required type="number" min={0} step={1} value={awayScore} onChange={event => setAwayScore(Number(event.target.value))} className="block bg-slate-900 p-2 rounded-xl w-24" /></label></div><label className="block">Izoh<input required value={notes} onChange={event => setNotes(event.target.value)} className="block bg-slate-900 p-2 rounded-xl w-full" /></label><button className={button} disabled={busy}>Saqlash</button><button type="button" className={button} disabled={busy} onClick={() => setScoreFixture(null)}>Bekor qilish</button>
    </form>}
  </div>;
};
