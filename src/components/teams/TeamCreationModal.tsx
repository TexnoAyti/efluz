import React, { useState, useEffect } from 'react';
import { X, Shield, Ticket, AlertCircle, ExternalLink, CheckCircle2, RefreshCw, Sparkles } from 'lucide-react';
import { teamsApi } from '../../lib/teamsApi';
import { api } from '../../lib/api';
import { Team, TeamTicketAccount } from '../../types/team';

interface TeamCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (team: Team) => void;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const PRESET_LOGOS = [
  'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=160&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=160&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1518091043644-c1d4457512c6?w=160&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1511886929837-354d827aae26?w=160&auto=format&fit=crop&q=80',
];

export const TeamCreationModal: React.FC<TeamCreationModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  showToast,
}) => {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [logoUrl, setLogoUrl] = useState(PRESET_LOGOS[0]);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Ticket balance state
  const [ticketAccount, setTicketAccount] = useState<TeamTicketAccount | null>(null);
  const [loadingTickets, setLoadingTickets] = useState(true);

  // Mandatory group membership state
  const [membershipRequired, setMembershipRequired] = useState(false);
  const [groupInfo, setGroupInfo] = useState({ username: '@efleagueuz', url: 'https://t.me/efleagueuz' });
  const [isCheckingMembership, setIsCheckingMembership] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIdempotencyKey(`team_create_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
      fetchTicketBalance();
      setMembershipRequired(false);
    }
  }, [isOpen]);

  const fetchTicketBalance = async () => {
    try {
      setLoadingTickets(true);
      const acc = await teamsApi.getMyTicketBalance();
      setTicketAccount(acc);
    } catch {
      setTicketAccount(null);
    } finally {
      setLoadingTickets(false);
    }
  };

  if (!isOpen) return null;

  const handleVerifyGroupAndRetry = async () => {
    try {
      setIsCheckingMembership(true);
      const res = await api.checkTelegramMembership();
      if (res.isMember) {
        setMembershipRequired(false);
        showToast("A'zolik tasdiqlandi! Endi jamoangizni yaratishingiz mumkin.", 'success');
      } else {
        showToast("Siz hali @efleagueuz guruhiga a'zo bo'lmadingiz. Guruhga kiring va yana tekshiring.", 'error');
      }
    } catch (err: any) {
      showToast(err.message || "A'zolikni tekshirishda xatolik yuz berdi.", 'error');
    } finally {
      setIsCheckingMembership(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Team nomini kiriting.', 'error');
      return;
    }
    if (!tag.trim() || tag.trim().length < 2 || tag.trim().length > 5) {
      showToast('Team tegi (tag) 2-5 ta belgidan iborat bo‘lishi lozim.', 'error');
      return;
    }

    try {
      setIsSubmitting(true);
      const team = await teamsApi.createTeam({
        name: name.trim(),
        tag: tag.trim().toUpperCase(),
        logoUrl,
        description: description.trim(),
        idempotencyKey,
      });

      showToast(`“${team.name}” jamoasi muvaffaqiyatli yaratildi!`, 'success');
      onCreated(team);
      onClose();
    } catch (err: any) {
      if (err.code === 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED') {
        setMembershipRequired(true);
        if (err.groupUsername) {
          setGroupInfo({
            username: err.groupUsername,
            url: err.groupUrl || 'https://t.me/efleagueuz',
          });
        }
        showToast("Team yaratish uchun avval @efleagueuz guruhiga a'zo bo'lish lozim.", 'error');
        return;
      }
      showToast(err.message || 'Team yaratishda xatolik yuz berdi.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasTicket = (ticketAccount?.balance || 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-100 tracking-tight">Yangi Team Yaratish</h3>
              <p className="text-xs text-slate-400">EFL UZ da o‘z jamoangizni shakllantiring</p>
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

        {/* Loading ticket status */}
        {loadingTickets ? (
          <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
            <span className="text-xs font-semibold">Chipta holati tekshirilmoqda...</span>
          </div>
        ) : !hasTicket ? (
          /* NO TICKET AVAILABLE */
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-slate-200 space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Team yaratish chiptasi talab qilinadi</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Sizning hisobingizda team ochish uchun chipta (<code className="text-amber-300">ticket</code>) mavjud emas.
                EFLUZ platformasida o‘z jamoangizni ochish uchun loyiha egasi bilan bog‘laning.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
              <div className="text-xs text-slate-400">
                Loyiha egasi Telegram ID: <strong className="text-slate-200 font-mono">5209126900</strong>
              </div>
              <a
                href="https://t.me/texnoadmin"
                target="_blank"
                rel="noreferrer"
                className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-emerald-500/20"
              >
                <span>@texnoadmin orqali bog‘lanish</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
            >
              Yopish
            </button>
          </div>
        ) : membershipRequired ? (
          /* MANDATORY GROUP MEMBERSHIP CHECK */
          <div className="space-y-4 py-2 animate-in fade-in">
            <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-slate-200 space-y-2">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Majburiy Guruh A’zoligi</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Team yaratish va turnirlarda qatnashish uchun rasmiy{' '}
                <strong className="text-emerald-400">{groupInfo.username}</strong> Telegram guruhimizga a’zo bo‘lishingiz shart.
              </p>
            </div>

            <div className="space-y-2.5">
              <a
                href={groupInfo.url}
                target="_blank"
                rel="noreferrer"
                className="w-full min-h-[44px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors shadow-lg shadow-blue-500/20"
              >
                <span>{groupInfo.username} guruhiga qo‘shilish</span>
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
                    <span>A’zolikni tekshirish</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* TEAM CREATION FORM */
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Ticket balance badge */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold">
              <div className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-emerald-400" />
                <span>Mavjud chiptangiz:</span>
              </div>
              <strong className="text-sm font-black text-emerald-400">{ticketAccount?.balance} ta ticket</strong>
            </div>

            {/* Team Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Team Nomi <span className="text-emerald-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Masalan: Tashkent Stars, Navbahor Esports..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 text-xs placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Team Tag */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Team Qisqa Tegi (Tag) <span className="text-emerald-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Masalan: TKS, EFL, UZB (2-5 harf)"
                value={tag}
                onChange={(e) => setTag(e.target.value.toUpperCase().slice(0, 5))}
                maxLength={5}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 text-xs font-mono uppercase tracking-wider placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Logo Presets */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Team Logotipi</label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {PRESET_LOGOS.map((url, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setLogoUrl(url)}
                    className={`relative rounded-xl overflow-hidden aspect-square border-2 transition-all ${
                      logoUrl === url ? 'border-emerald-500 shadow-md shadow-emerald-500/20' : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <img src={url} alt="Logo preset" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
              <input
                type="url"
                placeholder="Yoki shaxsiy rasm havolasini kiriting (https://...)"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 text-[11px] placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Tavsif (Ixtiyoriy)</label>
              <textarea
                placeholder="Team haqida qisqacha ma'lumot..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={160}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-100 text-xs placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
              />
            </div>

            {/* Notice */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
              💡 Team yaratilganda <strong className="text-emerald-400">1 ta chipta</strong> sarflanadi.
              Siz ushbu teamning administratori bo‘lasiz va o‘z tarkibingizga yangi a’zolarni taklif qila olasiz.
            </div>

            {/* Submit button */}
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
                    <span>Yaratilmoqda...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Team Yaratish</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
