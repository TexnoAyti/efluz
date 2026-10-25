import React, { useState } from 'react';
import { X, UserPlus, Send, RefreshCw, AlertCircle, ShieldCheck } from 'lucide-react';
import { teamsApi } from '../../lib/teamsApi';
import { Team, TeamInvitation } from '../../types/team';

interface TeamInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: Team;
  legacyMemberId?: string;
  legacyMemberName?: string;
  onInvited: (invitation: TeamInvitation) => void;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const TeamInviteModal: React.FC<TeamInviteModalProps> = ({
  isOpen,
  onClose,
  team,
  legacyMemberId,
  legacyMemberName,
  onInvited,
  showToast,
}) => {
  const [selector, setSelector] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = selector.trim();
    if (!trimmed) {
      showToast('Foydalanuvchining Telegram ID yoki @username kiriting.', 'error');
      return;
    }

    try {
      setIsSubmitting(true);
      const inv = await teamsApi.inviteUser(team.id, {
        targetSelector: trimmed,
        legacyRosterMemberId: legacyMemberId,
      });

      showToast(`Taklif ${inv.inviteeDisplayName} foydalanuvchisiga yuborildi!`, 'success');
      onInvited(inv);
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Taklif yuborishda xatolik yuz berdi.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-100 tracking-tight">Teamga O‘yinchi Taklif Qilish</h3>
              <p className="text-xs text-slate-400">{team.name} [{team.tag}]</p>
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

        {legacyMemberName && (
          <div className="mb-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>
              Eski qo‘lda kiritilgan <strong>“{legacyMemberName}”</strong> o‘rniga haqiqiy EFLUZ akkauntini bog‘lash.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Foydalanuvchi @username yoki Telegram IDsi
            </label>
            <input
              type="text"
              required
              placeholder="Masalan: @username yoki 5209126900"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 text-xs placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 space-y-1.5 leading-relaxed">
            <div className="flex items-center gap-1.5 text-slate-300 font-bold">
              <AlertCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>Avtomatik Bot Bildirishnomasi</span>
            </div>
            <p>
              Taklif yuborilgach, foydalanuvchiga Telegram bot orqali <strong>“Qabul qilish”</strong> va <strong>“Rad etish”</strong> tugmalari bilan bildirishnoma boradi.
            </p>
            <p className="text-emerald-400/90 font-medium">
              U qabul qilmaguncha tarkibga kirmaydi va o‘yinga tanlanmaydi.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 min-h-[44px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Yuborilmoqda...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Taklif Yuborish</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
