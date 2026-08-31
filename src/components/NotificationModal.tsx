import React from 'react';
import { useAuth } from '../context/AuthContext';
import {
  X,
  Bell,
  CheckCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Award,
  Calendar,
  Shield,
  Trophy,
  Sparkles,
} from 'lucide-react';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab?: (tab: any) => void;
}

export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
}) => {
  const {
    notifications,
    unreadNotificationCount,
    markNotificationsAsRead,
    markNotificationAsRead,
  } = useAuth();

  if (!isOpen) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'RESULT_CONFIRMED':
      case 'MATCH_CONFIRMED':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'DISPUTE_OPENED':
      case 'MATCH_DISPUTED':
        return <AlertTriangle className="w-4 h-4 text-rose-400" />;
      case 'DISPUTE_RESOLVED':
        return <Sparkles className="w-4 h-4 text-sky-400" />;
      case 'RESULT_SUBMITTED':
      case 'SUBMISSION_RECEIVED':
      case 'OPPONENT_SUBMITTED':
        return <Clock className="w-4 h-4 text-sky-400" />;
      case 'MATCH_SCHEDULED':
      case 'NEW_FIXTURE':
        return <Calendar className="w-4 h-4 text-indigo-400" />;
      case 'CLUB_ASSIGNED':
      case 'CLUB_CLAIMED':
        return <Shield className="w-4 h-4 text-teal-400" />;
      case 'NEXT_ROUND_MATCH':
      case 'QUALIFICATION_CONFIRMED':
      case 'COMPETITION_UPDATE':
        return <Trophy className="w-4 h-4 text-amber-400" />;
      default:
        return <Award className="w-4 h-4 text-emerald-400" />;
    }
  };

  const handleItemClick = (notif: any) => {
    if (!notif.isRead) {
      markNotificationAsRead(notif.id);
    }
    if (notif.fixtureId && onNavigateTab) {
      onNavigateTab('my-matches');
      onClose();
    } else if ((notif.type === 'CLUB_ASSIGNED' || notif.entityType === 'club') && onNavigateTab) {
      onNavigateTab('my-club');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-white flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-800/40">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-sm text-slate-100">Tournament Notifications</h3>
            {unreadNotificationCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-rose-500 text-white">
                {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadNotificationCount > 0 && (
              <button
                onClick={() => markNotificationsAsRead()}
                className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 min-h-[32px] px-2 rounded-lg hover:bg-emerald-500/10"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark read</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {notifications.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <Bell className="w-10 h-10 mx-auto text-slate-600 mb-2 opacity-50" />
              <p className="text-xs font-semibold text-slate-300">No notifications yet</p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto">
                Important match and competition updates will appear here.
              </p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => handleItemClick(notif)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  notif.isRead
                    ? 'bg-slate-950/40 border-slate-800/60 text-slate-300 hover:border-slate-700'
                    : 'bg-slate-800/80 border-emerald-500/40 text-white shadow-md hover:border-emerald-500/60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-slate-900 border border-slate-700/80 shrink-0 mt-0.5">
                    {getIcon(notif.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="flex items-center gap-1.5 truncate">
                        <h4 className="font-bold text-xs text-slate-100 truncate">{notif.title}</h4>
                        {!notif.isRead && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_4px_#10b981]" />
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {new Date(notif.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 line-clamp-2">{notif.message}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/50 text-center">
          <button
            onClick={onClose}
            className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
