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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-950 p-3 border border-slate-800 flex items-center justify-center text-emerald-400">
            <Bell className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white">{t.notificationsTitle}</h2>
            <p className="text-xs text-slate-400">
              Live updates on match submissions, consensus verifications, and disputes
            </p>
          </div>
        </div>

        {unreadNotificationCount > 0 && (
          <button
            onClick={markNotificationsAsRead}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 active:scale-95 transition-all self-start sm:self-auto border border-slate-700"
          >
            <CheckCheck className="w-4 h-4 text-emerald-400" />
            <span>{t.markAllRead}</span>
          </button>
        )}
      </div>

      {/* Notifications List */}
      {notifications.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 text-xs shadow-lg">
          <Bell className="w-10 h-10 text-slate-600 mx-auto mb-3" />
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
              className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-4 cursor-pointer ${
                notif.isRead
                  ? 'bg-slate-900/60 border-slate-800 text-slate-300'
                  : 'bg-slate-900 border-emerald-500/50 shadow-lg shadow-emerald-500/5 text-white'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 shrink-0 mt-0.5">
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
