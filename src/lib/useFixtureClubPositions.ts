import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { TOP5_CLUBS } from '../constants/top5Clubs';
import type { Fixture } from '../types';

type Client = Pick<typeof api, 'getCompetitions' | 'getCompetitionStandings'>;
export async function loadFixtureClubPositions(fixture: Fixture, seasonId: string, client: Client = api): Promise<Record<string, number>> {
  const clubs = ['home', 'away'].map(side => {
    const id = side === 'home' ? fixture.homeClubId : fixture.awayClubId;
    const club = side === 'home' ? fixture.homeClub : fixture.awayClub;
    return { id, leagueId: club?.leagueId || TOP5_CLUBS.find(c => c.id === id)?.leagueId };
  });
  const { competitions } = await client.getCompetitions(seasonId, false, 'league-summary');
  const leagues = competitions.filter(c => c.seasonId === seasonId && c.type === 'LEAGUE' && clubs.some(club => club.leagueId === c.leagueId));
  const tables = await Promise.allSettled(leagues.map(c => client.getCompetitionStandings(c.id, false, seasonId, 'league-summary')));
  const result: Record<string, number> = {};
  for (let index = 0; index < tables.length; index++) {
    const table = tables[index];
    if (table.status !== 'fulfilled') continue;
    for (const club of clubs.filter(c => c.leagueId === leagues[index].leagueId)) {
      const row = table.value.standings.find(r => r.clubId === club.id);
      if (club.id && row && row.position > 0) result[club.id] = row.position;
    }
  }
  return result;
}

/** A late response for another match/season must never label the current teams. */
export function useFixtureClubPositions(fixture: Fixture | null, seasonId: string) {
  const key = `${seasonId}:${fixture?.id || ''}:${fixture?.homeClubId || ''}:${fixture?.awayClubId || ''}:${fixture?.updatedAt || ''}`;
  const [result, setResult] = useState<{ key: string; positions: Record<string, number> } | null>(null);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    if (fixture) loadFixtureClubPositions(fixture, seasonId).then(positions => {
      if (id === request.current) setResult({ key, positions });
    }).catch(() => { if (id === request.current) setResult(null); });
    return () => { request.current++; };
  }, [key]);
  return result?.key === key ? result.positions : {};
}
