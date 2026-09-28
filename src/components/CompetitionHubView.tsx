import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
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

  const titles = {
    uz: {
      leagues: 'Milliy Ligalar',
      cups: 'Kuboklar',
      european: 'Yevrokuboklar',
      season: 'Mavsum',
      heading: 'Turnirlar Markazi',
      subtitle: 'Premier League, La Liga, Milliy Kuboklar va UEFA Chempionlar Ligasi',
    },
    ru: {
      leagues: 'Лиги',
      cups: 'Кубки',
      european: 'Еврокубки',
      season: 'Сезон',
      heading: 'Центр Турниров',
      subtitle: 'Premier League, La Liga, Национальные кубки и Лига Чемпионов УЕФА',
    },
    en: {
      leagues: 'Leagues',
      cups: 'Cups',
      european: 'European',
      season: 'Season',
      heading: 'Competition Hub',
      subtitle: 'Premier League, La Liga, Domestic Cups, and UEFA Champions League',
    },
  }[language] || {
    leagues: 'Leagues',
    cups: 'Cups',
    european: 'European',
    season: 'Season',
    heading: 'Competition Hub',
    subtitle: 'Premier League, La Liga, Domestic Cups, and UEFA Champions League',
  };

  const navItems = [
    { id: 'leagues' as const, label: titles.leagues, icon: Trophy },
    { id: 'cups' as const, label: titles.cups, icon: Award },
    { id: 'european' as const, label: titles.european, icon: Globe2 },
    { id: 'season' as const, label: titles.season, icon: CalendarDays },
  ];

  return (
    <div className="space-y-4 pb-24 animate-in fade-in duration-200">
      {/* Segmented Top Selector */}
      <div className="preview-surface p-1.5 rounded-2xl flex items-center gap-1 overflow-x-auto scrollbar-none border border-slate-200/80 dark:border-white/10 shadow-sm">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={`flex-1 min-w-[78px] flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm font-black'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* View Content */}
      <div className="min-w-0">
        {subTab === 'leagues' && <ClubsView onNavigateTab={onNavigateTab} />}
        {subTab === 'cups' && <CupBracketsView onNavigateTab={onNavigateTab} />}
        {subTab === 'european' && <ChampionsLeagueView onNavigateTab={onNavigateTab} />}
        {subTab === 'season' && <SeasonHubView onNavigateTab={onNavigateTab} />}
      </div>
    </div>
  );
};
