import React from 'react';

/**
 * Last-resort shell for errors outside page-level ContentBoundary, including
 * provider and layout rendering. Keep the app recoverable on Telegram WebView
 * rather than exposing a permanently blank screen.
 */
type CrashState = { crashed: boolean };

export class AppCrashBoundary extends React.Component<
  { children: React.ReactNode },
  CrashState
> {
  state: CrashState = { crashed: false };

  static getDerivedStateFromError(): CrashState {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[EFL_APP_RENDER_ERROR]', error?.message || error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <main role="alert" className="min-h-screen bg-[var(--efl-bg,#0b1020)] px-5 py-12 text-center text-[var(--efl-text,#f8fafc)]">
        <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-slate-500/40 bg-[var(--efl-surface,#172033)] p-6">
          <h1 className="text-lg font-bold">EFLUZ sahifasida xatolik yuz berdi</h1>
          <p className="text-sm opacity-80">Ma’lumotlaringiz o‘chirilmagan. Ilovani qayta oching yoki bosh sahifaga qayting.</p>
          <button type="button" onClick={() => window.location.reload()} className="w-full min-h-11 rounded-xl bg-white px-5 font-bold text-slate-950">
            Qayta yuklash
          </button>
          <button type="button" onClick={() => window.location.assign('/')} className="w-full min-h-11 rounded-xl border border-slate-500/50 px-5 font-semibold">
            Bosh sahifaga
          </button>
        </div>
      </main>
    );
  }
}
