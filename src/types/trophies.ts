export interface TrophyRecord {
  competitionId: string;
  competitionName: string;
  seasonId: string;
  clubId: string;
  clubName: string;
  winnerUserId?: string;
  winnerUsername?: string;
  decidedBy: 'FINAL' | 'LEAGUE_TABLE' | 'ONE_MATCH_FINAL';
  confirmedAt?: string | null;
}

export interface PlayerTrophy extends TrophyRecord {
  id: string;
}

export interface PlayerTrophyCabinet {
  trophies: PlayerTrophy[];
  stale: boolean;
}

export function trophyId(seasonId: string, competitionId: string): string {
  return `${seasonId}__${competitionId}`;
}

export function seasonLabel(seasonId: string): string {
  const match = /^season-(\d{4})-(\d{2})$/.exec(seasonId);
  return match ? `${match[1]}/${match[2]}` : seasonId;
}
