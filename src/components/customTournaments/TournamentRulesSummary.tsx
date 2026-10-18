import React from 'react';
import type {CustomTournamentFormat,CustomTournamentRulesConfig} from '../../types/customTournament';

export function TournamentRulesSummary({format,rules}:{format:CustomTournamentFormat;rules:CustomTournamentRulesConfig}){
  const rows:Array<[string,string]>=[];
  if(format!=='PLAYOFF')rows.push(['Liga davrasi',`${rules.roundsCount} davra · har raqib bilan ${rules.roundsCount} o‘yin`]);
  if(format==='LEAGUE_AND_PLAYOFF'){
    const q=rules.playoffQualifiersCount??4,g=rules.groupsCount??2;
    rows.push(['Liga bosqichi',rules.groupStageMode==='GROUPS'?`${g} guruh`:'Umumiy jadval']);
    rows.push(['Pley-off saralashi',rules.groupStageMode==='GROUPS'?`${q} klub · har guruhdan ${q/g} ta`:`Jadvaldagi eng yaxshi ${q} klub`]);
  }
  if(format!=='LEAGUE')rows.push(['Pley-off juftligi',rules.playoffLegMode==='TWO_LEG'?'2 o‘yin · final 1 o‘yin':'1 o‘yin']);
  rows.push(['Natija uchun muddat',`${rules.matchDurationHours} soat`]);
  return <dl aria-label="Tanlangan turnir reglamenti">{rows.map(([label,value])=><div key={label} className="tourney-summary-row"><dt>{label}</dt><dd className="font-semibold text-right break-words">{value}</dd></div>)}</dl>;
}
