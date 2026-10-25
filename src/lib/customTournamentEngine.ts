/**
 * Custom Tournament Format Preview & Pure Math Helpers (Browser & Server safe)
 */

import {
  CustomTournamentFormat,
  CustomTournamentRulesConfig,
  TournamentFormatPreview,
} from '../types/customTournament';

/**
 * Generates an instant preview of tournament structure without mutating database.
 */
export function generateTournamentPreview(
  format: CustomTournamentFormat,
  participantsCount: number,
  rules: Partial<CustomTournamentRulesConfig> = {}
): TournamentFormatPreview {
  const n = Math.max(3, Math.min(64, participantsCount));
  const roundsCount = rules.roundsCount || 1;
  const playoffLegMode = rules.playoffLegMode || 'SINGLE_LEG';
  const legMultiplier = playoffLegMode === 'TWO_LEG' ? 2 : 1;

  if (format === 'LEAGUE') {
    const isOdd = n % 2 !== 0;
    const effectiveTeams = isOdd ? n + 1 : n;
    const roundsPerDavra = effectiveTeams - 1;
    const totalRounds = roundsPerDavra * roundsCount;
    const totalMatches = ((n * (n - 1)) / 2) * roundsCount;

    return {
      format: 'LEAGUE',
      participantsCount: n,
      totalMatches,
      totalStagesOrRounds: totalRounds,
      stagesDescription: `${roundsCount} davrali liga: ${totalRounds} ta tur, har bir qatnashchi ${totalRounds} ta uchrashuv o'tkazadi${isOdd ? ' (har turda 1 ta team dam oladi)' : ''}`,
      byeCount: isOdd ? 1 : 0,
    };
  }

  if (format === 'PLAYOFF') {
    let powerOfTwo = 4;
    while (powerOfTwo < n) {
      powerOfTwo *= 2;
    }
    const byeCount = powerOfTwo - n;
    const totalRounds = Math.log2(powerOfTwo);
    const totalPlayoffMatches = (powerOfTwo - 1 - byeCount) * legMultiplier;

    let stageName = 'Chorak final (QF)';
    if (powerOfTwo === 4) stageName = 'Yarim final (SF)';
    if (powerOfTwo === 8) stageName = 'Chorak final (QF)';
    if (powerOfTwo === 16) stageName = '1/8 final (R16)';
    if (powerOfTwo === 32) stageName = '1/16 final (R32)';
    if (powerOfTwo === 64) stageName = '1/32 final (R64)';

    return {
      format: 'PLAYOFF',
      participantsCount: n,
      totalMatches: totalPlayoffMatches,
      totalStagesOrRounds: totalRounds,
      stagesDescription: `${totalRounds} ta bosqich (${stageName}dan Finalgacha). ${
        byeCount > 0 ? `${byeCount} ta qatnashchi 1-bosqichda BYE oladi.` : 'Barcha juftliklar to‘liq.'
      }`,
      byeCount,
    };
  }

  // LEAGUE_AND_PLAYOFF
  let qualifiers = rules.playoffQualifiersCount || (n >= 32 ? 16 : n >= 16 ? 8 : n >= 8 ? 4 : 2);
  while (qualifiers > n && qualifiers > 2) {
    qualifiers = Math.floor(qualifiers / 2);
  }
  const groupMode = rules.groupStageMode || 'SINGLE_TABLE';
  const groupsCount = rules.groupsCount || 2;

  let groupStageMatches = 0;
  let breakdown: any[] | undefined;

  if (groupMode === 'GROUPS') {
    const perGroup = Math.floor(n / groupsCount);
    groupStageMatches = groupsCount * ((perGroup * (perGroup - 1)) / 2) * roundsCount;
    breakdown = Array.from({ length: groupsCount }, (_, i) => ({
      groupName: `${String.fromCharCode(65 + i)}-guruhi`,
      teamsCount: perGroup + (i === 0 ? n % groupsCount : 0),
      qualifiersCount: Math.floor(qualifiers / groupsCount),
    }));
  } else {
    groupStageMatches = ((n * (n - 1)) / 2) * roundsCount;
  }

  const playoffMatches = (qualifiers - 1) * legMultiplier;

  return {
    format: 'LEAGUE_AND_PLAYOFF',
    participantsCount: n,
    totalMatches: groupStageMatches + playoffMatches,
    totalStagesOrRounds: Math.log2(qualifiers) + 1,
    stagesDescription: `${
      groupMode === 'GROUPS' ? `${groupsCount} ta guruh bosqichi` : 'Yagona liga jadvali'
    } + ${qualifiers} talik Pley-off bosqichi`,
    groupBreakdown: breakdown,
  };
}
