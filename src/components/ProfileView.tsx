import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n, Language } from '../i18n';
import { ClubCrest } from './ClubCrest';
import { EflCareerCard } from './EflCareerCard';
import { PlayerSeasonProfile } from './PlayerSeasonProfile';
import {
  User,
  Shield,
  Languages,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';

interface ProfileViewProps {
  onNavigateTab: (tab: any) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, activeSeasonId, isDevMode, devProfiles, switchDevUser } = useAuth();
  const { language, setLanguage, t } = useI18n();
  const [showSandbox, setShowSandbox] = useState(false);

  const languagesList: { code: Language; label: string; flag: string }[] = [
    { code: 'uz', label: 'O‘zbekcha', flag: '🇺🇿' },
    { code: 'ru', label: 'Русский', flag: '🇷🇺' },
    { code: 'en', label: 'English', flag: '🇬🇧' },
  ];

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-20 max-w-4xl mx-auto">
      <div className="glass-panel p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 relative z-10 text-center sm:text-left">
          <div className="w-24 h-24 rounded-3xl bg-slate-950/80 p-2 border border-white/[0.08] flex items-center justify-center text-slate-300 font-bold text-2xl shadow-xl shrink-0 overflow-hidden">
            {user?.photoUrl ? <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" /> : <User className="w-12 h-12 text-slate-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {user?.isAdmin ? 'Tournament Administrator' : 'Verified eFootball Pro'}
              </span>
              <span className="text-xs text-slate-400">ID: {user?.id}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white">{user?.firstName} {user?.lastName || ''}</h1>
            <p className="text-sm font-semibold text-emerald-400 mt-0.5">@{user?.username}</p>

            {currentClub ? (
              <div onClick={() => onNavigateTab('my-club')} className="mt-4 inline-flex items-center gap-3 p-2.5 px-4 glass-card cursor-pointer transition-all shadow-md group">
                <ClubCrest clubId={currentClub.id} logoUrl={currentClub.logoUrl} name={currentClub.name} shortName={currentClub.shortName} size="sm" className="w-6 h-6" />
                <div className="text-left">
                  <div className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">{currentClub.name}</div>
                  <div className="text-[10px] text-slate-400 font-medium">{currentClub.leagueId ? currentClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase() : 'DOMESTIC LEAGUE'}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 ml-2" />
              </div>
            ) : (
              <button onClick={() => onNavigateTab('leagues')} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-400 text-xs font-bold transition-all">
                <Shield className="w-4 h-4" /><span>{t.selectYourClub}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {user?.id && <PlayerSeasonProfile userId={user.id} seasonId={activeSeasonId} />}

      {user?.isAdmin && (
        <div id="card-admin-access" onClick={() => onNavigateTab('admin')} className="glass-panel p-5 sm:p-6 shadow-xl border-amber-500/30 bg-gradient-to-r from-amber-950/20 via-slate-900/40 to-slate-900/80 cursor-pointer hover:border-amber-500/50 transition-all group">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 shadow-lg group-hover:scale-105 transition-transform"><SlidersHorizontal className="w-5 h-5" /></div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-white group-hover:text-amber-300 transition-colors">Tournament Admin Panel</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30">Control Center</span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">Manage fixtures, arbitrate disputes, monitor 96 clubs, and verify tournament status.</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs shrink-0"><span className="hidden sm:inline">Open Control Center</span><ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></div>
          </div>
        </div>
      )}

      {user?.isAdmin && <EflCareerCard userId={user.id} adminPreview />}

      <div className="glass-panel p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-2 text-white font-bold text-sm"><Languages className="w-5 h-5 text-emerald-400" /><span>{t.changeLanguage}</span></div>
        <div className="grid grid-cols-3 gap-3">
          {languagesList.map((item) => {
            const isSelected = language === item.code;
            return (
              <button key={item.code} onClick={() => setLanguage(item.code)} className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition-all ${isSelected ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300 font-black shadow-lg shadow-emerald-500/10' : 'glass-card text-slate-300 hover:border-white/[0.15]'}`}>
                <span className="text-2xl mb-1">{item.flag}</span><span className="text-xs">{item.label}</span>{isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-1" />}
              </button>
            );
          })}
        </div>
      </div>

      {isDevMode && (
        <div className="glass-panel p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-bold text-sm"><Sparkles className="w-5 h-5 text-amber-400" /><span>{t.sandboxSwitcher}</span></div>
            <button onClick={() => setShowSandbox(!showSandbox)} className="text-xs text-amber-400 hover:text-amber-300 font-bold">{showSandbox ? 'Hide Accounts' : 'Show Accounts'}</button>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">Switch between simulated Telegram player accounts to test two-sided match submissions, consensus verification, opponent score disputes, and admin arbitration.</p>
          {showSandbox && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {devProfiles.map((prof) => {
                const isSelected = user?.id === prof.id || user?.username === prof.username;
                return (
                  <button key={prof.id} onClick={() => switchDevUser(prof.id)} className={`flex items-center justify-between p-3.5 rounded-2xl border text-left text-xs transition-all ${isSelected ? 'bg-emerald-500/15 border-emerald-500/60 text-emerald-300 font-black shadow-md' : 'glass-card text-slate-300 hover:border-white/[0.15]'}`}>
                    <div className="flex items-center gap-3"><div className={`w-3 h-3 rounded-full ${isSelected ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-slate-600'}`} /><div><div className="font-bold text-white">@{prof.username}</div><div className="text-[10px] text-slate-400">{prof.firstName} {prof.isAdmin ? '• (Admin)' : ''}</div></div></div>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};