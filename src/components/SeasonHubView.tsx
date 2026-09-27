import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Crown,
  Flag,
  Gauge,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ClubCrest } from './ClubCrest';
import { seasonOpsApi } from '../lib/seasonOpsApi';

interface SeasonHubViewProps {
  onNavigateTab: (tab: any) => void;
}

function statusTone(status: string) {
  if (status === 'DONE') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'ACTIVE') return 'border-sky-500/40 bg-sky-500/10 text-sky-300';
  return 'border-slate-700 bg-slate-900/60 text-slate-400';
}

export const SeasonHubView: React.FC<SeasonHubViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, activeSeasonId, showToast } = useAuth();
  const [overview, setOverview] = useState<any>(null);
  const [myData, setMyData] = useState<any>(null);
  const [career, setCareer] = useState<any>(null);
  const [qualification, setQualification] = useState<any>(null);
  const [adminControl, setAdminControl] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFixtureId, setSelectedFixtureId] = useState('');
  const [noShowReason, setNoShowReason] = useState('Opponent javob bermayapti / o‘yinni kelishilgan muddatda o‘ynamadi.');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [h2h, setH2h] = useState<any>(null);

  const load = async (soft = false) => {
    soft ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [overviewRes, myRes, careerRes, qualificationRes] = await Promise.all([
        seasonOpsApi.overview(activeSeasonId),
        seasonOpsApi.myOverview(activeSeasonId),
        seasonOpsApi.career(activeSeasonId),
        seasonOpsApi.qualification(activeSeasonId),
      ]);
      setOverview(overviewRes);
      setMyData(myRes);
      setCareer(careerRes);
      setQualification(qualificationRes);
      if (user?.isAdmin) {
        setAdminControl(await seasonOpsApi.adminControl(activeSeasonId));
      }
    } catch (err: any) {
      setError(err?.message || 'Season Hub ma’lumotlari yuklanmadi.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(false);
  }, [activeSeasonId, user?.id, user?.isAdmin]);

  const upcoming = myData?.club?.upcoming || [];
  const firstOpponent = useMemo(() => {
    const fixture = upcoming.find((item: any) => item.homeClubId && item.awayClubId);
    if (!fixture || !currentClub?.id) return null;
    return fixture.homeClubId === currentClub.id ? fixture.awayClubId : fixture.homeClubId;
  }, [upcoming, currentClub?.id]);

  useEffect(() => {
    if (!currentClub?.id || !firstOpponent) {
      setH2h(null);
      return;
    }
    seasonOpsApi.h2h(currentClub.id, firstOpponent, activeSeasonId).then(setH2h).catch(() => setH2h(null));
  }, [currentClub?.id, firstOpponent, activeSeasonId]);

  const reportNoShow = async () => {
    if (!selectedFixtureId || noShowReason.trim().length < 3) return;
    setActionBusy('no-show');
    try {
      const result = await seasonOpsApi.reportNoShow(selectedFixtureId, noShowReason.trim(), activeSeasonId);
      showToast?.(result?.duplicate ? 'Bu match bo‘yicha report allaqachon ochilgan.' : 'No-show report admin ko‘rib chiqishiga yuborildi.', 'success');
      await load(true);
    } catch (err: any) {
      showToast?.(err?.message || 'Report yuborilmadi.', 'error');
    } finally {
      setActionBusy(null);
    }
  };

  const adminAction = async (key: string, task: () => Promise<any>, success: string) => {
    setActionBusy(key);
    try {
      await task();
      showToast?.(success, 'success');
      await load(true);
    } catch (err: any) {
      showToast?.(err?.message || 'Action bajarilmadi.', 'error');
    } finally {
      setActionBusy(null);
    }
  };

  if (loading) {
    return <div className="py-24 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2 text-emerald-400" />Season Hub yuklanmoqda…</div>;
  }

  return (
    <div className="space-y-5 pb-24 max-w-6xl mx-auto animate-in fade-in duration-300">
      <div className="glass-panel p-5 sm:p-7 relative overflow-hidden border-emerald-500/20">
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-black text-emerald-400"><Gauge className="w-4 h-4" />Season Operations V3</div>
            <h1 className="text-2xl sm:text-3xl font-black text-white mt-2">2026/27 Season Hub</h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">Turnir calendar, progression, deadlines, no-show, records, qualification, H2H, Career va admin lifecycle bitta joyda.</p>
          </div>
          <button onClick={() => load(true)} disabled={refreshing} className="p-2.5 rounded-xl glass-card text-slate-300 hover:text-white disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /></button>
        </div>
        {error && <div className="mt-4 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">{error}</div>}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-sky-400" />Competition Calendar</h2><span className="text-[10px] text-slate-500">Current: {overview?.currentPhase?.label || '—'}</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(overview?.phases || []).map((phase: any) => (
            <div key={phase.id} className={`rounded-2xl border p-4 ${statusTone(phase.status)}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-black text-xs">{phase.label}</span><span className="text-[9px] font-black px-2 py-0.5 rounded-full border border-current/20">{phase.status}</span></div>
              <div className="mt-3 flex items-end justify-between"><div className="text-2xl font-black tabular-nums">{phase.percent}%</div><div className="text-[10px] opacity-80">{phase.confirmed}/{phase.total} done</div></div>
              <div className="mt-2 h-1.5 rounded-full bg-black/20 overflow-hidden"><div className="h-full bg-current rounded-full transition-all" style={{ width: `${phase.percent}%` }} /></div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ['Fixtures', overview?.counters?.totalFixtures ?? 0, Swords],
          ['Confirmed', overview?.counters?.confirmedFixtures ?? 0, CheckCircle2],
          ['Pending', overview?.counters?.pendingConfirmations ?? 0, Clock3],
          ['Disputes', overview?.counters?.disputed ?? 0, AlertTriangle],
          ['Overdue', overview?.counters?.overdue ?? 0, Flag],
        ].map(([label, value, Icon]: any) => <div key={label} className="glass-card rounded-2xl p-4"><Icon className="w-4 h-4 text-emerald-400" /><div className="text-xl font-black text-white mt-2 tabular-nums">{value}</div><div className="text-[10px] text-slate-400 uppercase font-bold">{label}</div></div>)}
      </section>

      {myData?.club && (
        <section className="glass-panel p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3"><ClubCrest clubId={myData.club.club.id} logoUrl={myData.club.club.logoUrl} name={myData.club.club.name} size="md" /><div><div className="text-sm font-black text-white">{myData.club.club.name}</div><div className="text-[10px] text-slate-400">My Club • Live Season Record</div></div></div>
            <button onClick={() => onNavigateTab('my-club')} className="text-xs font-bold text-emerald-400 flex items-center gap-1">Club page <ChevronRight className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {[
              ['P', myData.club.summary.played], ['W', myData.club.summary.wins], ['D', myData.club.summary.draws], ['L', myData.club.summary.losses],
              ['GF', myData.club.summary.goalsFor], ['GA', myData.club.summary.goalsAgainst], ['GD', myData.club.summary.goalDifference], ['PTS', myData.club.summary.points],
            ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-950/60 border border-white/[0.06] p-2.5 text-center"><div className="text-sm font-black text-white tabular-nums">{value}</div><div className="text-[9px] text-slate-500 font-bold">{label}</div></div>)}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2"><Clock3 className="w-4 h-4 text-amber-400" />Deadlines & No-show</h2>
          {(overview?.deadlines || []).slice(0, 5).map((item: any) => <div key={item.fixtureId} className="rounded-xl border border-white/[0.06] bg-slate-950/50 p-3 flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-xs font-bold text-white truncate">{item.homeClubName} vs {item.awayClubName}</div><div className="text-[10px] text-slate-500">{item.competitionName} • MD {item.matchday}</div></div><div className={`text-[10px] font-black ${item.overdue ? 'text-rose-400' : 'text-amber-400'}`}>{item.overdue ? 'OVERDUE' : new Date(item.deadlineAt).toLocaleString()}</div></div>)}
          {upcoming.length > 0 && (
            <div className="pt-2 border-t border-white/[0.06] space-y-2">
              <select value={selectedFixtureId} onChange={(e) => setSelectedFixtureId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white">
                <option value="">No-show uchun match tanlang</option>
                {upcoming.map((fixture: any) => <option key={fixture.id} value={fixture.id}>{fixture.competitionName} • {fixture.homeClub?.name || fixture.homeClubId} vs {fixture.awayClub?.name || fixture.awayClubId}</option>)}
              </select>
              <textarea value={noShowReason} onChange={(e) => setNoShowReason(e.target.value)} className="w-full min-h-20 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" />
              <button onClick={reportNoShow} disabled={!selectedFixtureId || actionBusy === 'no-show'} className="w-full rounded-xl bg-amber-500 text-slate-950 font-black text-xs py-2.5 disabled:opacity-50">{actionBusy === 'no-show' ? 'Yuborilmoqda…' : 'Opponent unavailable / No-show report'}</button>
            </div>
          )}
        </section>

        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2"><Activity className="w-4 h-4 text-fuchsia-400" />Head-to-Head</h2>
          {h2h && h2h.summary.played > 0 ? <><div className="grid grid-cols-3 gap-3 text-center"><div className="rounded-xl bg-slate-950/60 p-3"><div className="text-xl font-black text-emerald-400">{h2h.summary.aWins}</div><div className="text-[9px] text-slate-500">MY WINS</div></div><div className="rounded-xl bg-slate-950/60 p-3"><div className="text-xl font-black text-white">{h2h.summary.draws}</div><div className="text-[9px] text-slate-500">DRAWS</div></div><div className="rounded-xl bg-slate-950/60 p-3"><div className="text-xl font-black text-rose-400">{h2h.summary.bWins}</div><div className="text-[9px] text-slate-500">OPP WINS</div></div></div><div className="text-xs text-slate-400">Goals: <strong className="text-white">{h2h.summary.aGoals}–{h2h.summary.bGoals}</strong> • {h2h.summary.played} meetings</div></> : <div className="text-xs text-slate-500 py-8 text-center">Keyingi raqib bilan oldingi uchrashuv topilmadi.</div>}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="glass-panel p-5 space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2"><Award className="w-4 h-4 text-amber-400" />Live Season Records</h2>
          {(overview?.awards || []).map((award: any) => <div key={award.id} className="rounded-xl bg-slate-950/50 border border-white/[0.06] p-3"><div className="text-xs font-bold text-white">{award.label}</div><div className="text-[10px] text-slate-500 mt-0.5">{award.description}</div><div className="mt-2 flex flex-wrap gap-1.5">{(award.leaders || []).map((leader: any) => <span key={`${leader.clubId}-${leader.userId || ''}`} className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-300">{leader.clubName} • {leader.value} {award.unit}</span>)}</div></div>)}
        </section>

        <section className="glass-panel p-5 space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2"><Crown className="w-4 h-4 text-sky-400" />Qualification Tracker</h2>
          {(qualification?.leagues || []).map((league: any) => <div key={league.competitionId} className="rounded-xl bg-slate-950/50 border border-white/[0.06] p-3"><div className="flex items-center justify-between"><span className="text-xs font-black text-white">{league.competitionName}</span><span className="text-[9px] text-slate-500">UCL {league.allocation?.ucl || 0} • UEL {league.allocation?.uel || 0} • UECL {league.allocation?.uecl || 0}</span></div><div className="mt-2 space-y-1">{(league.rows || []).slice(0, Math.max(6, league.allocation?.ucl || 0)).map((row: any) => <div key={row.clubId} className="flex items-center gap-2 text-[10px]"><span className="w-4 text-slate-500 tabular-nums">{row.position}</span><span className="flex-1 text-slate-300 truncate">{row.clubName}</span>{row.qualificationZone && <span className={`font-black ${row.qualificationZone === 'UCL' ? 'text-sky-400' : row.qualificationZone === 'UEL' ? 'text-amber-400' : 'text-emerald-400'}`}>{row.qualificationZone}</span>}<span className="font-black text-white tabular-nums">{row.points}</span></div>)}</div></div>)}
        </section>
      </div>

      <section className={`glass-panel p-5 sm:p-6 ${career?.locked ? 'border-indigo-500/30' : 'border-emerald-500/30'}`}>
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-sm font-black text-white flex items-center gap-2">{career?.locked ? <LockKeyhole className="w-4 h-4 text-indigo-400" /> : <Sparkles className="w-4 h-4 text-emerald-400" />}EFL Career</h2><p className="text-xs text-slate-400 mt-1">Career barcha player uchun hisoblanadi; advanced view Premium entitlement bilan ochiladi.</p></div>{career?.locked && <span className="text-[10px] px-2 py-1 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 font-black">{career.priceStars} Stars / season</span>}</div>
        {!career?.locked && career?.career && <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">{[['Matches', career.career.overall.matches], ['Wins', career.career.overall.wins], ['Win %', `${career.career.overall.winRate}%`], ['GF', career.career.overall.goalsFor], ['Trophies', career.career.achievements?.filter((x: any) => x.unlocked).length || 0], ['Unbeaten', career.career.overall.longestUnbeatenRun]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-950/60 p-3 text-center"><div className="text-base font-black text-white">{value}</div><div className="text-[9px] text-slate-500">{label}</div></div>)}</div>}
      </section>

      {user?.isAdmin && adminControl && (
        <section className="glass-panel p-5 sm:p-6 border-amber-500/30 space-y-5">
          <div className="flex items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-wider font-black text-amber-400">Admin only</div><h2 className="text-lg font-black text-white">Season Control Center</h2></div><button onClick={() => onNavigateTab('admin')} className="text-xs font-bold text-amber-400">Full Admin <ChevronRight className="w-3.5 h-3.5 inline" /></button></div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-white/[0.07] bg-slate-950/50 p-4 space-y-3">
              <div className="text-xs font-black text-white flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" />Progression Actions</div>
              <p className="text-[10px] text-slate-500">Existing matchday guard ishlaydi: unfinished fixture bo‘lsa advance bloklanadi.</p>
              <div className="flex flex-wrap gap-2">
                {['comp-premier-league-2026','comp-la-liga-2026','comp-serie-a-2026','comp-bundesliga-2026','comp-ligue-1-2026'].map((id) => <button key={id} onClick={() => adminAction(`advance-${id}`, () => seasonOpsApi.advance(id, activeSeasonId, 30), `${id} next matchday opened`)} disabled={actionBusy === `advance-${id}`} className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-black text-emerald-300 disabled:opacity-50">Advance {id.replace('comp-','').replace('-2026','')}</button>)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.07] bg-slate-950/50 p-4 space-y-3">
              <div className="text-xs font-black text-white flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-400" />No-show Queue</div>
              {(adminControl.noShowReports || []).filter((item: any) => item.status === 'OPEN').length === 0 ? <div className="text-[10px] text-slate-500">Open no-show report yo‘q.</div> : (adminControl.noShowReports || []).filter((item: any) => item.status === 'OPEN').slice(0, 5).map((report: any) => <div key={report.id} className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3"><div className="text-xs font-bold text-white">Fixture {report.fixtureId}</div><div className="text-[10px] text-slate-500 mt-1 line-clamp-2">{report.reason}</div><div className="flex flex-wrap gap-1.5 mt-2">{(['WALKOVER_HOME','WALKOVER_AWAY','POSTPONE','REJECT'] as const).map((action) => <button key={action} onClick={() => adminAction(`${report.id}-${action}`, () => seasonOpsApi.resolveNoShow(report.id, action), `${action} applied`)} className="px-2 py-1 rounded-lg border border-slate-700 text-[9px] font-bold text-slate-300 hover:text-white">{action}</button>)}</div></div>)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-slate-950/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div><div className="text-xs font-black text-white flex items-center gap-2"><Trophy className="w-4 h-4 text-fuchsia-400" />Season Rollover</div><div className="text-[10px] text-slate-500 mt-1">{adminControl.rollover?.canRollover ? `Ready → ${adminControl.rollover.nextSeasonId}` : `${adminControl.rollover?.blockers?.length || 0} blocker(s). Current season will never be deleted.`}</div></div>
            <button onClick={() => adminAction('rollover', () => seasonOpsApi.createNextSeasonShell(activeSeasonId), 'Next season shell created safely.')} disabled={!adminControl.rollover?.canRollover || actionBusy === 'rollover'} className="px-4 py-2.5 rounded-xl bg-fuchsia-500 text-white text-xs font-black disabled:opacity-40">Create next-season shell</button>
          </div>
        </section>
      )}
    </div>
  );
};
