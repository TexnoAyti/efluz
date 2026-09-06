import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { WifiOff, RefreshCw, CheckCircle2, CloudUpload, X } from 'lucide-react';

interface ResilienceData {
  isOffline: boolean;
  circuitBreaker: {
    status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failureCount: number;
    fallbackRequestCount: number;
  };
  queueStats: {
    total: number;
    pending: number;
    syncing: number;
    synced: number;
    failed: number;
  };
}

export const OfflineSyncBanner: React.FC = () => {
  const [data, setData] = useState<ResilienceData | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const checkStatus = async () => {
    if (document.hidden) return;
    try {
      const res = await api.getResilienceStatus();
      setData(res);
    } catch {
      // If server check fails entirely, assume offline
      setData((prev) => ({
        isOffline: true,
        circuitBreaker: prev?.circuitBreaker || { status: 'OPEN', failureCount: 1, fallbackRequestCount: 1 },
        queueStats: prev?.queueStats || { total: 0, pending: 0, syncing: 0, synced: 0, failed: 0 },
      }));
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await api.triggerSync();
      setSyncFeedback(
        res?.result?.processed > 0
          ? `Synced ${res.result.processed} update${res.result.processed > 1 ? 's' : ''}!`
          : 'Sync complete (no pending updates).'
      );
      await checkStatus();
      setTimeout(() => setSyncFeedback(null), 3000);
    } catch (err: any) {
      setSyncFeedback('Sync failed — Firestore quota or network offline.');
      setTimeout(() => setSyncFeedback(null), 4000);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!data || dismissed) return null;

  const isCircuitOpen = data.circuitBreaker?.status === 'OPEN' || data.isOffline;
  const pendingCount = (data.queueStats?.pending || 0) + (data.queueStats?.syncing || 0);

  // If fully online and no pending mutations, don't show banner
  if (!isCircuitOpen && pendingCount === 0 && !syncFeedback) {
    return null;
  }

  return (
    <div className="w-full bg-slate-900/90 border-b border-amber-500/30 backdrop-blur-md px-3 sm:px-4 py-2 text-xs transition-all animate-in slide-in-from-top-2 duration-200">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {isCircuitOpen ? (
            <div className="w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            </div>
          ) : pendingCount > 0 ? (
            <div className="w-6 h-6 rounded-full bg-sky-500/10 border border-sky-500/30 flex items-center justify-center shrink-0">
              <CloudUpload className="w-3.5 h-3.5 text-sky-400" />
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          )}

          <div className="min-w-0">
            {syncFeedback ? (
              <span className="font-semibold text-emerald-300">{syncFeedback}</span>
            ) : isCircuitOpen ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-bold text-amber-300">Offline Resilience Active</span>
                <span className="text-slate-400 hidden sm:inline">
                  Serving cached data. Submissions are saved locally and will auto-sync when online.
                </span>
                {pendingCount > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold">
                    {pendingCount} pending
                  </span>
                )}
              </div>
            ) : pendingCount > 0 ? (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sky-300">
                  {pendingCount} submission{pendingCount > 1 ? 's' : ''} queued locally
                </span>
                <span className="text-slate-400 hidden sm:inline">• Syncing automatically in background</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition disabled:opacity-50"
            title="Attempt manual sync with Firestore"
          >
            <RefreshCw className={`w-3 h-3 text-slate-300 ${isSyncing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1 text-slate-400 hover:text-slate-200 rounded-md transition"
            title="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
