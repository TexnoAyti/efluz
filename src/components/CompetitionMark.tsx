import React from 'react';
import { Trophy } from 'lucide-react';
import type { Competition } from '../types';

const leagueIcons: Record<string, string> = {
  'league-premier-league': 'premier-league', 'league-la-liga': 'la-liga',
  'league-serie-a': 'serie-a', 'league-bundesliga': 'bundesliga', 'league-ligue-1': 'ligue-1',
};
const tournamentIcons = ['fa-cup', 'copa-del-rey', 'coppa-italia', 'dfb-pokal', 'coupe-de-france', 'champions-league', 'europa-league', 'community-shield', 'supercopa-espana', 'supercoppa-italiana', 'dfl-supercup', 'trophee-des-champions'];

/** Transparent marks only; never wrap a crest in a colored tile. */
export function CompetitionMark({ competition, competitionId, className = 'h-5 w-5' }: { competition?: Pick<Competition, 'id' | 'type' | 'leagueId' | 'name'>; competitionId?: string; className?: string }) {
  const id = competition?.id || competitionId || '';
  const icon = (competition?.type === 'LEAGUE' && leagueIcons[competition.leagueId || '']) || Object.values(leagueIcons).find(name => id.startsWith(`comp-${name}-`));
  if (icon) return <img src={`/welcome/${icon}.svg`} alt="" aria-hidden="true" className={`object-contain shrink-0 ${icon === 'premier-league' || icon === 'ligue-1' ? 'club-mark-monochrome' : ''} ${className}`} />;
  const tournament = tournamentIcons.find(name => id.includes(name));
  if (tournament) return <img src={`/competition-marks/${tournament}.svg`} alt="" aria-hidden="true" className={`object-contain shrink-0 ${['champions-league', 'copa-del-rey', 'coupe-de-france'].includes(tournament) ? 'club-mark-monochrome' : ''} ${className}`} />;
  return <Trophy aria-hidden="true" strokeWidth={1.6} className={`shrink-0 text-[var(--efl-primary)] ${className}`} />;
}
