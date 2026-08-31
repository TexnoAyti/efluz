import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { Notification } from '../types';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Award,
  Sparkles,
  CheckCheck,
  RotateCcw,
  RefreshCw,
  Clock,
  Shield,
  Trophy,
  AlertCircle,
  ExternalLink,
  Check,
  Layers,
} from 'lucide-react';

interface NotificationsViewProps {
  onNavigateTab?: (tab: any) => void;
}

type FilterType = 'all' | 'unread' | 'matches' | 'competitions';

export const NotificationsView: React.FC<NotificationsViewProps> = ({ onNavigateTab }) => {
  const {
    notifications,
    unreadNotificationCount,
    isNotificationsLoading,
    notificationsError,
    markNotificationsAsRead,
    markNotificationAsRead,
    refreshNotifications,
  } = useAuth();
  const { t } = useI18n();

  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState<boolean>(false);

  const handleMarkAllAsRead = async () => {
    setIsMarkingAll(true);
    try {
      await markNotificationsAsRead();
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleMarkSingleRead = async (e: React.MouseEvent, notifId: string) => {
    e.stopPropagation();
    setMarkingReadId(notifId);
    try {
      await markNotificationAsRead(notifId);
    } finally {
      setMarkingReadId(null);
    }
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!notif.isRead) {
      markNotificationAsRead(notif.id);
    }
    if (notif.fixtureId && onNavigateTab) {
      onNavigateTab('my-matches');
    } else if ((notif.type === 'CLUB_ASSIGNED' || notif.entityType === 'club') && onNavigateTab) {
      onNavigateTab('my-club');
    }
  };

  const getNotificationIcon = (type: string) => {
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

  const formatTimestamp = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  // Filtered list
  const filteredNotifications = notifications.filter((n) => {
    if (activeFilter === 'unread') return !n.isRead;
    if (activeFilter === 'matches') {
      return [
        'MATCH_SCHEDULED',
        'NEW_FIXTURE',
        'RESULT_SUBMITTED',
        'SUBMISSION_RECEIVED',
        'OPPONENT_SUBMITTED',
        'RESULT_CONFIRMED',
        'MATCH_CONFIRMED',
        'DISPUTE_OPENED',
        'MATCH_DISPUTED',
        'DISPUTE_RESOLVED',
      ].includes(n.type);
    }
    if (activeFilter === 'competitions') {
      return [
        'CLUB_ASSIGNED',
        'CLUB_CLAIMED',
        'NEXT_ROUND_MATCH',
        'QUALIFICATION_CONFIRMED',
        'COMPETITION_UPDATE',
      ].includes(n.type);
    }
    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20 max-w-4xl mx-auto">
      {/* Header Container */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-4 sm:p-6 shadow-xl border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-950/80 p-2.5 border border-white/[0.08] flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
            <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-2xl font-black text-white">{t.notificationsTitle}</h2>
              {unreadNotificationCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.4)]">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount} new
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
              Live updates on match submissions, consensus verifications, and disputes
            </p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {unreadNotificationCount > 0 && (
            <button
              id="btn-mark-all-notifications-read"
              onClick={handleMarkAllAsRead}
              disabled={isMarkingAll}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl glass-card text-xs font-bold text-slate-200 hover:text-white active:scale-95 transition-all min-h-[38px] touch-manipulation border border-white/[0.08] hover:border-emerald-500/40"
            >
              <CheckCheck className="w-4 h-4 text-emerald-400" />
              <span>{isMarkingAll ? 'Marking...' : t.markAllRead}</span>
            </button>
          )}

          <button
            id="btn-refresh-notifications"
            onClick={() => refreshNotifications(true)}
            disabled={isNotificationsLoading}
            className="flex items-center justify-center p-2 rounded-xl glass-card text-slate-300 hover:text-white active:scale-95 transition-all min-w-[38px] min-h-[38px] touch-manipulation border border-white/[0.08]"
            title="Refresh notifications"
            aria-label="Refresh notifications"
          >
            <RefreshCw
              className={`w-4 h-4 ${isNotificationsLoading ? 'animate-spin text-emerald-400' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      {notifications.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap min-h-[34px] touch-manipulation ${
              activeFilter === 'all'
                ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                : 'glass-card text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({notifications.length})
          </button>

          <button
            onClick={() => setActiveFilter('unread')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap min-h-[34px] touch-manipulation flex items-center gap-1.5 ${
              activeFilter === 'unread'
                ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                : 'glass-card text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Unread</span>
            {unreadNotificationCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  activeFilter === 'unread'
                    ? 'bg-slate-950 text-emerald-400'
                    : 'bg-rose-500 text-white'
                }`}
              >
                {unreadNotificationCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveFilter('matches')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap min-h-[34px] touch-manipulation ${
              activeFilter === 'matches'
                ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                : 'glass-card text-slate-400 hover:text-slate-200'
            }`}
          >
            Matches
          </button>

          <button
            onClick={() => setActiveFilter('competitions')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap min-h-[34px] touch-manipulation ${
              activeFilter === 'competitions'
                ? 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                : 'glass-card text-slate-400 hover:text-slate-200'
            }`}
          >
            Updates
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {isNotificationsLoading && notifications.length === 0 ? (
        /* LOADING STATE (Skeleton) */
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="glass-card p-4 rounded-2xl border border-white/[0.06] animate-pulse flex items-start gap-3.5"
            >
              <div className="w-9 h-9 rounded-xl bg-slate-800/60 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-4 bg-slate-800/80 rounded w-1/3" />
                  <div className="h-3 bg-slate-800/60 rounded w-16" />
                </div>
                <div className="h-3 bg-slate-800/50 rounded w-4/5" />
                <div className="h-3 bg-slate-800/40 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : notificationsError && notifications.length === 0 ? (
        /* ERROR STATE */
        <div className="glass-panel p-8 sm:p-10 text-center text-slate-400 text-xs shadow-xl border border-rose-500/20">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto mb-3.5 shadow-inner">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-200">Couldn't load notifications</h3>
          <p className="text-slate-400 mt-1 mb-5">Please try again.</p>
          <button
            id="btn-retry-notifications"
            onClick={() => refreshNotifications(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-black text-xs hover:bg-emerald-400 active:scale-95 transition-all shadow-md shadow-emerald-500/20"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : notifications.length === 0 ? (
        /* EMPTY STATE - NO NOTIFICATIONS */
        <div className="glass-panel p-10 sm:p-14 text-center text-slate-400 text-xs shadow-lg border border-white/[0.08]">
          <div className="w-12 h-12 rounded-2xl bg-slate-950/80 border border-white/[0.08] flex items-center justify-center text-slate-500 mx-auto mb-3.5 shadow-inner">
            <Bell className="w-6 h-6 opacity-60" />
          </div>
          <h3 className="text-sm sm:text-base font-bold text-slate-200">No notifications yet</h3>
          <p className="text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
            Important match and competition updates will appear here.
          </p>
        </div>
      ) : filteredNotifications.length === 0 ? (
        /* FILTER EMPTY STATE */
        <div className="glass-panel p-8 sm:p-10 text-center text-slate-400 text-xs shadow-lg border border-white/[0.08]">
          <div className="w-10 h-10 rounded-xl bg-slate-950/80 border border-white/[0.08] flex items-center justify-center text-emerald-400 mx-auto mb-3 shadow-inner">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-200">All caught up</h3>
          <p className="text-slate-400 mt-1 mb-4">No notifications match the selected filter.</p>
          <button
            onClick={() => setActiveFilter('all')}
            className="px-3.5 py-1.5 rounded-xl glass-card text-xs font-bold text-slate-300 hover:text-white"
          >
            View all notifications
          </button>
        </div>
      ) : (
        /* NOTIFICATIONS LIST */
        <div className="space-y-3">
          {filteredNotifications.map((notif) => (
            <div
              key={notif.id}
              onClick={() => handleNotificationClick(notif)}
              className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex items-start justify-between gap-3 cursor-pointer group ${
                notif.isRead
                  ? 'glass-card text-slate-300 hover:border-white/[0.15]'
                  : 'glass-panel border-emerald-500/40 shadow-lg shadow-emerald-500/5 text-white hover:border-emerald-500/60'
              }`}
            >
              <div className="flex items-start gap-3.5 min-w-0 flex-1">
                {/* Type Icon Container */}
                <div
                  className={`p-2 sm:p-2.5 rounded-xl bg-slate-950/80 border shrink-0 mt-0.5 ${
                    notif.isRead ? 'border-white/[0.08]' : 'border-emerald-500/30'
                  }`}
                >
                  {getNotificationIcon(notif.type)}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4
                      className={`text-xs sm:text-sm font-bold truncate ${
                        notif.isRead ? 'text-slate-200' : 'text-white'
                      }`}
                    >
                      {notif.title}
                    </h4>
                    {!notif.isRead && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981] shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed break-words">
                    {notif.message}
                  </p>

                  <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                    <span className="text-[10px] text-slate-500 font-medium">
                      {formatTimestamp(notif.createdAt)}
                    </span>

                    {notif.fixtureId && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 group-hover:underline">
                        <span>View Match</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    )}

                    {(notif.type === 'CLUB_ASSIGNED' || notif.entityType === 'club') && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-400 group-hover:underline">
                        <span>View Club</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Single item mark read button */}
              {!notif.isRead && (
                <button
                  onClick={(e) => handleMarkSingleRead(e, notif.id)}
                  disabled={markingReadId === notif.id}
                  className="p-1.5 rounded-lg glass-button text-slate-400 hover:text-emerald-400 hover:border-emerald-500/40 shrink-0 touch-manipulation"
                  title="Mark as read"
                  aria-label="Mark as read"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
