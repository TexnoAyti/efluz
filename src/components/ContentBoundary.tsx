import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

/** Keep the app navigation available while a section downloads or fails. */
export class ContentBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) {
      return <div role="alert" className="rounded-2xl border border-slate-500/30 p-5 text-center">
        <p>Bo‘lim yuklanmadi. Qayta urinib ko‘ring.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-11 rounded-xl bg-emerald-400 px-5 font-bold text-slate-950">Qayta yuklash</button>
      </div>;
    }
    return <Suspense fallback={<div role="status" aria-live="polite" className="flex min-h-32 items-center justify-center gap-2 text-sm">
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-emerald-500" />
      <span>Yuklanmoqda…</span>
    </div>}>{this.props.children}</Suspense>;
  }
}
