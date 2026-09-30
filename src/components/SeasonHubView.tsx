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
  if (status === 'DONE') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 efl-theme-emerald';
  if (status === 'ACTIVE') return 'border-sky-500/40 bg-sky-500/10 text-sky-300 efl-theme-sky';
  return 'border-[var(--efl-border)] bg-[var(--efl-surface-2)] text-[var(--efl-muted)] efl-theme-meta';
}

export const SeasonHubView: React.FC<SeasonHubViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, activeSeasonId, showToast } = useAuth();
  const [overview, setOverview] = useState<any>(null);
  const [myData, setMyData] = useState<any>(null);
  const [career, setCareer] = useState<any>(null);
  const [qualification, setQualification] = useState<any>(null);
  const [history, setHistory] = useState<Array<{ seasonId: string; trophyCount: number }>>([]);
  const [selectedArchive, setSelectedArchive] = useState<any>(null);
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
      seasonOpsApi.history().then((result) => setHistory(result.seasons)).catch(() => setHistory([]));
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
    return (
      <div className="py-24 flex items-center justify-center text-slate-400 efl-theme-text-2 text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2 text-blue-500 efl-theme-blue" />
        <span>Season Hub ma’lumotlari yuklanmoqda…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20 animate-in fade-in duration-200">
      {/* 1. Header Banner */}
      <div className="preview-surface p-5 sm:p-6 rounded-2xl border border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs relative overflow-hidden">
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-black text-blue-600 efl-theme-blue dark:text-blue-400">
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Season Operations V3 • 2026/27</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 efl-theme-text dark:text-white mt-1.5 tracking-tight">
              Season Hub
            </h1>
            <p className="text-xs text-slate-500 efl-theme-text-2 dark:text-slate-400 mt-1 max-w-2xl">
              Turnir taqvimi, progressiya, muddatlar, no-show, rekordlar, kvalifikatsiya, H2H, Career va admin boshqaruvi.
            </p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-2 rounded-xl bg-slate-100 efl-theme-surface-2 dark:bg-[#171e2c] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-600 efl-theme-text-2 dark:text-slate-400 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white shrink-0 min-h-[36px] disabled:opacity-50"
            title="Yangilash"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-blue-500 efl-theme-blue' : ''}`} />
          </button>
        </div>
        {error && (
          <div className="mt-4 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-700 efl-theme-rose dark:text-rose-300">
            {error}
          </div>
        )}
      </div>

      {/* 2. Participant Active Club Live Record (if available) */}
      {myData?.club && (
        <section className="preview-surface p-4 sm:p-5 rounded-2xl border border-blue-500/30 bg-blue-500/[0.03] space-y-3.5 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <ClubCrest
                clubId={myData.club.club.id}
                logoUrl={myData.club.club.logoUrl}
                name={myData.club.club.name}
                size="sm"
                className="w-8 h-8 shrink-0"
              />
              <div className="min-w-0">
                <div className="text-xs font-black text-slate-900 efl-theme-text dark:text-white truncate">
                  {myData.club.club.name}
                </div>
                <div className="text-[10px] text-blue-600 efl-theme-blue dark:text-blue-400 font-bold">
                  Sizning klubingiz • Jonli mavsum statistikasi
                </div>
              </div>
            </div>
            <button
              onClick={() => onNavigateTab('my-club')}
              className="text-xs font-bold text-blue-600 efl-theme-blue dark:text-blue-400 hover:underline flex items-center gap-1 shrink-0"
            >
              <span>Klub markazi</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
            {[
              ['P', myData.club.summary.played],
              ['W', myData.club.summary.wins],
              ['D', myData.club.summary.draws],
              ['L', myData.club.summary.losses],
              ['GF', myData.club.summary.goalsFor],
              ['GA', myData.club.summary.goalsAgainst],
              ['GD', myData.club.summary.goalDifference],
              ['PTS', myData.club.summary.points],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className={`rounded-xl border p-2 text-center ${
                  label === 'PTS'
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-slate-50 dark:bg-white/[0.03] border-slate-200/80 efl-theme-border dark:border-white/10'
                }`}
              >
                <div
                  className={`text-sm font-black tabular-nums ${
                    label === 'PTS' ? 'text-white efl-theme-text' : 'text-slate-900 efl-theme-text dark:text-white'
                  }`}
                >
                  {value}
                </div>
                <div
                  className={`text-[9px] font-bold ${
                    label === 'PTS' ? 'text-blue-100' : 'text-slate-500 efl-theme-text-2 dark:text-slate-400'
                  }`}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Competition Calendar & Progression */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 efl-theme-text-2 dark:text-slate-300 flex items-center gap-2">
            <CalendarDays className="w-3.5 h-3.5 text-blue-500 efl-theme-blue" />
            <span>Turnir taqvimi va bosqichlar</span>
          </h2>
          <span className="text-[10px] text-slate-500 efl-theme-text-2 dark:text-slate-400 font-bold">
            Hozirgi bosqich: {overview?.currentPhase?.label || '—'}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {(overview?.phases || []).map((phase: any) => (
            <div
              key={phase.id}
              className={`rounded-xl border p-3.5 shadow-xs ${
                phase.status === 'DONE'
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-800 efl-theme-emerald dark:text-emerald-300'
                  : phase.status === 'ACTIVE'
                  ? 'border-blue-500/30 bg-blue-500/5 text-blue-800 efl-theme-blue dark:text-blue-300'
                  : 'border-slate-200/80 efl-theme-border dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] text-slate-600 efl-theme-text-2 dark:text-slate-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-black text-xs text-slate-900 efl-theme-text dark:text-white">{phase.label}</span>
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full border border-current/20 uppercase">
                  {phase.status}
                </span>
              </div>
              <div className="mt-2.5 flex items-end justify-between">
                <div className="text-xl font-black tabular-nums text-slate-900 efl-theme-text dark:text-white">{phase.percent}%</div>
                <div className="text-[10px] opacity-80 tabular-nums">{phase.confirmed}/{phase.total} yakunlandi</div>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-200 efl-theme-surface-2 dark:bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    phase.status === 'DONE' ? 'bg-emerald-500' : 'bg-blue-600'
                  }`}
                  style={{ width: `${phase.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Live Match Counters */}
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          ['Fixtures', overview?.counters?.totalFixtures ?? 0, Swords, 'text-blue-500 efl-theme-blue'],
          ['Confirmed', overview?.counters?.confirmedFixtures ?? 0, CheckCircle2, 'text-emerald-500 efl-theme-emerald'],
          ['Pending', overview?.counters?.pendingConfirmations ?? 0, Clock3, 'text-amber-500 efl-theme-amber'],
          ['Disputes', overview?.counters?.disputed ?? 0, AlertTriangle, 'text-rose-500 efl-theme-rose'],
          ['Overdue', overview?.counters?.overdue ?? 0, Flag, 'text-indigo-500 efl-theme-indigo'],
        ].map(([label, value, Icon, colorClass]: any) => (
          <div key={label} className="preview-surface rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 p-3 shadow-xs">
            <Icon className={`w-3.5 h-3.5 ${colorClass}`} />
            <div className="text-lg font-black text-slate-900 efl-theme-text dark:text-white mt-1 tabular-nums">{value}</div>
            <div className="text-[10px] text-slate-500 efl-theme-text-2 dark:text-slate-400 uppercase font-bold">{label}</div>
          </div>
        ))}
      </section>

      {/* 5. Deadlines & No-show + Head-to-Head */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <section className="preview-surface p-4 sm:p-5 rounded-2xl border border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 efl-theme-text-2 dark:text-slate-300 flex items-center gap-2">
            <Clock3 className="w-3.5 h-3.5 text-amber-500 efl-theme-amber" />
            <span>Muddatlar va No-show holatlari</span>
          </h2>
          <div className="space-y-2">
            {(overview?.deadlines || []).slice(0, 5).map((item: any) => (
              <div
                key={item.fixtureId}
                className="rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] p-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 efl-theme-text dark:text-white truncate">
                    {item.homeClubName} vs {item.awayClubName}
                  </div>
                  <div className="text-[10px] text-slate-500 efl-theme-text-2 dark:text-slate-400">
                    {item.competitionName} • Tur {item.matchday}
                  </div>
                </div>
                <div className={`text-[10px] font-black shrink-0 ${item.overdue ? 'text-rose-600 efl-theme-rose dark:text-rose-400' : 'text-amber-600 efl-theme-amber dark:text-amber-400'}`}>
                  {item.overdue ? 'MUDDATI O‘TGAN' : new Date(item.deadlineAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
          {upcoming.length > 0 && (
            <div className="pt-2 border-t border-slate-200/80 efl-theme-border dark:border-white/10 space-y-2">
              <select
                value={selectedFixtureId}
                onChange={(e) => setSelectedFixtureId(e.target.value)}
                className="w-full bg-slate-50 dark:bg-white/5 border border-slate-200/80 efl-theme-border dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 efl-theme-text dark:text-white min-h-[38px]"
              >
                <option value="">No-show uchun match tanlang</option>
                {upcoming.map((fixture: any) => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.competitionName} • {fixture.homeClub?.name || fixture.homeClubId} vs {fixture.awayClub?.name || fixture.awayClubId}
                  </option>
                ))}
              </select>
              <textarea
                value={noShowReason}
                onChange={(e) => setNoShowReason(e.target.value)}
                className="w-full min-h-16 bg-slate-50 dark:bg-white/5 border border-slate-200/80 efl-theme-border dark:border-white/10 rounded-xl px-3 py-2 text-xs text-slate-900 efl-theme-text dark:text-white"
              />
              <button
                onClick={reportNoShow}
                disabled={!selectedFixtureId || actionBusy === 'no-show'}
                className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs py-2.5 transition-colors disabled:opacity-50 min-h-[38px]"
              >
                {actionBusy === 'no-show' ? 'Yuborilmoqda…' : 'Opponent javob bermadi / No-show report'}
              </button>
            </div>
          )}
        </section>

        <section className="preview-surface p-4 sm:p-5 rounded-2xl border border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 efl-theme-text-2 dark:text-slate-300 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-blue-500 efl-theme-blue" />
            <span>Head-to-Head (O‘zaro o‘yinlar)</span>
          </h2>
          {h2h && h2h.summary.played > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2.5 text-center">
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
                  <div className="text-xl font-black text-emerald-600 efl-theme-emerald dark:text-emerald-400 tabular-nums">{h2h.summary.aWins}</div>
                  <div className="text-[9px] text-slate-500 efl-theme-text-2 dark:text-slate-400 font-bold uppercase">G‘alaba</div>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/80 efl-theme-border dark:border-white/10 p-3">
                  <div className="text-xl font-black text-slate-900 efl-theme-text dark:text-white tabular-nums">{h2h.summary.draws}</div>
                  <div className="text-[9px] text-slate-500 efl-theme-text-2 dark:text-slate-400 font-bold uppercase">Durang</div>
                </div>
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3">
                  <div className="text-xl font-black text-rose-600 efl-theme-rose dark:text-rose-400 tabular-nums">{h2h.summary.bWins}</div>
                  <div className="text-[9px] text-slate-500 efl-theme-text-2 dark:text-slate-400 font-bold uppercase">Mag‘lubiyat</div>
                </div>
              </div>
              <div className="text-xs text-slate-500 efl-theme-text-2 dark:text-slate-400 text-center">
                Gollar: <strong className="text-slate-900 efl-theme-text dark:text-white tabular-nums">{h2h.summary.aGoals}–{h2h.summary.bGoals}</strong> • {h2h.summary.played} uchrashuv
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-400 efl-theme-text-2 py-10 text-center">
              Keyingi raqib bilan oldingi uchrashuv tarixi mavjud emas.
            </div>
          )}
        </section>
      </div>

      {/* 6. Live Season Records & Leaders + Qualification Tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <section className="preview-surface p-4 sm:p-5 rounded-2xl border border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 efl-theme-text-2 dark:text-slate-300 flex items-center gap-2">
            <Award className="w-3.5 h-3.5 text-amber-500 efl-theme-amber" />
            <span>Mavsum rekordlari</span>
          </h2>
          <div className="space-y-2">
            {(overview?.awards || []).map((award: any) => (
              <div key={award.id} className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/80 efl-theme-border dark:border-white/10 p-2.5">
                <div className="text-xs font-bold text-slate-900 efl-theme-text dark:text-white">{award.label}</div>
                <div className="text-[10px] text-slate-500 efl-theme-text-2 dark:text-slate-400 mt-0.5">{award.description}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(award.leaders || []).map((leader: any) => (
                    <span key={`${leader.clubId}-${leader.userId || ''}`} className="px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] font-bold text-amber-700 efl-theme-amber dark:text-amber-300">
                      {leader.clubName} • {leader.value} {award.unit}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="preview-surface p-4 sm:p-5 rounded-2xl border border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 efl-theme-text-2 dark:text-slate-300 flex items-center gap-2">
            <Crown className="w-3.5 h-3.5 text-blue-500 efl-theme-blue" />
            <span>Yevrokuboklarga yo‘llanma (Qualification Tracker)</span>
          </h2>
          <div className="space-y-2">
            {(qualification?.leagues || []).map((league: any) => (
              <div key={league.competitionId} className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/80 efl-theme-border dark:border-white/10 p-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-900 efl-theme-text dark:text-white">
                  <span>{league.competitionName}</span>
                  <span className="text-[10px] text-slate-500 efl-theme-text-2 font-normal">UCL {league.allocation?.ucl || 0} • UEL {league.allocation?.uel || 0}</span>
                </div>
                <div className="mt-2 space-y-1">
                  {(league.rows || []).slice(0, Math.max(6, league.allocation?.ucl || 0)).map((row: any) => (
                    <div key={row.clubId} className="flex items-center gap-2 text-[10px]">
                      <span className="w-4 text-slate-400 efl-theme-text-2 tabular-nums">{row.position}</span>
                      <span className="flex-1 text-slate-700 efl-theme-text-2 dark:text-slate-300 truncate">{row.clubName}</span>
                      {row.qualificationZone && (
                        <span className={`font-black ${row.qualificationZone === 'UCL' ? 'text-blue-600 efl-theme-blue dark:text-blue-400' : 'text-indigo-600 efl-theme-indigo dark:text-indigo-400'}`}>
                          {row.qualificationZone}
                        </span>
                      )}
                      <span className="font-bold text-slate-900 efl-theme-text dark:text-white tabular-nums">{row.points}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 7. Season History */}
      <section className="preview-surface p-4 sm:p-5 rounded-2xl border border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs space-y-3">
        <h2 className="text-xs sm:text-sm font-black text-slate-900 efl-theme-text dark:text-white flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500 efl-theme-amber" />
          <span>Mavsumlar tarixi va sovrinlar</span>
        </h2>
        {history.length === 0 ? (
          <p className="text-xs text-slate-400 efl-theme-text-2">Hali yakunlangan mavsum arxivi yo‘q.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {history.map((season) => (
              <button
                key={season.seasonId}
                onClick={() =>
                  seasonOpsApi
                    .archive(season.seasonId)
                    .then(setSelectedArchive)
                    .catch((err) => showToast?.(err?.message || 'Arxiv ochilmadi.', 'error'))
                }
                className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700 efl-theme-amber dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
              >
                {season.seasonId.replace('season-', '')} · {season.trophyCount} kuboklar
              </button>
            ))}
          </div>
        )}
        {selectedArchive && (
          <div className="space-y-3 border-t border-slate-200/80 efl-theme-border dark:border-white/10 pt-3">
            <div className="text-xs font-black text-slate-900 efl-theme-text dark:text-white">
              {selectedArchive.seasonId.replace('season-', '')} · Final trophy cabinet
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {(selectedArchive.trophies || []).map((trophy: any) => (
                <div key={trophy.competitionId} className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/80 efl-theme-border dark:border-white/10 p-2.5 text-xs">
                  <div className="font-bold text-slate-500 efl-theme-text-2">{trophy.competitionName}</div>
                  <div className="mt-0.5 font-black text-slate-900 efl-theme-text dark:text-white">{trophy.clubName}</div>
                  {trophy.winnerUsername && <div className="text-[10px] text-amber-600 efl-theme-amber dark:text-amber-400">@{trophy.winnerUsername}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 8. Admin Control Center (Admin only) */}
      {user?.isAdmin && adminControl && (
        <section className="preview-surface p-4 sm:p-5 rounded-2xl border border-amber-500/30 bg-amber-500/[0.02] space-y-4 shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-black text-amber-600 efl-theme-amber dark:text-amber-400">
                Admin Control
              </div>
              <h2 className="text-sm sm:text-base font-black text-slate-900 efl-theme-text dark:text-white">
                Season Control Center
              </h2>
            </div>
            <button
              onClick={() => onNavigateTab('admin')}
              className="text-xs font-bold text-amber-600 efl-theme-amber dark:text-amber-400 hover:underline flex items-center gap-1"
            >
              <span>Full Admin</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 bg-white efl-theme-surface dark:bg-[#111722] p-3.5 space-y-2.5 shadow-xs">
              <div className="text-xs font-black text-slate-900 efl-theme-text dark:text-white flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500 efl-theme-amber" />
                <span>Progression Actions</span>
              </div>
              <p className="text-[10px] text-slate-500 efl-theme-text-2">
                Matchday guard: unfinished fixture bo‘lsa advance bloklanadi.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {['comp-premier-league-2026', 'comp-la-liga-2026', 'comp-serie-a-2026', 'comp-bundesliga-2026', 'comp-ligue-1-2026'].map((id) => (
                  <button
                    key={id}
                    onClick={() => adminAction(`advance-${id}`, () => seasonOpsApi.advance(id, activeSeasonId, 30), `${id} next matchday opened`)}
                    disabled={actionBusy === `advance-${id}`}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[10px] font-black text-emerald-700 efl-theme-emerald dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    Advance {id.replace('comp-', '').replace('-2026', '')}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 bg-white efl-theme-surface dark:bg-[#111722] p-3.5 space-y-2.5 shadow-xs">
              <div className="text-xs font-black text-slate-900 efl-theme-text dark:text-white flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 efl-theme-rose" />
                <span>No-show Queue</span>
              </div>
              {(adminControl.noShowReports || []).filter((item: any) => item.status === 'OPEN').length === 0 ? (
                <div className="text-[10px] text-slate-500 efl-theme-text-2">Open no-show report yo‘q.</div>
              ) : (
                (adminControl.noShowReports || []).filter((item: any) => item.status === 'OPEN').slice(0, 5).map((report: any) => (
                  <div key={report.id} className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-xs">
                    <div className="text-xs font-bold text-slate-900 efl-theme-text dark:text-white">Fixture {report.fixtureId}</div>
                    <div className="text-[10px] text-slate-500 efl-theme-text-2 mt-0.5 line-clamp-1">{report.reason}</div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {(['WALKOVER_HOME', 'WALKOVER_AWAY', 'POSTPONE', 'REJECT'] as const).map((action) => (
                        <button
                          key={action}
                          onClick={() => adminAction(`${report.id}-${action}`, () => seasonOpsApi.resolveNoShow(report.id, action), `${action} applied`)}
                          className="px-2 py-0.5 rounded border border-slate-300 efl-theme-border dark:border-slate-700 text-[9px] font-bold text-slate-700 efl-theme-text-2 dark:text-slate-300 hover:bg-slate-100 efl-theme-hover-surface dark:hover:bg-white/5"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 bg-white efl-theme-surface dark:bg-[#111722] p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div>
              <div className="text-xs font-black text-slate-900 efl-theme-text dark:text-white flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-fuchsia-500 efl-theme-fuchsia" />
                <span>Season Rollover</span>
              </div>
              <div className="text-[10px] text-slate-500 efl-theme-text-2 mt-0.5">
                {adminControl.rollover?.canRollover
                  ? `Tayyor → ${adminControl.rollover.nextSeasonId}`
                  : `${adminControl.rollover?.blockers?.length || 0} ta to‘siq mavjud.`}
              </div>
            </div>
            <button
              onClick={() => adminAction('rollover', () => seasonOpsApi.createNextSeasonShell(activeSeasonId), 'Next season shell created safely.')}
              disabled={!adminControl.rollover?.canRollover || actionBusy === 'rollover'}
              className="px-3.5 py-1.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-black disabled:opacity-40 shadow-xs"
            >
              Keyingi mavsum qobig‘ini yaratish
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

