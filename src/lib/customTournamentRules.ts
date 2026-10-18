import type {CustomTournamentFormat,CustomTournamentRulesConfig} from '../types/customTournament';

/** Shared by creation, pre-start editing and start validation. */
export function tournamentRulesError(format:CustomTournamentFormat, count:number, rules:CustomTournamentRulesConfig):string|null {
  if(!Number.isInteger(count)||count<4||count>32)return 'Qatnashchilar soni 4–32 oralig‘idagi butun son bo‘lsin.';
  if (!rules || ![1,2].includes(rules.roundsCount) || !['SINGLE_LEG','TWO_LEG'].includes(rules.playoffLegMode) ||
    !Number.isInteger(rules.matchDurationHours) || rules.matchDurationHours<1 || rules.matchDurationHours>168) {
    return 'Davra, pley-off juftligi va o‘yin muddatini tekshiring.';
  }
  if(format!=='LEAGUE_AND_PLAYOFF') return null;
  const q=rules.playoffQualifiersCount??4,g=rules.groupsCount??2;
  if(![2,4,8,16].includes(q)||q>count) return 'Pley-offga chiqadigan klublar soni qatnashchilar limitidan oshmasin.';
  if(rules.groupStageMode && !['SINGLE_TABLE','GROUPS'].includes(rules.groupStageMode)) return 'Liga bosqichi turi noto‘g‘ri.';
  if(rules.groupStageMode==='GROUPS'&&(![2,4].includes(g)||g*2>count||q%g!==0)) {
    return 'Har guruhda kamida 2 klub va har guruhdan teng miqdorda pley-off qatnashchisi bo‘lishi kerak.';
  }
  return null;
}

export function canonicalTournamentRules(format:CustomTournamentFormat,rules:CustomTournamentRulesConfig):CustomTournamentRulesConfig {
  return {
    roundsCount:rules.roundsCount,playoffLegMode:rules.playoffLegMode,matchDurationHours:rules.matchDurationHours,
    ...(format==='LEAGUE_AND_PLAYOFF'?{
      playoffQualifiersCount:rules.playoffQualifiersCount??4,
      groupStageMode:rules.groupStageMode??'SINGLE_TABLE',
      ...(rules.groupStageMode==='GROUPS'?{groupsCount:rules.groupsCount??2}:{}),
    }:{}),
  };
}
