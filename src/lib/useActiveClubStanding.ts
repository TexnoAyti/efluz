import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Club, StandingsRow } from '../types';

export async function loadActiveClubStanding(clubId: string, leagueId: string, seasonId: string, client: Pick<typeof api, 'getCompetitions' | 'getCompetitionStandings'> = api): Promise<StandingsRow | null> {
  const { competitions } = await client.getCompetitions(seasonId);
  const competition = competitions.find((entry) => entry.type === 'LEAGUE' && entry.leagueId === leagueId);
  if (!competition) return null;
  const { standings } = await client.getCompetitionStandings(competition.id);
  return standings.find((row) => row.clubId === clubId) || null;
}

// A response belongs to one club and season; late responses cannot replace a newer selection.
export function useActiveClubStanding(club: Club | null, seasonId: string) {
  const clubId = club?.id;
  const leagueId = club?.leagueId;
  const selection = `${seasonId}:${clubId || ''}`;
  const requestId = useRef(0);
  const [result, setResult] = useState<{ selection: string; row: StandingsRow | null } | null>(null);
  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setResult(null);
    try {
      if (!clubId || !leagueId) return;
      const row = await loadActiveClubStanding(clubId, leagueId, seasonId);
      if (request === requestId.current) setResult({ selection, row });
    } catch {
      if (request === requestId.current) setResult(null);
    }
  }, [clubId, leagueId, seasonId, selection]);
  useEffect(() => {
    return () => { requestId.current++; };
  }, [refresh]);
  return { row: result?.selection === selection ? result.row : null, refresh };
}
