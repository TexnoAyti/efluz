import React, { useEffect, useState } from 'react';
import { CheckCircle2, Lock, RefreshCw, Trophy, Zap } from 'lucide-react';

type Phase = {
  id: string;
  label: string;
  description: string;
  status: 'COMPLETED' | 'ACTIVE' | 'LOCKED';
  confirmed: number;
  total: number;
  progress: number;
  currentMatchday: number | null;
};

type Lifecycle = {
  seasonId: string;
  currentPhase: string;
  phases: Phase[];
  overridePhase: string | null;
  overrideReason?: string | null;
};

export const SeasonLifecyclePanel: React.FC<{ seasonId?: string }> = ({ seasonId = 'season-2026-27' }) => {
  const [data, setData] = useState<Lifecycle | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/season-lifecycle?seasonId=${encodeURIComponent(seasonId)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('calendar unavailable');
      setData(await res.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [seasonId]);

  if (loading) {
    return <div className="h-24 rounded-2xl bg-white/[0.03] border border-white/[0.06] animate-pulse" />;
  }
  if (!data) return null;

  const active = data.phases.find((p) => p.status === 'ACTIVE');

  return (
    <section className="glass-panel p-4 sm:p-5 shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-black uppercase tracking-[0.16em]">
            <Trophy className="w-3.5 h-3.5" /> Season Roadmap
          </div>
          <h3 className="text-base sm:text-lg font-black text-white mt-1 truncate">
            {active?.label || '2026/27 Competition Calendar'}
          </h3>
          {active && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              {active.currentMatchday ? `Hozirgi tur: ${active.currentMatchday} • ` : ''}{active.confirmed}/{active.total} yakunlangan
            </p>
          )}
        </div>
        <button onClick={load} className="p-2 rounded-xl border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.05]" aria-label="Refresh season calendar">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {data.phases.map((phase, index) => {
          const activePhase = phase.status === 'ACTIVE';
          const complete = phase.status === 'COMPLETED';
          return (
            <div
              key={phase.id}
              className={`relative rounded-xl border p-3 min-w-0 ${
                activePhase
                  ? 'border-emerald-400/45 bg-emerald-500/10'
                  : complete
                  ? 'border-sky-400/20 bg-sky-500/[0.06]'
                  : 'border-white/[0.06] bg-white/[0.02] opacity-65'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-black text-slate-500 tabular-nums">0{index + 1}</span>
                {complete ? <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" /> : activePhase ? <Zap className="w-3.5 h-3.5 text-emerald-400" /> : <Lock className="w-3.5 h-3.5 text-slate-600" />}
              </div>
              <div className="text-[11px] font-black text-white mt-2 leading-tight">{phase.label}</div>
              <div className="text-[9px] text-slate-500 mt-1 line-clamp-2 min-h-[24px]">{phase.description}</div>
              <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full bg-emerald-400 transition-all" style={{ width: `${Math.min(100, phase.progress)}%` }} />
              </div>
              <div className="text-[9px] text-slate-500 mt-1 tabular-nums">{phase.progress}%</div>
            </div>
          );
        })}
      </div>

      {data.overridePhase && (
        <div className="mt-3 text-[10px] text-amber-300 border border-amber-500/20 bg-amber-500/[0.06] rounded-lg px-3 py-2">
          Admin override: {data.overridePhase}{data.overrideReason ? ` — ${data.overrideReason}` : ''}
        </div>
      )}
    </section>
  );
};
