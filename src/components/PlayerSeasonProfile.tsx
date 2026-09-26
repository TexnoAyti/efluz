import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Award,
  CalendarClock,
  ChevronRight,
  CircleDot,
  Crown,
  Flame,
  Goal,
  Medal,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
} from 'lucide-react';

interface PlayerSeasonProfileProps {
  userId: string;
  seasonId?: string;
}

type InsightData = {
  seasonId: string;
  source: string;
  clubIds: string[];
  summary: {
    matchesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
    goalsScored: number;
    goalsConceded: number;
    goalDifference: number;
    winRate: number;
    points: number;
    longestUnbeaten: number;
    longestWinStreak: number;
  };
  form: Array<'W' | 'D' | 'L'>;
  recentMatches: Array<{
    id: string;
    competitionName: string;
    roundName: string;
    opponentName: string;
    goalsFor: number;
    goalsAgainst: number;
    outcome: 'W' | 'D' | 'L';
  }>;
  nextMatch: null | {
    id: string;
    competitionName: string;
    roundName: string;
    opponentName: string;
    scheduledAt?: string;
    status: string;
  };
  trophies: Array<{
    competitionId: string;
    competitionName: string;
    clubName: string;
    decidedBy: string;
  }>;
  awardsHeld: Array<{
    id: string;
    label: string;
    description: string;
    unit: string;
    leaders: Array<{ clubName: string; value: number }>;
  }>;
  competitionBreakdown: Array<{
    competitionId: string;
    competitionName: string;
    matches: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
  }>;
};

function StatCard({ label, value, sub, icon }: { label: string; value: React.ReactNode; sub: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-slate-950/55 p-3.5 shadow-inner">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
        <span className="text-emerald-400">{icon}</span>
      </div>
      <div className="mt-2 text-xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-0.5 text-[10px] font-medium text-slate-500">{sub}</div>
    </div>
  );
}

const outcomeClass: Record<'W' | 'D' | 'L', string> = {
  W: 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300',
  D: 'border-slate-500/30 bg-slate-500/15 text-slate-300',
  L: 'border-rose-400/30 bg-rose-400/15 text-rose-300',
};

