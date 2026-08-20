import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n, Language } from '../i18n';
import {
  User,
  Shield,
  Trophy,
  Languages,
  CheckCircle2,
  Sparkles,
  ExternalLink,
  ChevronRight,
  LogOut,
  Flame,
  Award,
  Globe2,
} from 'lucide-react';

interface ProfileViewProps {
  onNavigateTab: (tab: any) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, isDevMode, devProfiles, switchDevUser } = useAuth();
  const { language, setLanguage, t } = useI18n();

  const [showSandbox, setShowSandbox] = useState(false);

  const languagesList: { code: Language; label: string; flag: string }[] = [
    { code: 'uz', label: 'O‘zbekcha', flag: '🇺🇿' },
    { code: 'ru', label: 'Русский', flag: '🇷🇺' },
    { code: 'en', label: 'English', flag: '🇬🇧' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20 max-w-4xl mx-auto">
      {/* Profile Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 relative z-10 text-center sm:text-left">
          <div className="w-24 h-24 rounded-3xl bg-slate-950 p-2 border-2 border-slate-700/80 flex items-center justify-center text-slate-300 font-bold text-2xl shadow-xl shrink-0 overflow-hidden">
            {user?.photoUrl ? (
              <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
            ) : (
              <User className="w-12 h-12 text-slate-500" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {user?.isAdmin ? 'Tournament Administrator' : 'Verified eFootball Pro'}
              </span>
              <span className="text-xs text-slate-400">ID: {user?.id}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-white">
              {user?.firstName} {user?.lastName || ''}
            </h1>
            <p className="text-sm font-semibold text-emerald-400 mt-0.5">@{user?.username}</p>

            {/* Claimed Club Highlight */}
            {currentClub ? (
              <div
                onClick={() => onNavigateTab('my-club')}
                className="mt-4 inline-flex items-center gap-3 p-2.5 px-4 bg-slate-950/80 hover:bg-slate-950 border border-slate-800 rounded-2xl cursor-pointer transition-all shadow-md group"
              >
                <img
                  src={currentClub.logoUrl}
                  alt={currentClub.name}
                  className="w-6 h-6 object-contain"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div className="text-left">
                  <div className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">
                    {currentClub.name}
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium">
                    {currentClub.leagueId ? currentClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase() : 'DOMESTIC LEAGUE'}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 ml-2" />
              </div>
            ) : (
              <button
                onClick={() => onNavigateTab('leagues')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-400 text-xs font-bold transition-all"
              >
                <Shield className="w-4 h-4" />
                <span>{t.selectYourClub}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Language Selector Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Languages className="w-5 h-5 text-emerald-400" />
          <span>{t.changeLanguage}</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {languagesList.map((item) => {
            const isSelected = language === item.code;
            return (
              <button
                key={item.code}
                onClick={() => setLanguage(item.code)}
                className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition-all ${
                  isSelected
                    ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 font-black shadow-lg shadow-emerald-500/10'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                <span className="text-2xl mb-1">{item.flag}</span>
                <span className="text-xs">{item.label}</span>
                {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-1" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sandbox Test Account Switcher (For Multiplayer & Dispute Simulation) */}
      {isDevMode && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>{t.sandboxSwitcher}</span>
            </div>
            <button
              onClick={() => setShowSandbox(!showSandbox)}
              className="text-xs text-amber-400 hover:text-amber-300 font-bold"
            >
              {showSandbox ? 'Hide Accounts' : 'Show Accounts'}
            </button>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Switch between simulated Telegram player accounts to test two-sided match submissions, consensus verification, opponent score disputes, and admin arbitration.
          </p>

          {showSandbox && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {devProfiles.map((prof) => {
                const isSelected = user?.id === prof.id || user?.username === prof.username;
                return (
                  <button
                    key={prof.id}
                    onClick={() => switchDevUser(prof.id)}
                    className={`flex items-center justify-between p-3.5 rounded-2xl border text-left text-xs transition-all ${
                      isSelected
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 font-black shadow-md'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800/80'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          isSelected ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-slate-600'
                        }`}
                      />
                      <div>
                        <div className="font-bold text-white">@{prof.username}</div>
                        <div className="text-[10px] text-slate-400">
                          {prof.firstName} {prof.isAdmin ? '• (Admin)' : ''}
                        </div>
                      </div>
                    </div>
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
