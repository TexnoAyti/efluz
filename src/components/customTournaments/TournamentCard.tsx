import React from 'react';
import { CustomTournament } from '../../types/customTournament';
import { Trophy, Users, Lock, Globe, Shield, ArrowRight } from 'lucide-react';

interface TournamentCardProps {
  tournament: CustomTournament;
  onClick: () => void;
}

export const TournamentCard: React.FC<TournamentCardProps> = ({ tournament, onClick }) => {
  const getStatusBadge = () => {
    switch (tournament.status) {
      case 'DRAFT':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 font-medium">Qoralama</span>;
      case 'REGISTRATION_OPEN':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-medium border border-emerald-500/30 animate-pulse">Qabul ochiq</span>;
      case 'IN_PROGRESS':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 font-medium border border-blue-500/30">Davom etmoqda</span>;
      case 'COMPLETED':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/20 text-purple-400 font-medium">Yakunlangan</span>;
      case 'CANCELLED':
        return <span className="text-xs px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 font-medium">Bekor qilingan</span>;
    }
  };

  const getFormatLabel = () => {
    switch (tournament.format) {
      case 'LEAGUE':
        return 'Liga chempionati';
      case 'PLAYOFF':
        return 'Pley-off (Kubok)';
      case 'LEAGUE_AND_PLAYOFF':
        return 'Liga + Pley-off';
    }
  };

  const getVisibilityIcon = () => {
    if (tournament.visibility === 'PRIVATE') {
      return (
        <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
          <Lock className="w-3 h-3" /> Yopiq
        </span>
      );
    }
    if (tournament.visibility === 'PUBLIC_MODERATED') {
      return (
        <span className="flex items-center gap-1 text-xs text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full border border-sky-500/20">
          <Shield className="w-3 h-3" /> Tasdiqli
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
        <Globe className="w-3 h-3" /> Ochiq
      </span>
    );
  };

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      className="group relative bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4 transition-all duration-200 active:scale-[0.99] cursor-pointer shadow-lg backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Trophy className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-100 text-base leading-snug group-hover:text-emerald-300 transition-colors">
              {tournament.name}
            </h3>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>{getFormatLabel()}</span>
              <span>·</span>
              <span>Tashkilotchi: @{tournament.organizerUsername || 'efl_user'}</span>
            </p>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      {tournament.description && (
        <p className="text-xs text-slate-300/90 line-clamp-2 mb-3 bg-slate-950/40 p-2 rounded-xl border border-slate-800/50">
          {tournament.description}
        </p>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-slate-300">
            <Users className="w-3.5 h-3.5 text-slate-400" />
            <strong className="text-slate-100">{tournament.currentParticipantsCount}</strong> / {tournament.maxParticipants} qatnashchi
          </span>
          {getVisibilityIcon()}
        </div>

        <div className="flex items-center gap-1 text-emerald-400 font-semibold group-hover:translate-x-0.5 transition-transform">
          <span>Ochish</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  );
};
