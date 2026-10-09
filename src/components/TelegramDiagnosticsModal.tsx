import React from 'react';
import { useAuth, APP_BUILD_ID } from '../context/AuthContext';
import { Shield, Smartphone, Terminal, CheckCircle2, XCircle, AlertTriangle, ExternalLink, RefreshCw, X, Server, Layers, Cpu } from 'lucide-react';

interface TelegramDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoute: string;
}

export const TelegramDiagnosticsModal: React.FC<TelegramDiagnosticsModalProps> = ({
  isOpen,
  onClose,
  currentRoute,
}) => {
  const { user, authStatus, authError, telegramDiagnostics, refreshUserData } = useAuth();

  if (!isOpen) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : currentRoute;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
                <span>Telegram WebApp Diagnostics</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {APP_BUILD_ID}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">Production environment and bridge inspector</p>
            </div>
          </div>
          <button
            id="btn-close-diagnostics"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Status Alert */}
          <div
            className={`p-3 rounded-xl border flex items-start gap-3 ${
              authStatus === 'AUTHENTICATED'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : authStatus === 'AUTH_LOADING'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {authStatus === 'AUTHENTICATED' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            ) : authStatus === 'AUTH_LOADING' ? (
              <RefreshCw className="w-4 h-4 shrink-0 text-amber-400 animate-spin mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            )}
            <div>
              <div className="font-semibold text-xs">
                Auth State: <span className="font-mono uppercase">{authStatus}</span>
              </div>
              <div className="text-[11px] opacity-90 mt-0.5">
                {authStatus === 'AUTHENTICATED'
                  ? `Authenticated as @${user?.username || 'user'} (Telegram ID: ${user?.telegramId || 'unknown'})`
                  : authStatus === 'AUTH_LOADING'
                  ? 'Initializing Telegram WebApp SDK and verifying HMAC signature...'
                  : authError || 'Operating in anonymous browser preview mode outside Telegram.'}
              </div>
            </div>
          </div>

          {/* Telemetry Grid */}
          <div className="bg-slate-950/60 rounded-xl border border-slate-800/80 p-3.5 space-y-2.5">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
              <span>Telegram WebApp Client Bridge</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-slate-300">
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Telegram SDK Script:</span>
                <span className="font-semibold font-mono flex items-center gap-1">
                  {telegramDiagnostics.sdkLoaded ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Loaded (telegram-web-app.js)
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 text-rose-400" /> Not Detected
                    </>
                  )}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Telegram.WebApp Object:</span>
                <span className="font-semibold font-mono flex items-center gap-1">
                  {telegramDiagnostics.webAppAvailable ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Available
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 text-rose-400" /> Missing
                    </>
                  )}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Platform & Version:</span>
                <span className="font-semibold font-mono text-slate-200">
                  {telegramDiagnostics.platform || 'browser'} (v{telegramDiagnostics.version || '1.0'})
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">initData Payload:</span>
                <span className="font-semibold font-mono flex items-center gap-1">
                  {telegramDiagnostics.initDataPresent ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Present (Signed)
                    </>
                  ) : (
                    <span className="text-slate-400">Not Present (Web Mode)</span>
                  )}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Telegram User:</span>
                <span className="font-semibold font-mono text-slate-200">
                  {user?.username ? `@${user.username}` : '(anonymous / browser)'}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Telegram ID:</span>
                <span className="font-semibold font-mono text-slate-200">
                  {user?.telegramId || 'none'}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Admin Privileges:</span>
                <span className="font-semibold font-mono flex items-center gap-1">
                  {user?.isAdmin ? (
                    <span className="text-emerald-400 font-bold">YES (Admin Role Verified)</span>
                  ) : (
                    <span className="text-slate-400">NO (Standard Player)</span>
                  )}
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Auth HTTP Status:</span>
                <span className={`font-semibold font-mono ${telegramDiagnostics.authHttpStatus === 200 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {telegramDiagnostics.authHttpStatus ? `HTTP ${telegramDiagnostics.authHttpStatus}` : (authStatus === 'AUTHENTICATED' ? 'HTTP 200' : 'No Response')}
                </span>
              </div>
            </div>
          </div>

          {/* Origin & Routing Verification */}
          <div className="bg-slate-950/60 rounded-xl border border-slate-800/80 p-3.5 space-y-2">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              <span>Runtime Origin & Routes</span>
            </div>

            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between items-center bg-slate-900 px-2.5 py-1.5 rounded border border-slate-800">
                <span className="text-slate-400">Origin:</span>
                <span className="text-indigo-300 truncate max-w-[280px]">{origin}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-900 px-2.5 py-1.5 rounded border border-slate-800">
                <span className="text-slate-400">Route:</span>
                <span className="text-slate-200">{currentPath}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-900 px-2.5 py-1.5 rounded border border-slate-800">
                <span className="text-slate-400">Build:</span>
                <span className="text-emerald-400 font-bold">{APP_BUILD_ID}</span>
              </div>
            </div>
          </div>

          {/* BotFather Setup Reference */}
          <div className="p-3.5 bg-indigo-950/30 border border-indigo-500/20 rounded-xl space-y-2">
            <div className="font-semibold text-indigo-300 text-[11px] flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              <span>Telegram Bot Menu Button Configuration</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              To link your bot directly to this production deployment via <strong className="text-white">@BotFather</strong>:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-300 font-mono bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
              <li>Open @BotFather in Telegram</li>
              <li>Send command: <span className="text-emerald-400">/setmenubutton</span></li>
              <li>Select your bot</li>
              <li>Enter WebApp URL: <span className="text-indigo-300">{origin || 'https://YOUR_DEPLOYED_URL'}</span></li>
              <li>Enter button title: <span className="text-amber-300">Open EFL UZ</span></li>
            </ol>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <button
            id="btn-diagnostics-refresh"
            onClick={() => refreshUserData()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Re-check Auth</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
