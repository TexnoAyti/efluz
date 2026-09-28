import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Shield, Trophy, User, Swords, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Club, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (tab: any) => void;
  onSelectFixture?: (fixture: Fixture) => void;
}

const KNOWN_COMPETITIONS = [
  { id: 'premier-league', name: 'Premier League', type: 'league', country: 'England' },
  { id: 'la-liga', name: 'La Liga', type: 'league', country: 'Spain' },
  { id: 'serie-a', name: 'Serie A', type: 'league', country: 'Italy' },
  { id: 'bundesliga', name: 'Bundesliga', type: 'league', country: 'Germany' },
  { id: 'ligue-1', name: 'Ligue 1', type: 'league', country: 'France' },
  { id: 'fa-cup', name: 'FA Cup', type: 'cup', country: 'England' },
  { id: 'copa-del-rey', name: 'Copa del Rey', type: 'cup', country: 'Spain' },
  { id: 'coppa-italia', name: 'Coppa Italia', type: 'cup', country: 'Italy' },
  { id: 'dfb-pokal', name: 'DFB-Pokal', type: 'cup', country: 'Germany' },
  { id: 'coupe-de-france', name: 'Coupe de France', type: 'cup', country: 'France' },
  { id: 'ucl', name: 'UEFA Champions League', type: 'european', country: 'Europe' },
  { id: 'uel', name: 'UEFA Europa League', type: 'european', country: 'Europe' },
];

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
  onSelectFixture,
}) => {
  const { activeSeasonId, devProfiles } = useAuth();
  const { language } = useI18n();
  const [query, setQuery] = useState('');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      return;
    }
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 80);

    let isMounted = true;
    setIsLoading(true);

    const loadSearchData = async () => {
      try {
        const [leaguesRes, matchesRes] = await Promise.all([
          api.getLeagues().catch(() => ({ leagues: [] })),
          api.getMyMatches(activeSeasonId).catch(() => ({ fixtures: [] })),
        ]);

        if (!isMounted) return;
        setFixtures(matchesRes.fixtures || []);

        const leagues = leaguesRes.leagues || [];
        const clubsResults = await Promise.all(
          leagues.map((l) => api.getLeagueClubs(l.id, activeSeasonId).catch(() => ({ clubs: [] })))
        );

        if (!isMounted) return;
        const allClubs = clubsResults.flatMap((r) => r.clubs || []);
        setClubs(allClubs);
      } catch {
        // Safe fallback
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void loadSearchData();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      isMounted = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, activeSeasonId]);

  const trimmed = query.trim().toLowerCase();

  const filteredClubs = useMemo(() => {
    if (!trimmed) return [];
    return clubs
      .filter(
        (c) =>
          c.name.toLowerCase().includes(trimmed) ||
          (c.shortName && c.shortName.toLowerCase().includes(trimmed))
      )
      .slice(0, 5);
  }, [clubs, trimmed]);

  const filteredCompetitions = useMemo(() => {
    if (!trimmed) return [];
    return KNOWN_COMPETITIONS.filter(
      (comp) =>
        comp.name.toLowerCase().includes(trimmed) ||
        comp.country.toLowerCase().includes(trimmed)
    ).slice(0, 4);
  }, [trimmed]);

  const filteredPlayers = useMemo(() => {
    if (!trimmed) return [];
    const profiles = devProfiles || [];
    return profiles
      .filter(
        (p) =>
          p.username.toLowerCase().includes(trimmed) ||
          p.firstName.toLowerCase().includes(trimmed)
      )
      .slice(0, 4);
  }, [devProfiles, trimmed]);

  const filteredMatches = useMemo(() => {
    if (!trimmed) return [];
    return fixtures
      .filter((f) => {
        const home = (f.homeClub?.name || f.homeClubId || '').toLowerCase();
        const away = (f.awayClub?.name || f.awayClubId || '').toLowerCase();
        const comp = (f.competitionName || '').toLowerCase();
        return (
          home.includes(trimmed) ||
          away.includes(trimmed) ||
          comp.includes(trimmed)
        );
      })
      .slice(0, 4);
  }, [fixtures, trimmed]);

  const hasResults =
    filteredClubs.length > 0 ||
    filteredCompetitions.length > 0 ||
    filteredPlayers.length > 0 ||
    filteredMatches.length > 0;

  if (!isOpen) return null;

  const handleSelectCompetition = (comp: (typeof KNOWN_COMPETITIONS)[0]) => {
    if (comp.type === 'cup') {
      try {
        sessionStorage.setItem('efl:active-cup-id', comp.id);
        sessionStorage.setItem('efl:competition-hub-subtab', 'cups');
      } catch {}
      onNavigateTab('cups');
    } else if (comp.type === 'european') {
      try {
        sessionStorage.setItem('efl:competition-hub-subtab', 'european');
      } catch {}
      onNavigateTab('champions-league');
    } else {
      try {
        sessionStorage.setItem('efl:preview-league', `league-${comp.id}`);
        sessionStorage.setItem('efl:competition-hub-subtab', 'leagues');
      } catch {}
      onNavigateTab('leagues');
    }
    onClose();
  };

  const handleSelectClub = (club: Club) => {
    try {
      sessionStorage.setItem('efl:preview-league', club.leagueId || 'league-premier-league');
      sessionStorage.setItem('efl:preview-selected-club', club.id);
      sessionStorage.setItem('efl:competition-hub-subtab', 'leagues');
    } catch {}
    onNavigateTab('leagues');
    onClose();
  };

  const handleSelectMatch = (fixture: Fixture) => {
    if (onSelectFixture) {
      onSelectFixture(fixture);
    }
    onNavigateTab('my-club');
    onClose();
  };

  const handleSelectPlayer = () => {
    onNavigateTab('my-club');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Global Search"
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/85 backdrop-blur-2xl animate-in fade-in duration-200"
    >
      <div className="w-full max-w-2xl mx-auto px-4 pt-4 pb-3 sm:pt-6 flex flex-col h-full">
        {/* Search Input Bar */}
        <div className="relative flex items-center gap-3">
          <div className="relative flex-1 flex items-center">
            <Search className="absolute left-4 w-5 h-5 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                language === 'uz'
                  ? 'Klub, turnir, o‘yinchi yoki o‘yin qidirish...'
                  : language === 'ru'
                  ? 'Поиск клубов, турниров, игроков или матчей...'
                  : 'Search clubs, competitions, players or matches...'
              }
              className="w-full pl-11 pr-10 py-3.5 rounded-2xl bg-white/10 border border-white/15 text-white placeholder-slate-400 text-sm font-semibold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-3 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-2xl text-xs font-bold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
          >
            {language === 'uz' ? 'Yopish' : language === 'ru' ? 'Закрыть' : 'Close'}
          </button>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto mt-4 space-y-6 pb-20 pr-1 scrollbar-none">
          {!trimmed && (
            <div className="text-center py-12 px-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-3">
                <Search className="w-7 h-7" />
              </div>
              <h3 className="text-sm font-bold text-white">
                {language === 'uz'
                  ? 'EFL UZ Bo‘ylab Qidiruv'
                  : language === 'ru'
                  ? 'Поиск по EFL UZ'
                  : 'Search across EFL UZ'}
              </h3>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                {language === 'uz'
                  ? 'Premier League, La Liga, UCL, milliy kuboklar, klublar va o‘yinchilarni toping.'
                  : language === 'ru'
                  ? 'Находите клубы, национальные кубки, европейские лиги и игроков.'
                  : 'Find clubs, competitions, players, or active match fixtures.'}
              </p>

              {/* Quick Suggestions */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 max-w-md mx-auto">
                {KNOWN_COMPETITIONS.slice(0, 5).map((comp) => (
                  <button
                    key={comp.id}
                    type="button"
                    onClick={() => handleSelectCompetition(comp)}
                    className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                  >
                    {comp.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {trimmed && !hasResults && !isLoading && (
            <div className="text-center py-12">
              <p className="text-sm font-bold text-slate-300">
                {language === 'uz' ? 'Hech narsa topilmadi' : language === 'ru' ? 'Ничего не найдено' : 'No results found'}
              </p>
              <p className="text-xs text-slate-400 mt-1">"{query}"</p>
            </div>
          )}

          {/* Group 1: Clubs */}
          {filteredClubs.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                <span>{language === 'uz' ? 'Klublar' : language === 'ru' ? 'Клубы' : 'Clubs'}</span>
              </div>
              <div className="bg-white/5 rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                {filteredClubs.map((club) => (
                  <button
                    key={club.id}
                    type="button"
                    onClick={() => handleSelectClub(club)}
                    className="w-full flex items-center justify-between p-3 px-4 hover:bg-white/10 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center shrink-0">
                        <ClubCrest
                          clubId={club.id}
                          logoUrl={club.logoUrl}
                          name={club.name}
                          shortName={club.shortName}
                          size="sm"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{club.name}</div>
                        <div className="text-[10px] text-slate-400 capitalize">
                          {club.leagueId?.replace('league-', '').replace('-', ' ') || 'Domestic League'}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Group 2: Competitions */}
          {filteredCompetitions.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                <span>{language === 'uz' ? 'Turnirlar' : language === 'ru' ? 'Турниры' : 'Competitions'}</span>
              </div>
              <div className="bg-white/5 rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                {filteredCompetitions.map((comp) => (
                  <button
                    key={comp.id}
                    type="button"
                    onClick={() => handleSelectCompetition(comp)}
                    className="w-full flex items-center justify-between p-3 px-4 hover:bg-white/10 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                        <Trophy className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">{comp.name}</div>
                        <div className="text-[10px] text-slate-400">{comp.country}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-black uppercase text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">
                      {comp.type}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Group 3: Matches */}
          {filteredMatches.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                <Swords className="w-3.5 h-3.5 text-rose-400" />
                <span>{language === 'uz' ? 'O‘yinlar' : language === 'ru' ? 'Матчи' : 'Matches'}</span>
              </div>
              <div className="bg-white/5 rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                {filteredMatches.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleSelectMatch(f)}
                    className="w-full flex items-center justify-between p-3 px-4 hover:bg-white/10 transition-colors text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">
                        {f.homeClub?.shortName || f.homeClub?.name || 'Home'} vs{' '}
                        {f.awayClub?.shortName || f.awayClub?.name || 'Away'}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {f.competitionName || 'EFL UZ'} · Round {f.matchday}
                      </div>
                    </div>
                    {f.status === 'CONFIRMED' ? (
                      <span className="font-mono text-xs font-black text-white px-2 py-1 bg-white/10 rounded-lg">
                        {f.homeScore} : {f.awayScore}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400 bg-white/5 px-2 py-1 rounded-lg">
                        {f.status}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Group 4: Players */}
          {filteredPlayers.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 px-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                <span>{language === 'uz' ? 'O‘yinchilar' : language === 'ru' ? 'Игроки' : 'Players'}</span>
              </div>
              <div className="bg-white/5 rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
                {filteredPlayers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={handleSelectPlayer}
                    className="w-full flex items-center justify-between p-3 px-4 hover:bg-white/10 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-xs shrink-0">
                        {p.firstName?.charAt(0) || '@'}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">@{p.username}</div>
                        <div className="text-[10px] text-slate-400">{p.firstName}</div>
                      </div>
                    </div>
                    {p.isAdmin && (
                      <span className="text-[9px] font-black uppercase text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        Admin
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
