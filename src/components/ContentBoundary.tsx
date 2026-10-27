import React, { Suspense } from 'react';
import { AppLoading, type LoadingMode } from './AppLoading';

/** Keep the app navigation available while a section downloads or fails. */
export class ContentBoundary extends React.Component<{ children: React.ReactNode; loadingMode?: LoadingMode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) {
      return <div role="alert" className="rounded-2xl border border-slate-500/30 p-5 text-center">
        <p>Bo‘lim yuklanmadi. Qayta urinib ko‘ring.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-3 min-h-11 rounded-xl bg-emerald-400 px-5 font-bold text-slate-950">Qayta yuklash</button>
      </div>;
    }
    return <Suspense fallback={<AppLoading mode={this.props.loadingMode} />}>{this.props.children}</Suspense>;
  }
}
