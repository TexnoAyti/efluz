import { ADMIN_LEAGUES } from '../../lib/adminPermissions';
import type { AdminPermissions } from '../../types';
import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { api } from '../../lib/api';
import { useI18n } from '../../i18n';
import {
  X,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Ban,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  User as UserIcon,
  Award,
  FileText,
  Activity,
} from 'lucide-react';

interface UserDetailModalProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  onToggleAdmin: (user: User) => void;
  onToggleSuspend: (user: User) => void;
}

export const AdminUserDetailModal: React.FC<UserDetailModalProps> = ({
  user,
  isOpen,
  onClose,
  onToggleAdmin,
  onToggleSuspend,
}) => {
  const { t, language } = useI18n();
  const [detailData, setDetailData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const copy = {
    uz: { player: 'O‘yinchi', suspended: 'Cheklangan', active: 'Faol hisob', none: 'Yo‘q', firstName: 'Ism', lastName: 'Familiya', joined: 'Ro‘yxatdan o‘tgan', club: 'Faol klub', submissions: 'Natija yuborishlari', noSubmissions: 'Bu o‘yinchi hali natija yubormagan.', score: 'Hisob', actions: 'Foydalanuvchiga oid admin amallari', noActions: 'Bu hisobda admin o‘zgarishlari qayd etilmagan.' },
    ru: { player: 'Игрок', suspended: 'Ограничен', active: 'Активный аккаунт', none: 'Нет', firstName: 'Имя', lastName: 'Фамилия', joined: 'Дата регистрации', club: 'Активный клуб', submissions: 'Отправленные результаты', noSubmissions: 'Этот игрок ещё не отправлял результаты.', score: 'Счёт', actions: 'Действия администраторов по игроку', noActions: 'Изменений администраторов для этого аккаунта нет.' },
    en: { player: 'Player', suspended: 'Suspended', active: 'Active Account', none: 'None', firstName: 'First Name', lastName: 'Last Name', joined: 'Joined', club: 'Active Club', submissions: 'Result Submissions', noSubmissions: 'No score submissions recorded for this player yet.', score: 'Score', actions: 'Administrative Actions Related to User', noActions: 'No admin modifications logged for this account.' },
  }[language];

  useEffect(() => {
    if (!isOpen || !user) return;
    let isMounted = true;
    setLoading(true);

    api.adminGetUserDetail(user.id)
      .then((data) => {
        if (isMounted) setDetailData(data);
      })
      .catch((err) => {
        console.error('Failed to load user details:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, user]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel p-5 max-w-2xl w-full rounded-2xl border-emerald-500/40 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-slate-800 text-emerald-400 border border-slate-700">
              <UserIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">{t.adminUserInspection}</h3>
              <p className="text-[10px] text-slate-400">@{user.username || 'unknown'} • ID: {user.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            <span>{t.adminLoadingUserHistory}</span>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            {/* Quick Badges */}
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-900/60 border border-white/[0.04]">
              <span className={`px-2.5 py-1 rounded-lg font-black text-[10px] uppercase border ${
                user.isAdmin
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}>
                {user.isAdmin ? 'Administrator' : copy.player}
              </span>

              <span className={`px-2.5 py-1 rounded-lg font-black text-[10px] uppercase border ${
                user.isSuspended
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}>
                {user.isSuspended ? copy.suspended : copy.active}
              </span>

              <span className="text-slate-400 text-[11px] ml-auto">
                Telegram: <strong className="text-white font-mono">{user.telegramId || copy.none}</strong>
              </span>
            </div>

            {/* Profile Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase block font-bold">{copy.firstName}</span>
                <span className="text-xs font-bold text-white">{user.firstName || '—'}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase block font-bold">{copy.lastName}</span>
                <span className="text-xs font-bold text-white">{user.lastName || '—'}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase block font-bold">{copy.joined}</span>
                <span className="text-xs font-bold text-white">
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900/40 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase block font-bold">{copy.club}</span>
                <span className="text-xs font-bold text-emerald-400">
                  {detailData?.activeOccupancy?.clubId || detailData?.user?.clubId || copy.none}
                </span>
              </div>
            </div>

            {/* Submissions Section */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="text-xs font-black text-white flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-emerald-400" />
                  {copy.submissions} ({detailData?.submissions?.length ?? 0})
                </h4>
              </div>

              {detailData?.submissions?.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-900/30 border border-slate-800/80 text-slate-500 text-center text-[11px]">
                  {copy.noSubmissions}
                </div>
              ) : (
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {detailData?.submissions?.map((sub: any) => (
                    <div
                      key={sub.id}
                      className="p-2 rounded-lg bg-slate-900/50 border border-white/[0.04] flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-mono text-slate-400 text-[10px] mr-2">{sub.fixtureId}</span>
                        <span className="font-bold text-white">
                          {copy.score}: {sub.homeScore} - {sub.awayScore}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {sub.createdAt ? new Date(sub.createdAt).toLocaleDateString() : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Audit History */}
            <div>
              <h4 className="text-xs font-black text-white flex items-center gap-1.5 mb-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                {copy.actions} ({detailData?.auditLogs?.length ?? 0})
              </h4>
              {detailData?.auditLogs?.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-900/30 border border-slate-800/80 text-slate-500 text-center text-[11px]">
                  {copy.noActions}
                </div>
              ) : (
                <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                  {detailData?.auditLogs?.map((log: any) => (
                    <div
                      key={log.id}
                      className="p-2 rounded-lg bg-slate-900/50 border border-white/[0.04] flex items-center justify-between text-[11px]"
                    >
                      <div>
                        <span className="font-black text-white mr-1.5">{log.action}</span>
                        {log.notes && <span className="text-slate-400 italic">"{log.notes}"</span>}
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {log.createdAt ? new Date(log.createdAt).toLocaleDateString() : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Actions Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-white/[0.08]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onToggleAdmin(user);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition-colors ${
                    user.isAdmin
                      ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  {user.isAdmin ? t.adminDemote : t.adminPromote}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onToggleSuspend(user);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 border transition-colors ${
                    user.isSuspended
                      ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30'
                  }`}
                >
                  <Ban className="w-3.5 h-3.5" />
                  {user.isSuspended ? t.adminLiftSuspension : t.adminSuspend}
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
              >
                {t.close}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface SetRoleModalProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (isAdmin: boolean, adminPermissions?: AdminPermissions) => Promise<void>;
}

export const AdminSetRoleModal: React.FC<SetRoleModalProps> = ({
  user,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const targetIsAdmin = true;
  const [scope, setScope] = useState<'ALL' | 'LEAGUES'>(user.isAdmin && !user.adminPermissions ? 'ALL' : user.adminPermissions?.scope || 'LEAGUES');
  const [leagueIds, setLeagueIds] = useState<string[]>(user.adminPermissions?.leagueIds || []);

  if (!isOpen) return null;

  const handleAction = async (grant = true) => {
    setIsSubmitting(true);
    try {
      await onConfirm(grant, { scope, leagueIds: scope === 'ALL' ? [] : leagueIds });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-amber-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">
                {user.isAdmin ? 'Ruxsatlarni saqlash' : t.adminPromote}
              </h3>
              <p className="text-[10px] text-slate-400">{t.adminAccessControl}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] text-xs text-slate-300">
          <p className="font-bold text-white">
            @{user.username || 'player'} ({user.firstName} {user.lastName})
          </p>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">Telegram ID: {user.telegramId || user.id}</p>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {'Tanlangan ruxsatlar ushbu foydalanuvchiga beriladi.'}
        </p>

        <fieldset className="space-y-2 text-sm text-slate-200">
          <legend className="font-bold mb-2">Admin ruxsatlari</legend>
          <label className="flex gap-2"><input type="radio" name="admin-scope" checked={scope === 'LEAGUES'} onChange={() => setScope('LEAGUES')} />Faqat tanlangan ligalar</label>
          {scope === 'LEAGUES' && ADMIN_LEAGUES.map(league => <label key={league.id} className="flex gap-2 pl-5"><input type="checkbox" checked={leagueIds.includes(league.id)} onChange={event => { const checked = event.target.checked; setLeagueIds(previous => checked ? [...previous, league.id] : previous.filter(id => id !== league.id)); }} />{league.name}</label>)}
          <label className="flex gap-2"><input type="radio" name="admin-scope" checked={scope === 'ALL'} onChange={() => setScope('ALL')} />Barcha admin ruxsatlari</label>
          <p className="text-xs text-slate-400">Liga admini faqat tanlangan ligalarning klublari, o‘yinlari va turlarini boshqaradi.</p>
        </fieldset>
        {user.isAdmin && <button type="button" disabled={isSubmitting} onClick={() => handleAction(false)} className="text-sm text-rose-400">Adminlikni olib tashlash</button>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={() => handleAction()}
            disabled={isSubmitting || (scope === 'LEAGUES' && !leagueIds.length)}
            className={`px-5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 ${
              targetIsAdmin
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
            }`}
          >
            {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {user.isAdmin ? 'Ruxsatlarni saqlash' : t.adminConfirmPromotion}
          </button>
        </div>
      </div>
    </div>
  );
};

interface SuspendModalProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (isSuspended: boolean, reason?: string) => Promise<void>;
}

export const AdminSuspendModal: React.FC<SuspendModalProps> = ({
  user,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const targetSuspended = !user.isSuspended;

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onConfirm(targetSuspended, reason.trim() || undefined);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-rose-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Ban className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">
                {targetSuspended ? t.adminSuspend : t.adminLiftSuspension}
              </h3>
              <p className="text-[10px] text-slate-400">{t.adminSuspensionHint}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] text-xs text-slate-300">
          <p className="font-bold text-white">
            @{user.username || 'player'} ({user.firstName} {user.lastName})
          </p>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">Telegram ID: {user.telegramId || user.id}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {targetSuspended && (
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">{t.adminSuspendReason}</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t.adminSuspendExample}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 ${
                targetSuspended
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
              }`}
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {targetSuspended ? t.adminConfirmSuspension : t.adminLiftSuspension}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface DeleteUserModalProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
}

export const AdminDeleteUserModal: React.FC<DeleteUserModalProps> = ({
  user,
  isOpen,
  onClose,
  onConfirm,
}) => {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  if (!isOpen) return null;

  const isConfirmed = confirmText === (user.username || 'CONFIRM');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed) return;
    setIsDeleting(true);
    try {
      await onConfirm(reason.trim() || undefined);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-rose-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">{t.adminDeleteUser}</h3>
              <p className="text-[10px] text-rose-400 font-bold">{t.adminDeleteUserHint}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-xl bg-slate-900/60 border border-white/[0.04] text-xs text-slate-300">
          <p className="font-bold text-white">
            @{user.username || 'player'} ({user.firstName} {user.lastName})
          </p>
          <p className="text-[11px] text-slate-400 font-mono mt-0.5">Telegram ID: {user.telegramId || user.id}</p>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-300 space-y-1">
          <div className="flex items-center gap-1 text-emerald-400 font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t.adminSafeDeletion}:
          </div>
          <p className="text-slate-400">
            • {t.adminReleaseClubsHint}<br />
            • {t.adminPreserveMatchesHint}<br />
            • {t.adminLastAdminHint}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">{t.adminOptionalReason}</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Automated test account cleanup"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-300 block mb-1">
              {t.adminTypeToConfirm}: <span className="font-mono text-rose-400 font-black">{user.username || 'CONFIRM'}</span>
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={user.username || 'CONFIRM'}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono text-center text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={!isConfirmed || isDeleting}
              className="px-5 py-2 bg-rose-500 hover:bg-rose-400 disabled:opacity-50 disabled:hover:bg-rose-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5"
            >
              {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t.adminDeleteUser}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