export const PlayerSeasonProfile: React.FC<PlayerSeasonProfileProps> = ({ userId, seasonId = 'season-2026-27' }) => {
  const [data, setData] = useState<InsightData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/insights/player/${encodeURIComponent(userId)}?seasonId=${encodeURIComponent(seasonId)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.message || payload?.error || 'Season profile unavailable');
        return payload as InsightData;
      })
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled && err?.name !== 'AbortError') setError(err?.message || 'Season profile unavailable');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [userId, seasonId]);

  const bestCompetition = useMemo(() => {
    if (!data?.competitionBreakdown?.length) return null;
    return [...data.competitionBreakdown]
      .filter((row) => row.matches > 0)
      .sort((a, b) => (b.wins / b.matches) - (a.wins / a.matches) || b.matches - a.matches)[0] || null;
  }, [data]);

  if (loading) {
    return (
      <div className="overflow-hidden rounded-[26px] border border-white/[0.07] bg-slate-950/55 p-5 shadow-xl">
        <div className="h-3 w-40 animate-pulse rounded bg-slate-800" />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-900" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-[24px] border border-amber-500/20 bg-amber-500/[0.06] p-4 text-xs text-amber-200">
        <div className="flex items-center gap-2 font-black"><Activity className="h-4 w-4" /> Season profile is temporarily unavailable.</div>
        <div className="mt-1 text-amber-200/60">{error}</div>
      </div>
    );
  }

  const summary = data.summary;

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-emerald-400/15 bg-[radial-gradient(circle_at_10%_0%,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_90%_8%,rgba(59,130,246,0.10),transparent_28%),linear-gradient(150deg,rgba(15,23,42,0.96),rgba(2,6,23,0.94))] shadow-2xl">
      <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full border border-emerald-400/[0.06]" />
      <div className="relative space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-400">
              <Sparkles className="h-3.5 w-3.5" /> Public Season Profile
            </div>
            <h2 className="mt-1.5 text-xl font-black tracking-tight text-white sm:text-2xl">2026/27 Performance</h2>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">Confirmed tournament matches only • objective stats • live season snapshot</p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2 text-[10px] font-bold text-slate-400 sm:self-auto">
            <CircleDot className="h-3 w-3 text-emerald-400" /> {data.source || 'read model'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard label="Record" value={`${summary.wins}-${summary.draws}-${summary.losses}`} sub={`${summary.matchesPlayed} confirmed matches`} icon={<ShieldCheck className="h-4 w-4" />} />
          <StatCard label="Win Rate" value={`${summary.winRate}%`} sub={`${summary.points} performance points`} icon={<Target className="h-4 w-4" />} />
          <StatCard label="Goals" value={`${summary.goalsScored}:${summary.goalsConceded}`} sub={`GD ${summary.goalDifference >= 0 ? '+' : ''}${summary.goalDifference}`} icon={<Goal className="h-4 w-4" />} />
          <StatCard label="Best Run" value={summary.longestUnbeaten} sub={`${summary.longestWinStreak} straight wins`} icon={<Flame className="h-4 w-4" />} />
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-black text-white">Recent Form</div>
                <div className="mt-0.5 text-[10px] text-slate-500">Latest confirmed results, newest first</div>
              </div>
              <div className="flex gap-1.5">
                {data.form.length ? data.form.map((item, index) => (
                  <span key={`${item}-${index}`} className={`flex h-7 w-7 items-center justify-center rounded-lg border text-[10px] font-black ${outcomeClass[item]}`}>{item}</span>
                )) : <span className="text-[10px] text-slate-500">No form yet</span>}
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {data.recentMatches.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/[0.08] px-3 py-5 text-center text-[11px] text-slate-500">Confirmed matches will appear here.</div>
              ) : data.recentMatches.map((match) => (
                <div key={match.id} className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-slate-950/50 px-3 py-2.5">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[10px] font-black ${outcomeClass[match.outcome]}`}>{match.outcome}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-black text-white">vs {match.opponentName}</div>
                    <div className="truncate text-[9px] text-slate-500">{match.competitionName} • {match.roundName}</div>
                  </div>
                  <div className="text-sm font-black tabular-nums text-slate-200">{match.goalsFor}–{match.goalsAgainst}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-blue-400/15 bg-blue-500/[0.05] p-4">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.15em] text-blue-300"><CalendarClock className="h-3.5 w-3.5" /> Next Assignment</div>
              {data.nextMatch ? (
                <>
                  <div className="mt-2 text-sm font-black text-white">vs {data.nextMatch.opponentName}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{data.nextMatch.competitionName} • {data.nextMatch.roundName}</div>
                  <div className="mt-2 inline-flex rounded-lg border border-blue-400/15 bg-blue-400/[0.08] px-2 py-1 text-[9px] font-black uppercase text-blue-300">{data.nextMatch.status}</div>
                </>
              ) : (
                <div className="mt-2 text-[11px] text-slate-500">No upcoming fixture is currently assigned.</div>
              )}
            </div>

            {bestCompetition && (
              <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
                <div className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">Strongest Competition</div>
                <div className="mt-1 text-sm font-black text-white">{bestCompetition.competitionName}</div>
                <div className="mt-1 text-[10px] text-slate-400">{bestCompetition.wins}W • {bestCompetition.draws}D • {bestCompetition.losses}L in {bestCompetition.matches} matches</div>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.045] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-white"><Trophy className="h-4 w-4 text-amber-300" /> Trophy Cabinet</div>
              <span className="rounded-lg bg-amber-400/10 px-2 py-1 text-[9px] font-black text-amber-300">{data.trophies.length} titles</span>
            </div>
            <div className="mt-3 space-y-2">
              {data.trophies.length === 0 ? (
                <div className="rounded-xl border border-dashed border-amber-300/10 py-5 text-center text-[10px] text-slate-500">Completed competition titles will be archived here.</div>
              ) : data.trophies.map((trophy) => (
                <div key={trophy.competitionId} className="flex items-center gap-3 rounded-xl border border-amber-300/10 bg-black/20 p-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300"><Crown className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-black text-white">{trophy.competitionName}</div>
                    <div className="truncate text-[9px] text-slate-500">{trophy.clubName} • {trophy.decidedBy.replace(/_/g, ' ')}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-violet-400/15 bg-violet-400/[0.045] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-white"><Award className="h-4 w-4 text-violet-300" /> Season Awards</div>
              <span className="rounded-lg bg-violet-400/10 px-2 py-1 text-[9px] font-black text-violet-300">Objective leaders</span>
            </div>
            <div className="mt-3 space-y-2">
              {data.awardsHeld.length === 0 ? (
                <div className="rounded-xl border border-dashed border-violet-300/10 py-5 text-center text-[10px] text-slate-500">League-leading categories will appear automatically.</div>
              ) : data.awardsHeld.map((award) => (
                <div key={award.id} className="flex items-center gap-3 rounded-xl border border-violet-300/10 bg-black/20 p-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300"><Medal className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-black text-white">{award.label}</div>
                    <div className="truncate text-[9px] text-slate-500">{award.description}</div>
                  </div>
                  <div className="text-xs font-black text-violet-200">{award.leaders[0]?.value} {award.unit}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {data.competitionBreakdown.length > 0 && (
          <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
            <div className="flex items-center gap-2 text-xs font-black text-white"><Activity className="h-4 w-4 text-emerald-400" /> Competition Breakdown</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {data.competitionBreakdown.slice(0, 6).map((row) => (
                <div key={row.competitionId} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-slate-950/45 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[10px] font-black text-white">{row.competitionName}</div>
                    <div className="mt-0.5 text-[9px] text-slate-500">{row.matches} matches • {row.goalsFor}:{row.goalsAgainst} goals</div>
                  </div>
                  <div className="flex items-center gap-1 text-[9px] font-black">
                    <span className="text-emerald-300">{row.wins}W</span>
                    <span className="text-slate-400">{row.draws}D</span>
                    <span className="text-rose-300">{row.losses}L</span>
                    <ChevronRight className="ml-1 h-3 w-3 text-slate-600" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
