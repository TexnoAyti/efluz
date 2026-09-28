import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n, Language } from '../i18n';
import { api } from '../lib/api';
import { Fixture, Club } from '../types';
import { ClubCrest } from './ClubCrest';
import { PremiumClubBadge } from './PremiumClubBadge';
import { MyMatchesView } from './MyMatchesView';
import { PlayerSeasonProfile } from './PlayerSeasonProfile';
import { EflCareerCard } from './EflCareerCard';
import {
  Shield,
  Trophy,
  Swords,
  User,
  Settings,
  Sun,
  Moon,
  Languages,
  CheckCircle2,
  SlidersHorizontal,
  ChevronRight,
  ExternalLink,
  MapPin,
  Sparkles,
} from 'lucide-react';

interface ClubHubViewProps {
  onNavigateTab: (tab: any) => void;
  onSelectFixtureForMatchCenter?: (fixture: Fixture) => void;
  initialSelectedFixture?: Fixture | null;
  theme?: 'light' | 'dark';
  onThemeChange?: (theme: 'light' | 'dark') => void;
}

export const ClubHubView: React.FC<ClubHubViewProps> = ({
  onNavigateTab,
  onSelectFixtureForMatchCenter,
  initialSelectedFixture,
  theme = 'dark',
  onThemeChange,
}) => {
  const {
    user,
    currentClub,
    ownedClubs,
    selectCurrentClub,
    userStats,
    activeSeasonId,
    isDevMode,
    devProfiles,
    switchDevUser,
  } = useAuth();
  const { language, setLanguage, t } = useI18n();

  const [activeSection, setActiveSection] = useState<'matches' | 'overview' | 'settings'>('matches');
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    api.getMyMatches(activeSeasonId)
      .then((res) => {
        if (isMounted) setFixtures(res.fixtures || []);
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [activeSeasonId, currentClub?.id]);

  const activeClub = currentClub || ownedClubs[0] || null;

  const languagesList: { code: Language; label: string; flag: string }[] = [
    { code: 'uz', label: 'O‘zbekcha', flag: '🇺🇿' },
    { code: 'ru', label: 'Русский', flag: '🇷🇺' },
    { code: 'en', label: 'English', flag: '🇬🇧' },
  ];

  const goalDiff = (userStats?.goalsScored ?? 0) - (userStats?.goalsConceded ?? 0);

  return (
    <div className="space-y-5 pb-24 animate-in fade-in duration-200">
      {/* Active Club Header & Switcher */}
      <div className="preview-surface p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm relative overflow-hidden">
        {/* Subtle background ambient highlight */}
        <div className="absolute top-0 right-0 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start justify-between gap-5 text-center md:text-left">
          {/* Main Active Club Display */}
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-slate-100 dark:bg-slate-900 border-2 border-blue-500 p-2.5 flex items-center justify-center shadow-lg shrink-0">
                <ClubCrest
                  clubId={activeClub?.id}
                  logoUrl={activeClub?.logoUrl}
                  name={activeClub?.name}
                  shortName={activeClub?.shortName}
                  size="xl"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="absolute -bottom-1 -right-1 bg-blue-600 text-white p-1 rounded-full shadow-md" title="Active Club">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
            </div>

            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 mb-1">
                <Sparkles className="w-3 h-3" />
                <span>
                  {activeClub?.leagueId
                    ? activeClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase()
                    : 'DOMESTIC LEAGUE'}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight truncate max-w-sm">
                {activeClub?.name || 'No Club Selected'}
              </h1>
              <div className="flex items-center justify-center md:justify-start gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-blue-500" />
                  {activeClub?.stadium || 'Official Stadium'}
                </span>
                <span>•</span>
                <span>Season 2026/27</span>
              </div>
            </div>
          </div>

          {/* Club Switcher (When user owns multiple clubs) */}
          {ownedClubs.length > 1 && (
            <div className="flex flex-col items-center sm:items-end gap-1.5 bg-slate-100 dark:bg-white/5 p-3 rounded-2xl border border-slate-200 dark:border-white/10">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {language === 'uz' ? 'Klubni almashtirish' : language === 'ru' ? 'Сменить клуб' : 'Switch Club'}
              </span>
              <div className="flex items-center gap-2">
                {ownedClubs.map((club) => {
                  const isCurrent = activeClub?.id === club.id;
                  return (
                    <button
                      key={club.id}
                      type="button"
                      onClick={() => selectCurrentClub(club.id)}
                      title={`Switch active context to ${club.name}`}
                      aria-label={`Switch to ${club.name}`}
                      className={`relative w-12 h-12 rounded-xl p-1.5 flex items-center justify-center transition-all ${
                        isCurrent
                          ? 'ring-2 ring-blue-600 bg-white dark:bg-slate-900 shadow-md scale-105'
                          : 'bg-white/80 dark:bg-slate-800/80 hover:bg-white dark:hover:bg-slate-700 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <ClubCrest
                        clubId={club.id}
                        logoUrl={club.logoUrl}
                        name={club.name}
                        shortName={club.shortName}
                        size="sm"
                        className="w-full h-full object-contain"
                      />
                      {isCurrent && (
                        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-2 ring-white dark:ring-slate-900" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Club Quick Stats Bar */}
        {activeClub && (
          <div className="mt-5 pt-4 border-t border-slate-200/80 dark:border-white/10 grid grid-cols-4 sm:grid-cols-6 gap-2 text-center">
            <div className="p-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/50 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                {language === 'uz' ? 'O‘rin' : language === 'ru' ? 'Место' : 'Pos'}
              </span>
              <strong className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                {userStats?.leaguePosition ? `#${userStats.leaguePosition}` : '—'}
              </strong>
            </div>
            <div className="p-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/50 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                {language === 'uz' ? 'Ochko' : language === 'ru' ? 'Очки' : 'PTS'}
              </span>
              <strong className="text-sm font-black text-blue-600 dark:text-blue-400 tabular-nums">
                {userStats?.points ?? '0'}
              </strong>
            </div>
            <div className="p-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/50 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                {language === 'uz' ? 'O‘yin' : language === 'ru' ? 'Матчи' : 'PL'}
              </span>
              <strong className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                {userStats?.matchesPlayed ?? '0'}
              </strong>
            </div>
            <div className="p-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/50 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                {language === 'uz' ? 'G‘–D–M' : language === 'ru' ? 'В–Н–П' : 'W–D–L'}
              </span>
              <strong className="text-xs font-black text-slate-900 dark:text-white tabular-nums">
                {userStats ? `${userStats.wins}–${userStats.draws}–${userStats.losses}` : '0–0–0'}
              </strong>
            </div>
            <div className="hidden sm:block p-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/50 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                {language === 'uz' ? 'Gollar' : language === 'ru' ? 'Голы' : 'GF:GA'}
              </span>
              <strong className="text-xs font-black text-slate-900 dark:text-white tabular-nums">
                {userStats?.goalsScored ?? 0}:{userStats?.goalsConceded ?? 0}
              </strong>
            </div>
            <div className="hidden sm:block p-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/50 dark:border-white/5">
              <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                {language === 'uz' ? 'Farq' : language === 'ru' ? 'Разница' : 'GD'}
              </span>
              <strong className={`text-xs font-black tabular-nums ${goalDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : goalDiff < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}>
                {goalDiff > 0 ? `+${goalDiff}` : goalDiff}
              </strong>
            </div>
          </div>
        )}
      </div>

      {/* Internal Navigation Tabs (Matches vs Overview vs Settings) */}
      <div className="preview-surface p-1 rounded-2xl flex items-center gap-1 border border-slate-200/80 dark:border-white/10 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveSection('matches')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
            activeSection === 'matches'
              ? 'bg-blue-600 text-white font-black shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Swords className="w-3.5 h-3.5" />
          <span>{language === 'uz' ? 'O‘yinlar' : language === 'ru' ? 'Матчи' : 'Matches'}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('overview')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
            activeSection === 'overview'
              ? 'bg-blue-600 text-white font-black shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          <span>{language === 'uz' ? 'Karyera & Statistika' : language === 'ru' ? 'Карьера' : 'Career & Stats'}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('settings')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
            activeSection === 'settings'
              ? 'bg-blue-600 text-white font-black shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          <span>{language === 'uz' ? 'Sozlamalar' : language === 'ru' ? 'Настройки' : 'Settings'}</span>
        </button>
      </div>

      {/* Section Content */}
      {activeSection === 'matches' && (
        <div className="space-y-4">
          <MyMatchesView
            initialSelectedFixture={initialSelectedFixture}
            onNavigateTab={onNavigateTab}
          />
        </div>
      )}

      {activeSection === 'overview' && (
        <div className="space-y-4">
          {user?.id && <PlayerSeasonProfile userId={user.id} seasonId={activeSeasonId} />}
          {user?.id && <EflCareerCard userId={user.id} adminPreview />}
        </div>
      )}

      {activeSection === 'settings' && (
        <div className="space-y-4">
          {/* Telegram User Card */}
          <div className="preview-surface p-5 sm:p-6 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-500 overflow-hidden shrink-0">
                {user?.photoUrl ? (
                  <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-7 h-7" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-900 dark:text-white truncate">
                    {user?.firstName} {user?.lastName || ''}
                  </h3>
                  {user?.isAdmin && (
                    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Admin
                    </span>
                  )}
                </div>
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">@{user?.username}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Telegram ID: {user?.telegramId || user?.id}</p>
              </div>
            </div>
          </div>

          {/* Appearance Toggle (Light / Dark) */}
          <div className="preview-surface p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  {language === 'uz' ? 'Mavzu (Ko‘rinish)' : language === 'ru' ? 'Тема оформления' : 'Appearance'}
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  EFL UZ Premium Broadcast Design (Light / Dark)
                </p>
              </div>
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => onThemeChange?.('light')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    theme === 'light'
                      ? 'bg-white text-slate-900 shadow-sm font-black'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  <span>Light</span>
                </button>
                <button
                  type="button"
                  onClick={() => onThemeChange?.('dark')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    theme === 'dark'
                      ? 'bg-blue-600 text-white shadow-sm font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Dark</span>
                </button>
              </div>
            </div>
          </div>

          {/* Language Selector */}
          <div className="preview-surface p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
              <Languages className="w-4 h-4 text-blue-500" />
              <span>{t.changeLanguage}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {languagesList.map((item) => {
                const isSelected = language === item.code;
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => setLanguage(item.code)}
                    className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all ${
                      isSelected
                        ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-400 font-black shadow-sm'
                        : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-xl mb-1">{item.flag}</span>
                    <span className="text-xs">{item.label}</span>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-blue-500 mt-1" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Admin Control Center Link (Only for admins) */}
          {user?.isAdmin && (
            <button
              type="button"
              onClick={() => onNavigateTab('admin')}
              className="w-full text-left preview-surface p-5 rounded-3xl border border-amber-500/30 bg-gradient-to-r from-amber-500/5 via-transparent to-transparent shadow-sm hover:border-amber-500/60 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 shrink-0">
                    <SlidersHorizontal className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-900 dark:text-white">Tournament Admin Panel</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/20 text-amber-500">
                        Admin
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Fixtures, disputes, match operations, and club management.
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-amber-500 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          )}

          {/* Dev Sandbox Switcher if available */}
          {isDevMode && devProfiles.length > 0 && (
            <div className="preview-surface p-5 rounded-3xl border border-slate-200/80 dark:border-white/10 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span>{t.sandboxSwitcher}</span>
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Switch profiles to test matches and consensus.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {devProfiles.map((prof) => {
                  const isSelected = user?.id === prof.id || user?.username === prof.username;
                  return (
                    <button
                      key={prof.id}
                      type="button"
                      onClick={() => switchDevUser(prof.id)}
                      className={`flex items-center justify-between p-2.5 rounded-xl border text-left text-xs transition-all ${
                        isSelected
                          ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-400 font-black'
                          : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isSelected ? 'bg-blue-500' : 'bg-slate-400'}`} />
                        <div className="truncate">
                          <div className="font-bold truncate">@{prof.username}</div>
                          <div className="text-[10px] text-slate-400">{prof.firstName} {prof.isAdmin ? '• Admin' : ''}</div>
                        </div>
                      </div>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
