import React, { useState, useEffect } from 'react';
import {
  Shield,
  Search,
  Plus,
  Users,
  Trophy,
  Ticket,
  Mail,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { teamsApi } from '../../lib/teamsApi';
import { Team, TeamInvitation, TeamTicketAccount } from '../../types/team';
import { useAuth } from '../../context/AuthContext';
import { TeamCreationModal } from './TeamCreationModal';
import { TeamDetailModal } from './TeamDetailModal';
import { UserInvitationsModal } from './UserInvitationsModal';

export const TeamsView: React.FC = () => {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [ticketAccount, setTicketAccount] = useState<TeamTicketAccount | null>(null);
  const [pendingInvitations, setPendingInvitations] = useState<TeamInvitation[]>([]);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [invitationsModalOpen, setInvitationsModalOpen] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' | 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [teamsList, balance, myInvs] = await Promise.all([
        teamsApi.getTeams(),
        teamsApi.getMyTicketBalance().catch(() => null),
        teamsApi.getMyPendingInvitations().catch(() => []),
      ]);
      setTeams(teamsList);
      setTicketAccount(balance);
      setPendingInvitations(myInvs);
    } catch (err: any) {
      showToast(err.message || 'Ma’lumotlarni yuklashda xatolik yuz berdi.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filteredTeams = teams.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.tag.toLowerCase().includes(search.toLowerCase())
  );

  const isOwner = user?.telegramId === '5209126900';

  return (
    <div className="space-y-4 pb-20 animate-in fade-in duration-200">
      {/* Toast popup */}
      {toast && (
        <div className="fixed top-20 right-4 z-50 max-w-sm p-3.5 rounded-2xl shadow-2xl border text-xs font-bold transition-all animate-in slide-in-from-top-2 duration-200 backdrop-blur-md flex items-center gap-2 bg-slate-900/95 border-emerald-500/40 text-emerald-300">
          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toast.msg}</span>
        </div>
      )}

      {/* 1. Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-3xl bg-slate-950/70 border border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Shield className="w-4 h-4" />
            </div>
            <h2 className="text-base sm:text-lg font-black text-slate-100 tracking-tight">
              EFL UZ TEAMS
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Do‘stlaringiz bilan jamoa tuzing, tarkibni shakllantiring va chempionatlarda qatnashing
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Pending Invitations Alert */}
          {pendingInvitations.length > 0 && (
            <button
              type="button"
              onClick={() => setInvitationsModalOpen(true)}
              className="min-h-[44px] flex items-center gap-1.5 py-2 px-3 rounded-2xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-bold text-xs transition-colors shadow-sm animate-pulse"
            >
              <Mail className="w-4 h-4" />
              <span>{pendingInvitations.length} ta taklif</span>
            </button>
          )}

          {/* Create Team Button */}
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="min-h-[44px] flex items-center gap-2 py-2.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-colors shadow-lg shadow-emerald-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>Team Yaratish</span>
            {ticketAccount && ticketAccount.balance > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-950 text-emerald-400 text-[10px] font-mono">
                {ticketAccount.balance}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Team nomi yoki teg bo‘yicha qidirish (UZB, EFL, Stars...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-slate-100 text-xs placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
        />
      </div>

      {/* 3. Teams List */}
      {loading ? (
        <div className="py-16 text-center text-slate-500 flex flex-col items-center gap-2">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
          <span className="text-xs font-semibold">Jamoalar yuklanmoqda...</span>
        </div>
      ) : filteredTeams.length === 0 ? (
        <div className="py-16 px-4 text-center rounded-3xl bg-slate-950/40 border border-slate-800/80 space-y-3">
          <Shield className="w-10 h-10 mx-auto text-slate-600" />
          <div>
            <h4 className="font-bold text-sm text-slate-200">
              {search ? 'Qidiruv bo‘yicha jamoa topilmadi' : 'Hozircha yaratilgan teamlar yo‘q'}
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {search
                ? 'Boshqa kalit so‘z bilan qidirib ko‘ring yoki yangi jamoa yarating.'
                : 'Birinchi bo‘lib o‘z jamoangizni oching va do‘stlaringizni taklif qiling!'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors shadow-md shadow-emerald-500/20"
          >
            Yangi Team Yaratish
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredTeams.map((team) => {
            const isUserAdmin = team.creatorUserId === user?.id;
            return (
              <div
                key={team.id}
                onClick={() => setSelectedTeam(team)}
                className="group relative p-4 rounded-3xl bg-slate-950/60 hover:bg-slate-950/90 border border-slate-800/90 hover:border-slate-700 transition-all cursor-pointer shadow-sm hover:shadow-xl space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {team.logoUrl ? (
                      <img
                        src={team.logoUrl}
                        alt={team.name}
                        className="w-12 h-12 rounded-2xl object-cover border border-slate-700 group-hover:border-emerald-500/40 transition-colors shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-sm shrink-0">
                        {team.tag}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-black text-sm text-slate-100 group-hover:text-emerald-400 transition-colors">
                          {team.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                          {team.tag}
                        </span>
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <Users className="w-3 h-3 text-slate-500" />
                          <span>{team.roster.length} a’zo</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {isUserAdmin && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      Sizning Teamingiz
                    </span>
                  )}
                </div>

                {team.description && (
                  <p className="text-[11px] text-slate-400 line-clamp-1">
                    {team.description}
                  </p>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-900 text-xs">
                  <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                    <span>O‘yin: <strong className="text-slate-200">{team.stats.matchesPlayed}</strong></span>
                    <span>G‘alaba: <strong className="text-emerald-400">{team.stats.wins}</strong></span>
                    <span>Ochko: <strong className="text-emerald-400">{team.stats.points}</strong></span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Creation Modal */}
      <TeamCreationModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={(newTeam) => {
          setTeams((prev) => [newTeam, ...prev]);
          if (ticketAccount) {
            setTicketAccount({ ...ticketAccount, balance: Math.max(0, ticketAccount.balance - 1) });
          }
        }}
        showToast={showToast}
      />

      {/* Detail Modal */}
      {selectedTeam && (
        <TeamDetailModal
          isOpen={Boolean(selectedTeam)}
          onClose={() => setSelectedTeam(null)}
          team={selectedTeam}
          currentUserId={user?.id}
          isOwnerAdmin={isOwner}
          onTeamUpdated={(updated) => {
            setSelectedTeam(updated);
            setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          }}
          showToast={showToast}
        />
      )}

      {/* User Incoming Invitations Modal */}
      <UserInvitationsModal
        isOpen={invitationsModalOpen}
        onClose={() => setInvitationsModalOpen(false)}
        invitations={pendingInvitations}
        onUpdated={loadData}
        showToast={showToast}
      />
    </div>
  );
};
