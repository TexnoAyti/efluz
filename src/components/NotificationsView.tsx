import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Award,
  Sparkles,
  CheckCheck,
} from 'lucide-react';

interface NotificationsViewProps {
  onNavigateTab?: (tab: any) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({ onNavigateTab }) => {
  const { notifications, markNotificationsAsRead, unreadNotificationCount } = useAuth();
  const { t } = useI18n();

  const getIcon = (type: string) => {
    switch (type) {
      case 'SUBMISSION_RECEIVED':
        return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      case 'RESULT_CONFIRMED':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'DISPUTE_OPENED':
        return <AlertTriangle className="w-4 h-4 text-rose-400" />;
      case 'DISPUTE_RESOLVED':
        return <Sparkles className="w-4 h-4 text-sky-400" />;
      case 'NEW_FIXTURE':
        return <Calendar className="w-4 h-4 text-indigo-400" />;
      default:
        return <Award className="w-4 h-4 text-emerald-400" />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-4 sm:p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-950/80 p-2.5 border border-white/[0.08] flex items-center justify-center text-emerald-400 shrink-0">
            <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-2xl font-black text-white">{t.notificationsTitle}</h2>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Live updates on match submissions, consensus verifications, and disputes
            </p>
          </div>
        </div>

        {unreadNotificationCount > 0 && (
          <button
            onClick={markNotificationsAsRead}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl glass-card text-xs font-bold text-slate-200 active:scale-95 transition-all self-start sm:self-auto min-h-[38px] touch-manipulation"
          >
            <CheckCheck className="w-4 h-4 text-emerald-400" />
            <span>{t.markAllRead}</span>
          </button>
        )}
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="glass-panel p-10 sm:p-12 text-center text-slate-400 text-xs shadow-lg">
          <Bell className="w-10 h-10 text-slate-600 mx-auto mb-3 opacity-60" />
          <p className="font-bold text-slate-300">{t.noNotifications}</p>
          <p className="text-slate-500 mt-1">
            You will receive alerts here when opponents submit scores or when matchdays kick off.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => {
                if (onNavigateTab && notif.fixtureId) {
                  onNavigateTab('my-matches');
                }
              }}
              className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex items-start justify-between gap-3 cursor-pointer ${
                notif.isRead
                  ? 'glass-card text-slate-300'
                  : 'glass-panel border-emerald-500/50 shadow-lg shadow-emerald-500/5 text-white'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 sm:p-2.5 rounded-xl bg-slate-950/80 border border-white/[0.08] shrink-0 mt-0.5">
                  {getIcon(notif.type)}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs sm:text-sm font-bold text-white">{notif.title}</h4>
                    {!notif.isRead && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{notif.message}</p>
                  <span className="text-[10px] text-slate-500 block mt-2">
                    {new Date(notif.createdAt).toLocaleDateString()} at{' '}
                    {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
