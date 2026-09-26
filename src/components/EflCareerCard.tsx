import React, { useEffect, useMemo, useState } from 'react';
import { Award, Crown, Flame, LockKeyhole, ShieldCheck, Trophy } from 'lucide-react';
import { api } from '../lib/api';

interface CareerStats {
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
  points: number;
}

export const EflCareerCard: React.FC<{ userId?: string; adminPreview?: boolean }> = ({ userId, adminPreview = false }) => {
  const [stats, setStats] = useState<CareerStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) return;
    setLoading(true);
    api.getUserProfile(userId, 'season-2026-27')
      .then((res) => { if (!cancelled) setStats(res.stats); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const derived = useMemo(() => {
    if (!stats) return null;
    const winRate = stats.matchesPlayed > 0 ? Math.round((stats.wins / stats.matchesPlayed) * 100) : 0;
    return { winRate, goalDifference: stats.goalsScored - stats.goalsConceded };
  }, [stats]);

  if (!adminPreview) {
    return (
      <div className="glass-panel p-5 sm:p-6 shadow-xl border-amber-500/25 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-40 h-40 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300 shrink-0"><LockKeyhole className="w-5 h-5" /></div>
            <div>
              <div className="flex items-center gap-2"><h3 className="text-sm font-black text-white">EFL Career</h3><span className="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/15 border border-amber-500/30 text-amber-300">PREMIUM</span></div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">Career tracking barcha foydalanuvchilar uchun avtomatik ishlaydi. To‘liq career dashboard Premium bilan ochiladi.</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-300">
                <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800">W-D-L</span>
                <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800">Win rate</span>
                <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800">Goals & GD</span>
                <span className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800">Season history</span>
              </div>
            </div>
          </div>
          <div className="text-right shrink-0"><div className="text-lg font-black text-amber-300">89 ⭐</div><div className="text-[9px] uppercase font-bold text-slate-500">per season</div></div>
        </div>
        <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center gap-2 text-[10px] text-emerald-300"><ShieldCheck className="w-3.5 h-3.5" /> Tracking active — natijalar Premium olmasdan ham career’ga hisoblanadi.</div>
      </div>
    );
  }

  return (
    <div className="glass-panel p-5 sm:p-6 shadow-xl border-amber-500/30 space-y-4">
      <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-black text-white flex items-center gap-2"><Crown className="w-4 h-4 text-amber-300" /> EFL Career — Admin Preview</h3><p className="text-[10px] text-slate-500 mt-1">Same stats tracked for every player; this unrestricted view is for admin QA until Premium entitlement checkout is wired.</p></div>{loading && <span className="text-[10px] text-slate-500">Loading…</span>}</div>
      {stats && derived ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Metric icon={<Trophy className="w-3 h-3" />} label="Matches" value={stats.matchesPlayed} />
          <Metric icon={<Flame className="w-3 h-3" />} label="W-D-L" value={`${stats.wins}-${stats.draws}-${stats.losses}`} />
          <Metric icon={<Award className="w-3 h-3" />} label="Win rate" value={`${derived.winRate}%`} />
          <Metric icon={<ShieldCheck className="w-3 h-3" />} label="Goals / GD" value={`${stats.goalsScored}:${stats.goalsConceded} / ${derived.goalDifference >= 0 ? '+' : ''}${derived.goalDifference}`} />
        </div>
      ) : !loading ? <div className="text-xs text-slate-500">Career stats are not available yet.</div> : null}
    </div>
  );
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = ({ icon, label, value }) => (
  <div className="rounded-xl border border-white/[0.06] bg-slate-950/60 p-3"><div className="text-base font-black text-white font-mono">{value}</div><div className="mt-1 text-[10px] text-slate-500 flex items-center gap-1">{icon}{label}</div></div>
);
