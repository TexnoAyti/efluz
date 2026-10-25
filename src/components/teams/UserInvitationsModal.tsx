import React, { useState } from 'react';
import { X, Mail, CheckCircle2, XCircle, Shield, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';
import { teamsApi } from '../../lib/teamsApi';
import { api } from '../../lib/api';
import { TeamInvitation } from '../../types/team';

interface UserInvitationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  invitations: TeamInvitation[];
  onUpdated: () => void;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const UserInvitationsModal: React.FC<UserInvitationsModalProps> = ({
  isOpen,
  onClose,
  invitations,
  onUpdated,
  showToast,
}) => {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  // Group membership required state
  const [membershipModal, setMembershipModal] = useState<{
    pendingInvId: string;
    groupUsername: string;
    groupUrl: string;
  } | null>(null);
  const [isCheckingMembership, setIsCheckingMembership] = useState(false);

  if (!isOpen) return null;

  const handleRespond = async (invitationId: string, accept: boolean) => {
    try {
      setLoadingId(invitationId);
      const res = await teamsApi.respondToInvitation(invitationId, accept);
      showToast(res.message, accept ? 'success' : 'info');
      onUpdated();
      if (invitations.length <= 1) {
        onClose();
      }
    } catch (err: any) {
      if (err.code === 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED' && accept) {
        setMembershipModal({
          pendingInvId: invitationId,
          groupUsername: err.groupUsername || '@efleagueuz',
          groupUrl: err.groupUrl || 'https://t.me/efleagueuz',
        });
        showToast("Jamoaga qo‘shilish uchun avval @efleagueuz guruhiga a’zo bo‘lishingiz lozim.", 'error');
        return;
      }
      showToast(err.message || 'Javob berishda xatolik yuz berdi.', 'error');
    } finally {
      setLoadingId(null);
    }
  };

  const handleVerifyGroupAndRetry = async () => {
    if (!membershipModal) return;
    try {
      setIsCheckingMembership(true);
      const checkRes = await api.checkTelegramMembership();
      if (checkRes.isMember) {
        const invId = membershipModal.pendingInvId;
        setMembershipModal(null);
        showToast("A'zolik tasdiqlandi! Taklif qabul qilinmoqda...", 'success');
        await handleRespond(invId, true);
      } else {
        showToast("Siz hali @efleagueuz guruhiga a'zo bo'lmadingiz. Guruhga kiring va yana tekshiring.", 'error');
      }
    } catch (err: any) {
      showToast(err.message || "A'zolikni tekshirishda xatolik yuz berdi.", 'error');
    } finally {
      setIsCheckingMembership(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto scrollbar-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-100 tracking-tight">Menga Kelgan Takliflar</h3>
              <p className="text-xs text-slate-400">Jamoalardan kelgan a’zolik takliflari</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Group membership modal interceptor */}
        {membershipModal ? (
          <div className="space-y-4 py-2 animate-in fade-in">
            <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-slate-200 space-y-2">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Majburiy Guruh A’zoligi</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Jamoaga a’zo bo‘lish va rasmiy o‘yinlarda qatnashish uchun rasmiy{' '}
                <strong className="text-emerald-400">{membershipModal.groupUsername}</strong> guruhimizga a’zo bo‘lishingiz lozim.
              </p>
            </div>

            <div className="space-y-2.5">
              <a
                href={membershipModal.groupUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full min-h-[44px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors shadow-lg shadow-blue-500/20"
              >
                <span>{membershipModal.groupUsername} guruhiga qo‘shilish</span>
                <ExternalLink className="w-4 h-4" />
              </a>

              <button
                type="button"
                onClick={handleVerifyGroupAndRetry}
                disabled={isCheckingMembership}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                {isCheckingMembership ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Tekshirilmoqda...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>A’zolikni tekshirish va Qabul qilish</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setMembershipModal(null)}
                className="w-full py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Orqaga
              </button>
            </div>
          </div>
        ) : invitations.length === 0 ? (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <Mail className="w-8 h-8 mx-auto text-slate-600" />
            <p className="text-xs font-semibold">Sizda hozircha kutilayotgan takliflar yo‘q.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {invitations.map((inv) => {
              const isLoading = loadingId === inv.id;
              return (
                <div
                  key={inv.id}
                  className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {inv.teamLogoUrl ? (
                        <img
                          src={inv.teamLogoUrl}
                          alt={inv.teamName}
                          className="w-10 h-10 rounded-xl object-cover border border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs shrink-0">
                          {inv.teamTag}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-xs text-slate-100">{inv.teamName}</h4>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                            {inv.teamTag}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Taklif qiluvchi: <strong className="text-slate-200">{inv.inviterDisplayName}</strong>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleRespond(inv.id, false)}
                      disabled={isLoading}
                      className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4 text-rose-400" />
                      <span>Rad etish</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespond(inv.id, true)}
                      disabled={isLoading}
                      className="flex-1 min-h-[40px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                    >
                      {isLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      <span>Qabul qilish</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
