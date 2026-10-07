import React, { useState, useEffect } from 'react';
import {
  Trophy,
  Plus,
  Ticket,
  Search,
  Filter,
  Users,
  ExternalLink,
  Shield,
  Layers,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { CustomTournament, CustomTournamentFormat, CustomTournamentStatus } from '../../types/customTournament';
import { customTournamentApi } from '../../lib/customTournamentApi';
import { TournamentCard } from './TournamentCard';
import { TournamentWizardModal } from './TournamentWizardModal';
import { TournamentDetailView } from './TournamentDetailView';
import { AdminTicketManagementModal } from './AdminTicketManagementModal';
import { useAuth } from '../../context/AuthContext';

export const TournamentListView: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'all' | 'my'>('all');
  const [tournaments, setTournaments] = useState<CustomTournament[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [formatFilter, setFormatFilter] = useState<string>('ALL');

  // Ticket balance
  const [ticketBalance, setTicketBalance] = useState<number>(0);
  const [loadingTickets, setLoadingTickets] = useState(true);

  // Modals
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [showAdminTicketModal, setShowAdminTicketModal] = useState(false);

  const isPrimaryOwner = String(user?.telegramId || '').trim() === '5209126900';

  const fetchTournaments = async () => {
    try {
      setIsLoading(true);
      if (activeTab === 'all') {
        const list = await customTournamentApi.getPublicTournaments(40);
        setTournaments(list);
      } else {
        const list = await customTournamentApi.getMyTournaments();
        setTournaments(list);
      }
    } catch (err) {
      console.error('Failed to load tournaments:', err);
      setTournaments([]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTickets = async () => {
    try {
      setLoadingTickets(true);
      const acc = await customTournamentApi.getTicketBalance();
      setTicketBalance(acc?.balance || 0);
    } catch {
      setTicketBalance(0);
    } finally {
      setLoadingTickets(false);
    }
  };

  useEffect(() => {
    fetchTournaments();
  }, [activeTab]);

  useEffect(() => {
    fetchTickets();
  }, []);

  // Filter tournaments
  const filteredTournaments = tournaments.filter((t) => {
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'ALL' || t.status === statusFilter;
    const matchesFormat = formatFilter === 'ALL' || t.format === formatFilter;

    return matchesSearch && matchesStatus && matchesFormat;
  });

  if (selectedTournamentId) {
    return (
      <TournamentDetailView
        tournamentId={selectedTournamentId}
        onBack={() => {
          setSelectedTournamentId(null);
          fetchTournaments();
        }}
      />
    );
  }

  return (
    <div className="space-y-4 pb-20 animate-in fade-in duration-200">
      {/* 1. Header Banner & Ticket Balance Card */}
      <div className="p-4 sm:p-5 rounded-3xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-100 tracking-tight">Jamoa Turnirlari</h2>
              <p className="text-xs text-slate-400">O‘z ligangizni yarating yoki do‘stlaringiz bilan kubok o‘ynang</p>
            </div>
          </div>

          {/* Ticket Balance & Action */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
              <Ticket className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-400">Chiptalar:</span>
              <strong className="text-slate-100 font-bold">{loadingTickets ? '...' : ticketBalance}</strong>
            </div>

            {isPrimaryOwner && (
              <button
                onClick={() => setShowAdminTicketModal(true)}
                className="px-2.5 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-bold border border-amber-500/30 transition-colors"
              >
                Admin
              </button>
            )}

            <button
              onClick={() => setShowWizardModal(true)}
              className="py-1.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-all flex items-center gap-1 shadow-md shadow-emerald-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Turnir yaratish</span>
            </button>
          </div>
        </div>

        {/* Informative notice on how to get tickets if user has 0 */}
        {ticketBalance === 0 && !loadingTickets && (
          <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-amber-300">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>1 ta turnir yaratish = 15 000 so‘m (1 chipta). Qoralama yaratish va sozlash mutlaqo bepul!</span>
            </div>
            <a
              href="https://t.me/texnoadmin"
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 rounded-xl bg-amber-400 text-slate-950 font-black text-[11px] shrink-0 hover:bg-amber-300 transition-colors flex items-center gap-1"
            >
              <span>@texnoadmin</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

      {/* 2. Section Selector: Barcha turnirlar vs Mening turnirlarim */}
      <div className="p-1 rounded-2xl bg-slate-900 border border-slate-800 flex items-center gap-1 shadow-xs">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'all'
              ? 'bg-slate-800 text-emerald-400 shadow-sm font-black'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Barcha turnirlar</span>
        </button>
        <button
          onClick={() => setActiveTab('my')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            activeTab === 'my'
              ? 'bg-slate-800 text-emerald-400 shadow-sm font-black'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Mening turnirlarim</span>
        </button>
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Turnir nomi bo‘yicha qidirish..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-2xl pl-10 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 shadow-xs"
          />
        </div>

        {/* Chips for filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1">
          {['ALL', 'REGISTRATION_OPEN', 'IN_PROGRESS', 'COMPLETED'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors ${
                statusFilter === st
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {st === 'ALL' ? 'Barcha holatlar' : st === 'REGISTRATION_OPEN' ? 'Qabul ochiq' : st === 'IN_PROGRESS' ? 'Davom etmoqda' : 'Yakunlangan'}
            </button>
          ))}

          <div className="w-px h-4 bg-slate-800 shrink-0 mx-1" />

          {['ALL', 'LEAGUE', 'PLAYOFF', 'LEAGUE_AND_PLAYOFF'].map((fmt) => (
            <button
              key={fmt}
              onClick={() => setFormatFilter(fmt)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors ${
                formatFilter === fmt
                  ? 'bg-sky-500 text-slate-950 shadow-sm'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {fmt === 'ALL' ? 'Barcha formatlar' : fmt === 'LEAGUE' ? 'Liga' : fmt === 'PLAYOFF' ? 'Pley-off' : 'Liga + Pley-off'}
            </button>
          ))}
        </div>
      </div>

      {/* 4. Tournament Grid */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400 space-y-2">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400" />
          <p className="text-xs">Turnirlar yuklanmoqda...</p>
        </div>
      ) : filteredTournaments.length === 0 ? (
        <div className="p-12 rounded-3xl bg-slate-900/50 border border-slate-800/80 text-center space-y-3">
          <Trophy className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-sm font-bold text-slate-300">Turnirlar topilmadi</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {activeTab === 'my'
              ? 'Siz hali hech qanday turnir yaratmagansiz yoki unga qo‘shilmagansiz.'
              : 'Qidiruv bo‘yicha mos turnirlar mavjud emas.'}
          </p>
          <button
            onClick={() => setShowWizardModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Yangi turnir yaratish</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredTournaments.map((t) => (
            <TournamentCard
              key={t.id}
              tournament={t}
              onClick={() => setSelectedTournamentId(t.id)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <TournamentWizardModal
        isOpen={showWizardModal}
        onClose={() => setShowWizardModal(false)}
        onTournamentCreated={(newId) => {
          setShowWizardModal(false);
          setSelectedTournamentId(newId);
          fetchTournaments();
          fetchTickets();
        }}
      />

      {isPrimaryOwner && (
        <AdminTicketManagementModal
          isOpen={showAdminTicketModal}
          onClose={() => {
            setShowAdminTicketModal(false);
            fetchTickets();
          }}
        />
      )}
    </div>
  );
};
