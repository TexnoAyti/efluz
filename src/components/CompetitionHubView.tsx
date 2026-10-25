import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { ClubsView } from './ClubsView';
import { CupBracketsView } from './CupBracketsView';
import { ChampionsLeagueView } from './ChampionsLeagueView';
import { SeasonHubView } from './SeasonHubView';
import { TeamsView } from './teams/TeamsView';
import { Trophy, Award, Globe2, CalendarDays, Shield, Sparkles } from 'lucide-react';

interface CompetitionHubViewProps {
  onNavigateTab: (tab: any) => void;
  initialSubTab?: 'leagues' | 'cups' | 'european' | 'season' | 'teams' | 'custom';
}

export const CompetitionHubView: React.FC<CompetitionHubViewProps> = ({
  onNavigateTab,
  initialSubTab = 'leagues',
}) => {
  const { language } = useI18n();
  const [subTab, setSubTab] = useState<'leagues' | 'cups' | 'european' | 'season' | 'teams' | 'custom'>(() => {
    try {
      const saved = sessionStorage.getItem('efl:competition-hub-subtab');
      if (saved === 'leagues' || saved === 'cups' || saved === 'european' || saved === 'season' || saved === 'teams' || saved === 'custom') {
        sessionStorage.removeItem('efl:competition-hub-subtab');
        return (saved === 'custom' ? 'teams' : saved) as any;
      }
    } catch {}
    return initialSubTab;
  });

  // Sync subTab if initialSubTab prop changes (e.g. from Home shortcuts)
  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const titles = {
    uz: {
      heading: 'Turnirlar',
      domestic: 'Milliy Ligalar',
      cups: 'Kuboklar',
      european: 'Yevrokuboklar',
      season: 'Mavsum',
      teams: 'TEAMS',
    },
    ru: {
      heading: 'Турниры',
      domestic: 'Лиги',
      cups: 'Кубки',
      european: 'Еврокубки',
      season: 'Сезон',
      teams: 'TEAMS',
    },
    en: {
      heading: 'Competitions',
      domestic: 'Domestic',
      cups: 'Cups',
      european: 'Europe',
      season: 'Season',
      teams: 'TEAMS',
    },
  }[language] || {
    heading: 'Competitions',
    domestic: 'Domestic',
    cups: 'Cups',
    european: 'Europe',
    season: 'Season',
    teams: 'TEAMS',
  };

  const navItems = [
    { id: 'leagues' as const, label: titles.domestic, icon: Trophy },
    { id: 'cups' as const, label: titles.cups, icon: Award },
    { id: 'european' as const, label: titles.european, icon: Globe2 },
    { id: 'season' as const, label: titles.season, icon: CalendarDays },
    { id: 'teams' as const, label: titles.teams, icon: Shield },
  ];

  return (
    <div className="space-y-4 pb-20 animate-in fade-in duration-200">
      {/* 1. Single Top Page Title */}
      <div className="flex items-center justify-between pt-1">
        <h1 className="text-xl sm:text-2xl font-black text-[var(--efl-text)] tracking-tight">
          {titles.heading}
        </h1>
      </div>

      {/* 2. Top-Level Category Segmented Bar */}
      <div className="p-1 rounded-2xl bg-[var(--efl-surface-2)] border border-[var(--efl-border)] flex items-center gap-1 overflow-x-auto scrollbar-none shadow-xs">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={`flex-1 min-w-[76px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                isActive
                  ? 'bg-[var(--efl-surface)] text-[var(--efl-primary)] shadow-sm font-black'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--efl-primary)]' : 'text-[var(--efl-muted)]'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* 3. Category Content */}
      <div className="min-w-0">
        {subTab === 'leagues' && <ClubsView onNavigateTab={onNavigateTab} />}
        {subTab === 'cups' && <CupBracketsView onNavigateTab={onNavigateTab} />}
        {subTab === 'european' && <ChampionsLeagueView onNavigateTab={onNavigateTab} />}
        {subTab === 'season' && <SeasonHubView onNavigateTab={onNavigateTab} />}
        {subTab === 'teams' && <TeamsView />}
        {subTab === 'custom' && (
          <div className="p-8 text-center rounded-3xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-200">Shaxsiy turnirlar bo‘limi hozircha yopiq</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Hozirda TEAMS (Jamoalar) ekotizimi faol. O‘z jamoangizni tuzib, do‘stlaringizni taklif qilishingiz mumkin.
            </p>
            <button
              type="button"
              onClick={() => setSubTab('teams')}
              className="py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors"
            >
              TEAMS bo‘limiga o‘tish
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

