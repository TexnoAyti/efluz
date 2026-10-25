import React, { useState, useEffect } from 'react';
import {
  X,
  Shield,
  Users,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trash2,
  RefreshCw,
  ExternalLink,
  Trophy,
} from 'lucide-react';
import { teamsApi } from '../../lib/teamsApi';
import { Team, TeamMember, TeamInvitation } from '../../types/team';
import { TeamInviteModal } from './TeamInviteModal';

interface TeamDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: Team;
  currentUserId?: string;
  isOwnerAdmin?: boolean;
  onTeamUpdated: (updated: Team) => void;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const TeamDetailModal: React.FC<TeamDetailModalProps> = ({
  isOpen,
  onClose,
  team,
  currentUserId,
  isOwnerAdmin,
  onTeamUpdated,
  showToast,
}) => {
  const [activeTab, setActiveTab] = useState<'roster' | 'invitations' | 'stats'>('roster');
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loadingInvitations, setLoadingInvitations] = useState(false);

  // Invite modal state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [linkingMember, setLinkingMember] = useState<TeamMember | null>(null);

  const isTeamAdmin = team.creatorUserId === currentUserId || Boolean(isOwnerAdmin);

  useEffect(() => {
    if (isOpen && isTeamAdmin) {
      loadInvitations();
    }
  }, [isOpen, team.id]);

  const loadInvitations = async () => {
    try {
      setLoadingInvitations(true);
      const list = await teamsApi.getTeamInvitations(team.id);
      setInvitations(list);
    } catch {
      setInvitations([]);
    } finally {
      setLoadingInvitations(false);
    }
  };

  if (!isOpen) return null;

  const handleCancelInvitation = async (invId: string) => {
    try {
      await teamsApi.cancelInvitation(invId);
      showToast('Taklif bekor qilindi.', 'info');
      await loadInvitations();
    } catch (err: any) {
      showToast(err.message || 'Taklifni bekor qilishda xatolik yuz berdi.', 'error');
    }
  };

  const handleInvited = (newInv: TeamInvitation) => {
    setInvitations((prev) => [newInv, ...prev.filter((i) => i.id !== newInv.id)]);
    showToast(`Taklif yuborildi!`, 'success');
  };

  const handleOpenLinkModal = (member: TeamMember) => {
    setLinkingMember(member);
    setInviteModalOpen(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-none">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4 mb-4">
          <div className="flex items-center gap-3">
            {team.logoUrl ? (
              <img
                src={team.logoUrl}
                alt={team.name}
                className="w-12 h-12 rounded-2xl object-cover border border-slate-700 shadow-md shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-sm shrink-0">
                {team.tag}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-slate-100 tracking-tight">{team.name}</h3>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  {team.tag}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Administrator: <strong className="text-slate-200 font-medium">@{team.creatorUsername || team.creatorTelegramId}</strong>
                {isTeamAdmin && <span className="ml-1.5 text-emerald-400 text-[10px] font-bold">(Siz boshqarasiz)</span>}
              </p>
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

        {/* Description if present */}
        {team.description && (
          <p className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80 mb-4">
            {team.description}
          </p>
        )}

        {/* Tab switcher */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-950 border border-slate-800 mb-4">
          <button
            type="button"
            onClick={() => setActiveTab('roster')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'roster'
                ? 'bg-slate-800 text-emerald-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Tarkib ({team.roster.length})</span>
          </button>

          {isTeamAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('invitations')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'invitations'
                  ? 'bg-slate-800 text-emerald-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Takliflar ({invitations.filter((i) => i.status === 'PENDING').length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('stats')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'stats'
                ? 'bg-slate-800 text-emerald-400 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Statistika</span>
          </button>
        </div>

        {/* TAB 1: ROSTER */}
        {activeTab === 'roster' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold text-slate-300">Tasdiqlangan O‘yinchilar</span>
              {isTeamAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setLinkingMember(null);
                    setInviteModalOpen(true);
                  }}
                  className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors shadow-sm"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>O‘yinchi taklif qilish</span>
                </button>
              )}
            </div>

            <div className="space-y-2">
              {team.roster.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/70 border border-slate-800"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 font-bold text-xs">
                      {member.displayName.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs text-slate-100">{member.displayName}</span>
                        {member.role === 'ADMIN' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            ADMIN
                          </span>
                        )}
                        {member.isVerifiedAccount ? (
                          <span className="inline-flex items-center gap-0.5 text-emerald-400 text-[10px] font-medium" title="Haqiqiy EFLUZ akkaunti tasdiqlangan">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Tasdiqlangan</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px]" title="Qo‘lda kiritilgan ism">
                            (Eski yozuv)
                          </span>
                        )}
                      </div>
                      {member.username && (
                        <span className="text-[11px] text-slate-400 font-mono">@{member.username}</span>
                      )}
                    </div>
                  </div>

                  {/* Link legacy member if not verified and current user is admin */}
                  {!member.isVerifiedAccount && isTeamAdmin && (
                    <button
                      type="button"
                      onClick={() => handleOpenLinkModal(member)}
                      className="py-1 px-2.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold transition-colors"
                    >
                      Haqiqiy akkauntga bog‘lash
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: INVITATIONS */}
        {activeTab === 'invitations' && isTeamAdmin && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1">
              <span className="text-xs font-bold text-slate-300">Takliflar Tarixi va Holati</span>
              <button
                type="button"
                onClick={loadInvitations}
                disabled={loadingInvitations}
                className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${loadingInvitations ? 'animate-spin' : ''}`} />
                <span>Yangilash</span>
              </button>
            </div>

            {loadingInvitations ? (
              <div className="py-8 text-center text-slate-500 text-xs">Takliflar yuklanmoqda...</div>
            ) : invitations.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs">Hozircha yuborilgan takliflar yo‘q.</div>
            ) : (
              <div className="space-y-2">
                {invitations.map((inv) => {
                  const isPending = inv.status === 'PENDING';
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/70 border border-slate-800"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-100">{inv.inviteeDisplayName}</span>
                          {inv.inviteeUsername && (
                            <span className="text-[11px] text-slate-400 font-mono">@{inv.inviteeUsername}</span>
                          )}
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              inv.status === 'ACCEPTED'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : inv.status === 'REJECTED'
                                ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                : inv.status === 'CANCELLED'
                                ? 'bg-slate-800 text-slate-400'
                                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse'
                            }`}
                          >
                            {inv.status === 'ACCEPTED'
                              ? 'Qabul qilingan'
                              : inv.status === 'REJECTED'
                              ? 'Rad etilgan'
                              : inv.status === 'CANCELLED'
                              ? 'Bekor qilingan'
                              : 'Kutilmoqda'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          Yuborilgan: {new Date(inv.sentAt).toLocaleDateString()}
                          {inv.legacyRosterMemberId && ' • Eski joyga bog‘lash'}
                        </div>
                      </div>

                      {isPending && (
                        <button
                          type="button"
                          onClick={() => handleCancelInvitation(inv.id)}
                          className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition-colors"
                          title="Taklifni bekor qilish"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: STATS */}
        {activeTab === 'stats' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-500">O‘yinlar</div>
                <div className="text-lg font-black text-slate-100">{team.stats.matchesPlayed}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-500">G‘alaba</div>
                <div className="text-lg font-black text-emerald-400">{team.stats.wins}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-500">Durang</div>
                <div className="text-lg font-black text-amber-400">{team.stats.draws}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-500">Mag‘lubiyat</div>
                <div className="text-lg font-black text-rose-400">{team.stats.losses}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-500">To‘plar Nisbati</div>
                <div className="text-sm font-black text-slate-200">
                  {team.stats.goalsFor} : {team.stats.goalsAgainst} ({team.stats.goalDifference >= 0 ? '+' : ''}{team.stats.goalDifference})
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="text-[10px] uppercase font-bold text-emerald-400">Jami Ochkolar</div>
                <div className="text-lg font-black text-emerald-400">{team.stats.points}</div>
              </div>
            </div>
          </div>
        )}

        {/* Invite Modal Sub-component */}
        <TeamInviteModal
          isOpen={inviteModalOpen}
          onClose={() => {
            setInviteModalOpen(false);
            setLinkingMember(null);
          }}
          team={team}
          legacyMemberId={linkingMember?.id}
          legacyMemberName={linkingMember?.displayName}
          onInvited={handleInvited}
          showToast={showToast}
        />
      </div>
    </div>
  );
};
