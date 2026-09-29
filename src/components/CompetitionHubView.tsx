import React, { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { ClubsView } from './ClubsView';
import { CupBracketsView } from './CupBracketsView';
import { ChampionsLeagueView } from './ChampionsLeagueView';
import { SeasonHubView } from './SeasonHubView';
import { Trophy, Award, Globe2, CalendarDays } from 'lucide-react';

interface CompetitionHubViewProps {
  onNavigateTab: (tab: any) => void;
  initialSubTab?: 'leagues' | 'cups' | 'european' | 'season';
}

export const CompetitionHubView: React.FC<CompetitionHubViewProps> = ({
  onNavigateTab,
  initialSubTab = 'leagues',
}) => {
  const { language } = useI18n();
  const [subTab, setSubTab] = useState<'leagues' | 'cups' | 'european' | 'season'>(() => {
    try {
      const saved = sessionStorage.getItem('efl:competition-hub-subtab');
      if (saved === 'leagues' || saved === 'cups' || saved === 'european' || saved === 'season') {
        sessionStorage.removeItem('efl:competition-hub-subtab');
        return saved;
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
    },
    ru: {
      heading: 'Турниры',
      domestic: 'Лиги',
      cups: 'Кубки',
      european: 'Еврокубки',
      season: 'Сезон',
    },
    en: {
      heading: 'Competitions',
      domestic: 'Domestic',
      cups: 'Cups',
      european: 'Europe',
      season: 'Season',
    },
  }[language] || {
    heading: 'Competitions',
    domestic: 'Domestic',
    cups: 'Cups',
    european: 'Europe',
    season: 'Season',
  };

  const navItems = [
    { id: 'leagues' as const, label: titles.domestic, icon: Trophy },
    { id: 'cups' as const, label: titles.cups, icon: Award },
    { id: 'european' as const, label: titles.european, icon: Globe2 },
    { id: 'season' as const, label: titles.season, icon: CalendarDays },
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
      </div>
    </div>
  );
};
