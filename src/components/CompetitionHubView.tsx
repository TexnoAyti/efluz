import React, { lazy, Suspense, useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { EFL_SECOND_SEASON } from '../lib/seasonPreparation';
import { ClubsView } from './ClubsView';
import { CupBracketsView } from './CupBracketsView';
import { ChampionsLeagueView } from './ChampionsLeagueView';
import { SeasonHubView } from './SeasonHubView';
const SeasonAwardsPanel=lazy(()=>import('./SeasonAwardsPanel').then(m=>({default:m.SeasonAwardsPanel})));
const UzeflifeView=lazy(()=>import('./uzeflife/UzeflifeView').then(m=>({default:m.UzeflifeView})));
import { TeamLeaguePreviewView } from './teamLeaguePreview/TeamLeaguePreviewView';
import { Trophy, Award, Globe2, Users, ChevronRight } from 'lucide-react';

interface CompetitionHubViewProps {
  onNavigateTab: (tab: any) => void;
  onOpenClub?: (club: import('../types').Club) => void;
  initialSubTab?: 'leagues' | 'cups' | 'european' | 'season' | 'custom' | 'uzeflife' | 'awards';
}

export const CompetitionHubView: React.FC<CompetitionHubViewProps> = ({
  onNavigateTab,
  onOpenClub,
  initialSubTab = 'leagues',
}) => {
  const { language } = useI18n();
  const { activeSeasonId, setActiveSeasonId, authStatus } = useAuth();
  const [subTab, setSubTab] = useState<'leagues' | 'cups' | 'european' | 'season' | 'custom' | 'uzeflife' | 'awards'>(() => {
    try {
      const saved = sessionStorage.getItem('efl:competition-hub-subtab');
      if (saved === 'leagues' || saved === 'cups' || saved === 'european' || saved === 'season' || saved === 'custom' || saved === 'uzeflife' || saved === 'awards') {
        sessionStorage.removeItem('efl:competition-hub-subtab');
        return saved as any;
      }
    } catch {}
    return initialSubTab;
  });

  // Make season-two club registration the default when players open the
  // league section. Choosing "1-mavsumga qaytish" in ClubsView remains
  // effective until they leave and re-enter the league section.
  useEffect(() => {
    if (authStatus === 'AUTH_LOADING') return;
    if (subTab === 'leagues') {
      // Only the league registration view defaults to second-season clubs.
      setActiveSeasonId(EFL_SECOND_SEASON.id);
    } else if (subTab === 'cups' || subTab === 'european') {
      // Cups and European competitions are ongoing season-one tournaments.
      // Avoid leaking the second-season club registration scope into their API calls.
      setActiveSeasonId('season-2026-27');
    }
  }, [subTab, authStatus, setActiveSeasonId]);

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
      custom: 'TEAMS',
    },
    ru: {
      heading: 'Турниры',
      domestic: 'Лиги',
      cups: 'Кубки',
      european: 'Еврокубки',
      season: 'Сезон',
      custom: 'TEAMS',
    },
    en: {
      heading: 'Competitions',
      domestic: 'Domestic',
      cups: 'Cups',
      european: 'Europe',
      season: 'Season',
      custom: 'TEAMS',
    },
  }[language] || {
    heading: 'Competitions',
    domestic: 'Domestic',
    cups: 'Cups',
    european: 'Europe',
    season: 'Season',
    custom: 'TEAMS',
  };

  const navItems = [
    { id: 'leagues' as const, label: titles.domestic, icon: Trophy },
    { id: 'cups' as const, label: titles.cups, icon: Award },
    { id: 'uzeflife' as const, label: 'UZEFLIFE', icon: Trophy },
    { id: 'european' as const, label: titles.european, icon: Globe2 },
    { id: 'custom' as const, label: titles.custom, icon: Users },
  ];

  return (
    <div data-munfiz-page={subTab} className="space-y-4 pb-20 animate-in fade-in duration-200">
      {/* 1. Single Top Page Title */}
      <div className="flex items-center justify-between pt-1">
        <h1 className="text-xl sm:text-2xl font-black text-[var(--efl-text)] tracking-tight">
          {titles.heading}
        </h1>
      </div>

      {/* 2. Top-Level Category Segmented Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 auto-rows-fr gap-2 rounded-2xl border border-[var(--efl-border)] bg-[var(--efl-surface-2)] p-2 shadow-xs">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = subTab === item.id;
          return (
            <button
              key={item.id}
              data-munfiz-control={`category-${item.id}`}
              type="button"
              onClick={() => setSubTab(item.id)}
              className={`${item.id==='custom' ? 'col-span-2 sm:col-span-2' : ''} min-w-0 min-h-[50px] flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 py-3 rounded-xl text-xs font-bold leading-snug text-center transition-all ${
                isActive
                  ? 'bg-[var(--efl-surface)] text-[var(--efl-primary)] shadow-sm font-black'
                  : 'text-[var(--efl-text-2)] hover:text-[var(--efl-text)]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[var(--efl-primary)]' : 'text-[var(--efl-muted)]'}`} />
              <span className="min-w-0 break-words">{item.label}</span>
            </button>
          );
        })}
      </div>

      <button type="button" onClick={()=>setSubTab('awards')} aria-pressed={subTab==='awards'} className={`group w-full min-h-[52px] flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all ${subTab==='awards'?'border-[var(--efl-primary)] bg-[var(--efl-primary)] text-white shadow-md':'border-[var(--efl-border)] bg-[var(--efl-surface)] text-[var(--efl-text)] shadow-sm hover:border-[var(--efl-primary)]'}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${subTab==='awards'?'bg-white/15':'bg-[var(--efl-primary-soft)] text-[var(--efl-primary)]'}`}><Award size={17}/></span><span className="min-w-0 flex-1"><b className="block text-xs font-black tracking-wide">MUKOFOTLAR</b><small className={`block truncate text-[10px] ${subTab==='awards'?'text-white/75':'text-[var(--efl-text-2)]'}`}>Oltin to‘p · Oltin butsa · Hafta o‘yinchisi</small></span><ChevronRight size={17} className="shrink-0 opacity-60"/></button>
      {/* 3. Category Content */}
      <div className="min-w-0">
        {subTab === 'awards'&&<Suspense fallback={<p role="status">Mukofotlar yuklanmoqda…</p>}><SeasonAwardsPanel/></Suspense>}
        {subTab === 'leagues' && <ClubsView key={activeSeasonId} onNavigateTab={onNavigateTab} />}
        {subTab === 'cups' && <CupBracketsView onNavigateTab={onNavigateTab} />}
        {subTab === 'european' && <ChampionsLeagueView onNavigateTab={onNavigateTab} />}
        {subTab === 'season' && <SeasonHubView onNavigateTab={onNavigateTab} />}
        {subTab === 'uzeflife'&&<Suspense fallback={<div className="p-8 text-center text-xs text-[var(--efl-text-2)]">UZEFLIFE yuklanmoqda…</div>}><UzeflifeView /></Suspense>}
        {subTab === 'custom' && <TeamLeaguePreviewView />}
      </div>
    </div>
  );
};

