import { EFL_2_DESIGN_ENABLED } from '../releaseDesign';
import React, { useState, useEffect } from 'react';
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
    user,
    notifications,
    unreadNotificationCount,
    isNotificationsLoading,
    notificationsError,
    markNotificationsAsRead,
    markNotificationAsRead,
    refreshNotifications,
  } = useAuth();
  const { t, language } = useI18n();
  useEffect(() => { void refreshNotifications(true); }, [refreshNotifications]);

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
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 efl-theme-emerald" />;
      case 'DISPUTE_OPENED':
      case 'MATCH_DISPUTED':
        return <AlertTriangle className="w-4 h-4 text-rose-400 efl-theme-rose" />;
      case 'DISPUTE_RESOLVED':
        return <Sparkles className="w-4 h-4 text-sky-400 efl-theme-sky" />;
      case 'RESULT_SUBMITTED':
      case 'SUBMISSION_RECEIVED':
      case 'OPPONENT_SUBMITTED':
        return <Clock className="w-4 h-4 text-sky-400 efl-theme-sky" />;
      case 'MATCH_SCHEDULED':
      case 'NEW_FIXTURE':
        return <Calendar className="w-4 h-4 text-indigo-400 efl-theme-indigo" />;
      case 'CLUB_ASSIGNED':
      case 'CLUB_CLAIMED':
        return <Shield className="w-4 h-4 text-teal-400" />;
      case 'NEXT_ROUND_MATCH':
      case 'QUALIFICATION_CONFIRMED':
      case 'COMPETITION_UPDATE':
        return <Trophy className="w-4 h-4 text-amber-400 efl-theme-amber" />;
      default:
        return <Award className="w-4 h-4 text-emerald-400 efl-theme-emerald" />;
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

      if (diffMins < 1) return t.notificationsJustNow;
      if (diffMins < 60) return t.notificationsMinutesAgo.replace('{count}', String(diffMins));
      if (diffHours < 24) return t.notificationsHoursAgo.replace('{count}', String(diffHours));
      if (diffDays === 1) return t.notificationsYesterday;
      if (diffDays < 7) return t.notificationsDaysAgo.replace('{count}', String(diffDays));

      return date.toLocaleDateString({ uz: 'uz-UZ', ru: 'ru-RU', en: 'en-GB' }[language], {
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-4 sm:p-6 shadow-xl border border-white/[0.08] efl-theme-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-950/80 efl-theme-surface-2 p-2.5 border border-white/[0.08] efl-theme-border flex items-center justify-center text-emerald-400 efl-theme-emerald shrink-0 shadow-inner">
            <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg sm:text-2xl font-black text-white efl-theme-text">{t.notificationsTitle}</h2>
              {unreadNotificationCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.4)]">
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount} {t.notificationsNew}
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 efl-theme-text-2 mt-0.5">
              {t.notificationsSubtitle}
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
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold active:scale-95 transition-all min-h-[38px] touch-manipulation border ${
                EFL_2_DESIGN_ENABLED
                  ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-700 efl-theme-text-2 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs'
                  : 'glass-card text-slate-200 efl-theme-text hover:text-white efl-theme-hover-text border-white/[0.08] efl-theme-border hover:border-emerald-500/40'
              }`}
            >
              <CheckCheck className={`w-4 h-4 ${EFL_2_DESIGN_ENABLED ? 'text-blue-600 efl-theme-blue dark:text-blue-400' : 'text-emerald-400 efl-theme-emerald'}`} />
              <span>{isMarkingAll ? t.notificationsMarking : t.markAllRead}</span>
            </button>
          )}

          <button
            id="btn-refresh-notifications"
            onClick={() => refreshNotifications(true)}
            disabled={isNotificationsLoading}
            className={`flex items-center justify-center p-2 rounded-xl active:scale-95 transition-all min-w-[38px] min-h-[38px] touch-manipulation border ${
              EFL_2_DESIGN_ENABLED
                ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-600 efl-theme-text-2 dark:text-slate-400 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white shadow-xs'
                : 'glass-card text-slate-300 efl-theme-text-2 hover:text-white efl-theme-hover-text border-white/[0.08] efl-theme-border'
            }`}
            title={t.notificationsRefresh}
            aria-label={t.notificationsRefresh}
          >
            <RefreshCw
              className={`w-4 h-4 ${isNotificationsLoading ? 'animate-spin text-blue-500 efl-theme-blue' : ''}`}
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
                ? EFL_2_DESIGN_ENABLED
                  ? 'bg-blue-600 text-white font-black shadow-xs'
                  : 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                : EFL_2_DESIGN_ENABLED
                ? 'bg-white efl-theme-surface dark:bg-[#111722] text-slate-600 efl-theme-text-2 dark:text-slate-400 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white border border-slate-200/80 efl-theme-border dark:border-white/10'
                : 'glass-card text-slate-400 efl-theme-text-2 hover:text-slate-200 efl-theme-hover-text'
            }`}
          >
            {t.notificationsAll} ({notifications.length})
          </button>

          <button
            onClick={() => setActiveFilter('unread')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap min-h-[34px] touch-manipulation flex items-center gap-1.5 ${
              activeFilter === 'unread'
                ? EFL_2_DESIGN_ENABLED
                  ? 'bg-blue-600 text-white font-black shadow-xs'
                  : 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                : EFL_2_DESIGN_ENABLED
                ? 'bg-white efl-theme-surface dark:bg-[#111722] text-slate-600 efl-theme-text-2 dark:text-slate-400 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white border border-slate-200/80 efl-theme-border dark:border-white/10'
                : 'glass-card text-slate-400 efl-theme-text-2 hover:text-slate-200 efl-theme-hover-text'
            }`}
          >
            <span>{t.notificationsUnread}</span>
            {unreadNotificationCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                  activeFilter === 'unread'
                    ? EFL_2_DESIGN_ENABLED
                      ? 'bg-white efl-theme-surface text-blue-600 efl-theme-blue'
                      : 'bg-slate-950 efl-theme-surface-2 text-emerald-400 efl-theme-emerald'
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
                ? EFL_2_DESIGN_ENABLED
                  ? 'bg-blue-600 text-white font-black shadow-xs'
                  : 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                : EFL_2_DESIGN_ENABLED
                ? 'bg-white efl-theme-surface dark:bg-[#111722] text-slate-600 efl-theme-text-2 dark:text-slate-400 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white border border-slate-200/80 efl-theme-border dark:border-white/10'
                : 'glass-card text-slate-400 efl-theme-text-2 hover:text-slate-200 efl-theme-hover-text'
            }`}
          >
            {t.notificationsMatches}
          </button>

          <button
            onClick={() => setActiveFilter('competitions')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap min-h-[34px] touch-manipulation ${
              activeFilter === 'competitions'
                ? EFL_2_DESIGN_ENABLED
                  ? 'bg-blue-600 text-white font-black shadow-xs'
                  : 'bg-emerald-500 text-slate-950 font-black shadow-md shadow-emerald-500/20'
                : EFL_2_DESIGN_ENABLED
                ? 'bg-white efl-theme-surface dark:bg-[#111722] text-slate-600 efl-theme-text-2 dark:text-slate-400 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white border border-slate-200/80 efl-theme-border dark:border-white/10'
                : 'glass-card text-slate-400 efl-theme-text-2 hover:text-slate-200 efl-theme-hover-text'
            }`}
          >
            {t.notificationsUpdates}
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
              className={`p-4 rounded-2xl border animate-pulse flex items-start gap-3.5 ${
                EFL_2_DESIGN_ENABLED
                  ? 'bg-white efl-theme-surface dark:bg-[#111722] border-slate-200/80 efl-theme-border dark:border-white/10 shadow-xs'
                  : 'glass-card border-white/[0.06] efl-theme-border'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl shrink-0 ${
                  EFL_2_DESIGN_ENABLED ? 'bg-slate-200 efl-theme-surface-2 dark:bg-white/10' : 'bg-slate-800/60 efl-theme-surface-2'
                }`}
              />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <div className={`h-4 rounded w-1/3 ${EFL_2_DESIGN_ENABLED ? 'bg-slate-200 efl-theme-surface-2 dark:bg-white/10' : 'bg-slate-800/80 efl-theme-surface-2'}`} />
                  <div className={`h-3 rounded w-16 ${EFL_2_DESIGN_ENABLED ? 'bg-slate-200 efl-theme-surface-2 dark:bg-white/10' : 'bg-slate-800/60 efl-theme-surface-2'}`} />
                </div>
                <div className={`h-3 rounded w-4/5 ${EFL_2_DESIGN_ENABLED ? 'bg-slate-100 efl-theme-surface-2 dark:bg-white/5' : 'bg-slate-800/50 efl-theme-surface-2'}`} />
                <div className={`h-3 rounded w-1/2 ${EFL_2_DESIGN_ENABLED ? 'bg-slate-100 efl-theme-surface-2 dark:bg-white/5' : 'bg-slate-800/40 efl-theme-surface-2'}`} />
              </div>
            </div>
          ))}
        </div>
      ) : notificationsError && notifications.length === 0 ? (
        /* ERROR STATE */
        <div
          className={`p-8 sm:p-10 text-center text-xs shadow-xl border rounded-3xl ${
            EFL_2_DESIGN_ENABLED
              ? 'bg-rose-50/50 efl-theme-rose-soft dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/40 text-rose-700 efl-theme-rose dark:text-rose-400'
              : 'glass-panel text-slate-400 efl-theme-text-2 border-rose-500/20'
          }`}
        >
          <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 efl-theme-rose mx-auto mb-3.5 shadow-inner">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className={`text-sm sm:text-base font-bold ${EFL_2_DESIGN_ENABLED ? 'text-slate-900 efl-theme-text dark:text-white' : 'text-slate-200 efl-theme-text'}`}>
            {t.notificationsLoadError}
          </h3>
          <p className="text-slate-500 efl-theme-text-2 dark:text-slate-400 mt-1 mb-5">{t.notificationsTryAgain}</p>
          <button
            id="btn-retry-notifications"
            onClick={() => refreshNotifications(true)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-black text-xs active:scale-95 transition-all shadow-md ${
              EFL_2_DESIGN_ENABLED
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-emerald-500/20'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t.notificationsRetry}</span>
          </button>
        </div>
      ) : notifications.length === 0 ? (
        /* EMPTY STATE - NO NOTIFICATIONS */
        <div
          className={`p-10 sm:p-14 text-center text-xs shadow-lg border rounded-3xl ${
            EFL_2_DESIGN_ENABLED
              ? 'preview-surface border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-500 efl-theme-text-2 dark:text-slate-400'
              : 'glass-panel text-slate-400 efl-theme-text-2 border-white/[0.08] efl-theme-border'
          }`}
        >
          <div
            className={`w-12 h-12 rounded-2xl border flex items-center justify-center mx-auto mb-3.5 ${
              EFL_2_DESIGN_ENABLED
                ? 'bg-slate-100 efl-theme-surface-2 dark:bg-white/5 border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-400 efl-theme-text-2'
                : 'bg-slate-950/80 efl-theme-surface-2 border-white/[0.08] efl-theme-border text-slate-500 efl-theme-text-2 shadow-inner'
            }`}
          >
            <Bell className="w-6 h-6 opacity-60" />
          </div>
          <h3 className={`text-sm sm:text-base font-bold ${EFL_2_DESIGN_ENABLED ? 'text-slate-900 efl-theme-text dark:text-white' : 'text-slate-200 efl-theme-text'}`}>
            {t.noNotifications}
          </h3>
          <p className="text-slate-500 efl-theme-text-2 dark:text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
            {t.notificationsEmptyHint}
          </p>
        </div>
      ) : filteredNotifications.length === 0 ? (
        /* FILTER EMPTY STATE */
        <div
          className={`p-8 sm:p-10 text-center text-xs shadow-lg border rounded-3xl ${
            EFL_2_DESIGN_ENABLED
              ? 'preview-surface border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-500 efl-theme-text-2 dark:text-slate-400'
              : 'glass-panel text-slate-400 efl-theme-text-2 border-white/[0.08] efl-theme-border'
          }`}
        >
          <div
            className={`w-10 h-10 rounded-xl border flex items-center justify-center mx-auto mb-3 ${
              EFL_2_DESIGN_ENABLED
                ? 'bg-blue-500/10 border-blue-500/25 text-blue-600 efl-theme-blue dark:text-blue-400'
                : 'bg-slate-950/80 efl-theme-surface-2 border-white/[0.08] efl-theme-border text-emerald-400 efl-theme-emerald shadow-inner'
            }`}
          >
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <h3 className={`text-sm font-bold ${EFL_2_DESIGN_ENABLED ? 'text-slate-900 efl-theme-text dark:text-white' : 'text-slate-200 efl-theme-text'}`}>
            {t.notificationsCaughtUp}
          </h3>
          <p className="text-slate-500 efl-theme-text-2 dark:text-slate-400 mt-1 mb-4">{t.notificationsFilterEmpty}</p>
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              EFL_2_DESIGN_ENABLED
                ? 'bg-slate-100 efl-theme-surface-2 dark:bg-white/5 border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-700 efl-theme-text-2 dark:text-slate-300 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white'
                : 'glass-card text-slate-300 efl-theme-text-2 hover:text-white efl-theme-hover-text'
            }`}
          >
            {t.notificationsViewAll}
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
                  ? EFL_2_DESIGN_ENABLED
                    ? 'bg-slate-50 efl-theme-surface-2 dark:bg-white/5 border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-600 efl-theme-text-2 dark:text-slate-400 hover:bg-slate-100 efl-theme-hover-surface dark:hover:bg-white/10'
                    : 'glass-card text-slate-300 efl-theme-text-2 hover:border-white/[0.15]'
                  : EFL_2_DESIGN_ENABLED
                  ? 'bg-white efl-theme-surface dark:bg-[#111722] border-blue-500/40 shadow-xs text-slate-900 efl-theme-text dark:text-white hover:border-blue-500/60'
                  : 'glass-panel border-emerald-500/40 shadow-lg shadow-emerald-500/5 text-white efl-theme-text hover:border-emerald-500/60'
              }`}
            >
              <div className="flex items-start gap-3.5 min-w-0 flex-1">
                {/* Type Icon Container */}
                <div
                  className={`p-2 sm:p-2.5 rounded-xl border shrink-0 mt-0.5 ${
                    EFL_2_DESIGN_ENABLED
                      ? notif.isRead
                        ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border-slate-200/80 efl-theme-border dark:border-white/10'
                        : 'bg-blue-50 efl-theme-blue-soft dark:bg-blue-500/10 border-blue-500/30'
                      : notif.isRead
                      ? 'bg-slate-950/80 efl-theme-surface-2 border-white/[0.08] efl-theme-border'
                      : 'bg-slate-950/80 efl-theme-surface-2 border-emerald-500/30'
                  }`}
                >
                  {getNotificationIcon(notif.type)}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4
                      className={`text-xs sm:text-sm font-bold truncate ${
                        notif.isRead
                          ? EFL_2_DESIGN_ENABLED
                            ? 'text-slate-700 efl-theme-text-2 dark:text-slate-300'
                            : 'text-slate-200 efl-theme-text'
                          : EFL_2_DESIGN_ENABLED
                          ? 'text-slate-900 efl-theme-text dark:text-white'
                          : 'text-white efl-theme-text'
                      }`}
                    >
                      {notif.title}
                    </h4>
                    {!notif.isRead && (
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          EFL_2_DESIGN_ENABLED
                            ? 'bg-blue-600 dark:bg-blue-400'
                            : 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                        }`}
                      />
                    )}
                  </div>
                  <p
                    className={`text-xs mt-1 leading-relaxed break-words ${
                      EFL_2_DESIGN_ENABLED ? 'text-slate-500 efl-theme-text-2 dark:text-slate-400' : 'text-slate-400 efl-theme-text-2'
                    }`}
                  >
                    {notif.message}
                  </p>

                  <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                    <span className="text-[10px] text-slate-400 efl-theme-text-2 dark:text-slate-500 font-medium">
                      {formatTimestamp(notif.createdAt)}
                    </span>

                    {notif.fixtureId && (
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold group-hover:underline ${
                          EFL_2_DESIGN_ENABLED ? 'text-blue-600 efl-theme-blue dark:text-blue-400' : 'text-emerald-400 efl-theme-emerald'
                        }`}
                      >
                        <span>{t.notificationsViewMatch}</span>
                        <ExternalLink className="w-3 h-3" />
                      </span>
                    )}

                    {(notif.type === 'CLUB_ASSIGNED' || notif.entityType === 'club') && (
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold group-hover:underline ${
                          EFL_2_DESIGN_ENABLED ? 'text-blue-600 efl-theme-blue dark:text-blue-400' : 'text-teal-400'
                        }`}
                      >
                        <span>{t.notificationsViewClub}</span>
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
                  className={`p-1.5 rounded-lg shrink-0 touch-manipulation transition-colors ${
                    EFL_2_DESIGN_ENABLED
                      ? 'bg-white efl-theme-surface dark:bg-[#171e2c] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-400 efl-theme-text-2 hover:text-blue-600 dark:hover:text-blue-400 shadow-xs'
                      : 'glass-button text-slate-400 efl-theme-text-2 hover:text-emerald-400 hover:border-emerald-500/40'
                  }`}
                  title={t.notificationsMarkRead}
                  aria-label={t.notificationsMarkRead}
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
