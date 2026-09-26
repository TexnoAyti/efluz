import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck, Users } from 'lucide-react';
import { Club } from '../../types';

export const AdminClubIntegrityPanel: React.FC<{ clubs: Club[] }> = ({ clubs }) => {
  const report = useMemo(() => {
    const ownerMap = new Map<string, Club[]>();
    const warnings: string[] = [];
    let owned = 0;

    for (const club of clubs) {
      const ownerId = club.owner?.userId || club.claimedByUserId || club.occupancy?.userId;
      const ownerName = club.owner?.username || club.claimedByUsername || club.managerUsername || club.occupancy?.username;
      const markedTaken = Boolean(club.isTaken || ownerId || club.occupancy?.status === 'occupied' || club.occupancy?.status === 'owned');

      if (ownerId) {
        owned++;
        const list = ownerMap.get(ownerId) || [];
        list.push(club);
        ownerMap.set(ownerId, list);
        if (!ownerName) warnings.push(`${club.name}: owner ID bor, username yo‘q`);
      } else if (markedTaken) {
        warnings.push(`${club.name}: occupied/taken, lekin owner ID yo‘q`);
      }
    }

    const multiClubOwners = Array.from(ownerMap.entries())
      .filter(([, list]) => list.length > 1)
      .map(([userId, list]) => ({ userId, clubs: list }));

    // Multi-club is informational only because Premium can legitimately allow clubs across leagues.
    const sameLeagueConflicts = multiClubOwners.flatMap(({ userId, clubs: ownedClubs }) => {
      const byLeague = new Map<string, Club[]>();
      for (const club of ownedClubs) {
        const list = byLeague.get(club.leagueId) || [];
        list.push(club);
        byLeague.set(club.leagueId, list);
      }
      return Array.from(byLeague.entries())
        .filter(([, list]) => list.length > 1)
        .map(([leagueId, list]) => `${userId}: ${leagueId} ichida ${list.map((c) => c.name).join(', ')}`);
    });

    warnings.push(...sameLeagueConflicts.map((x) => `Same-league ownership conflict — ${x}`));

    return {
      total: clubs.length,
      owned,
      available: Math.max(0, clubs.length - owned),
      warnings,
      multiClubOwners,
    };
  }, [clubs]);

  return (
    <div className="glass-panel p-4 sm:p-5 rounded-2xl border-slate-800 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Club Owner Integrity
          </h3>
          <p className="text-[11px] text-slate-400 mt-1">96-club ownership read-model health. Multi-league owners are informational; same-league conflicts are warnings.</p>
        </div>
        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black border ${report.warnings.length ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
          {report.warnings.length ? `${report.warnings.length} warning(s)` : 'Healthy'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Loaded clubs" value={report.total} />
        <Metric label="Owned" value={report.owned} />
        <Metric label="Available" value={report.available} />
        <Metric label="Multi-club users" value={report.multiClubOwners.length} />
      </div>

      {report.warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-black text-amber-300"><AlertTriangle className="w-3.5 h-3.5" /> Integrity warnings</div>
          {report.warnings.slice(0, 12).map((warning) => <div key={warning} className="text-[10px] text-slate-300">• {warning}</div>)}
          {report.warnings.length > 12 && <div className="text-[10px] text-slate-500">+{report.warnings.length - 12} more</div>}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-emerald-300"><CheckCircle2 className="w-4 h-4" /> No ownership consistency warning detected in the loaded read-model.</div>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/[0.05] bg-slate-950/50 p-3">
    <div className="text-lg font-black text-white font-mono">{value}</div>
    <div className="text-[10px] text-slate-500 flex items-center gap-1"><Users className="w-3 h-3" />{label}</div>
  </div>
);
