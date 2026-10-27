import React from 'react';

export type LoadingMode = 'screen' | 'section' | 'overlay';

/** The initial HTML and React use the same mark, geometry and critical stylesheet. */
export function AppLoading({ mode = 'section' }: { mode?: LoadingMode }) {
  return <div className={`efl-loading efl-loading--${mode}`} role="status" aria-live="polite" aria-label="EFL UZ yuklanmoqda">
    <div className="efl-loading-content">
      {mode === 'screen' && <div className="efl-loading-brand">
        <img className="efl-loading-logo-dark" src="/efluz-logo.png" alt="EFL UZ" width="144" height="52" />
        <img className="efl-loading-logo-light" src="/efluz-logo-light.png" alt="" aria-hidden="true" width="144" height="52" />
      </div>}
      <div className="efl-loading-track" aria-hidden="true"><span /></div>
      <span className="efl-loading-label">Yuklanmoqda<span aria-hidden="true">…</span></span>
    </div>
  </div>;
}
