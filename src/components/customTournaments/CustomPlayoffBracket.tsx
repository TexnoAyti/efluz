import React, { useMemo } from 'react';
import { SofaBracketTree, type BracketFixture } from '../SofaBracketTree';
import type { Club } from '../../types';
import type { CustomTournamentFixture } from '../../types/customTournament';

const roundNames: Record<string, string> = {
  PLAYOFF_R32: 'Round of 32', PLAYOFF_R16: 'Round of 16',
  PLAYOFF_QF: 'Quarter-final', PLAYOFF_SF: 'Semi-final', PLAYOFF_FINAL: 'Final',
};

export function CustomPlayoffBracket({ fixtures }: { fixtures: CustomTournamentFixture[] }) {
  const matches = useMemo(() => fixtures.filter(f => roundNames[f.stage] && f.leg === 1).map(f => {
    const second = fixtures.find(other => other.id === f.id.replace(/_l1$/, '_l2'));
    const club = (id: string, name: string, logoUrl?: string): Club => ({
      id, name, shortName: name, logoUrl: logoUrl || '', leagueId: '', country: '', active: true, createdAt: '',
    });
    return {
      id: f.id, seasonId: '', competitionId: f.tournamentId,
      matchday: f.roundOrMatchday, roundName: roundNames[f.stage],
      homeClubId: f.homeClubId === 'TBD' ? null : f.homeClubId,
      awayClubId: f.awayClubId === 'TBD' ? null : f.awayClubId,
      homeClub: club(f.homeClubId, f.homeClubName, f.homeClubLogoUrl),
      awayClub: club(f.awayClubId, f.awayClubName, f.awayClubLogoUrl),
      status: f.status === 'BYE_AUTO_ADVANCED' ? 'CONFIRMED' : f.status,
      homeScore: f.homeScore, awayScore: f.awayScore, winnerClubId: f.winnerClubId,
      scheduledAt: f.deadlineAt, createdAt: '', updatedAt: '',
      nextMatchFixtureId: f.nextMatchFixtureId,
      penaltyHomeScore: f.penaltyHomeScore, penaltyAwayScore: f.penaltyAwayScore,
      secondLegLabel: second ? `2-o‘yin: ${second.homeClubName} ${second.homeScore ?? '–'}:${second.awayScore ?? '–'} ${second.awayClubName}${second.penaltyHomeScore != null ? ` (pen: ${second.penaltyHomeScore}:${second.penaltyAwayScore})` : ''}` : undefined,
    } satisfies BracketFixture;
  }), [fixtures]);
  return <SofaBracketTree fixtures={matches} />;
}
