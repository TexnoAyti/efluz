import React from 'react';

/**
 * Last-resort shell for errors outside page-level ContentBoundary, including
 * provider and layout rendering. Keep the app recoverable on Telegram WebView
 * rather than exposing a permanently blank screen.
 */
type CrashState = { crashed: boolean; message: string; component: string };

export class AppCrashBoundary extends React.Component<
  { children: React.ReactNode },
  CrashState
> {
  state: CrashState = { crashed: false, message: '', component: '' };

  static getDerivedStateFromError(): CrashState {
    return { crashed: true, message: '', component: '' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Provide a safe, actionable client-side diagnostic even when Vercel\n    // server logs cannot see a Telegram WebView render error.\n    this.setState({ message: String(error?.message || 'React render error').slice(0, 180), component: String(info.componentStack || '').split('\\n').find(line => line.trim().startsWith('at '))?.trim().slice(0, 100) || '' });\n    console.error('[EFL_APP_RENDER_ERROR]', error?.message || error, info.componentStack);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <main role="alert" className="min-h-screen bg-[var(--efl-bg,#0b1020)] px-5 py-12 text-center text-[var(--efl-text,#f8fafc)]">
        <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-slate-500/40 bg-[var(--efl-surface,#172033)] p-6">
          <h1 className="text-lg font-bold">EFLUZ sahifasida xatolik yuz berdi</h1>
          <p className="text-sm opacity-80">Ma’lumotlaringiz o‘chirilmagan. Ilovani qayta oching yoki bosh sahifaga qayting.</p>
          <p className="break-words rounded-lg border border-slate-500/40 p-3 text-left font-mono text-xs" data-testid="efl-error-diagnostic">{this.state.message || 'Render error'} {this.state.component}</p>\n          <button type="button" onClick={() => window.location.reload()} className="w-full min-h-11 rounded-xl bg-white px-5 font-bold text-slate-950">
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
