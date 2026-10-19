import React from 'react';
import type {CustomTournamentFormat,CustomTournamentRulesConfig} from '../../types/customTournament';

export function TournamentRulesFields({format,maxParticipants,rules,onChange,inputClass}:{format:CustomTournamentFormat;maxParticipants:number;rules:CustomTournamentRulesConfig;onChange:(rules:CustomTournamentRulesConfig)=>void;inputClass:string}){
  const patch=(changes:Partial<CustomTournamentRulesConfig>)=>{
    const next={...rules,...changes};
    const allowed=[2,4,8,16].filter(q=>q<=maxParticipants&&(next.groupStageMode!=='GROUPS'||q%(next.groupsCount??2)===0));
    if(format==='LEAGUE_AND_PLAYOFF'&&!allowed.includes(next.playoffQualifiersCount??4)) next.playoffQualifiersCount=allowed[0] as 2|4|8|16;
    onChange(next);
  };
  const groups=rules.groupsCount??2;
  return <div className="space-y-3">
    {format!=='PLAYOFF'&&<label className="block text-xs text-[var(--efl-text-2)]">Davra soni<select className={inputClass} value={rules.roundsCount} onChange={e=>patch({roundsCount:Number(e.target.value) as 1|2})}><option value={1}>Har raqib bilan 1 o‘yin</option><option value={2}>Har raqib bilan 2 o‘yin</option></select></label>}
    {format!=='LEAGUE'&&<label className="block text-xs text-[var(--efl-text-2)]">Pley-off juftligi<select className={inputClass} value={rules.playoffLegMode} onChange={e=>patch({playoffLegMode:e.target.value as CustomTournamentRulesConfig['playoffLegMode']})}><option value="SINGLE_LEG">1 o‘yin</option><option value="TWO_LEG">2 o‘yin · final 1 o‘yin</option></select></label>}
    {format==='LEAGUE_AND_PLAYOFF'&&<>
      <label className="block text-xs text-[var(--efl-text-2)]">Liga bosqichi<select className={inputClass} value={rules.groupStageMode??'SINGLE_TABLE'} onChange={e=>patch({groupStageMode:e.target.value as 'GROUPS'|'SINGLE_TABLE',groupsCount:maxParticipants<8?2:groups})}><option value="SINGLE_TABLE">Umumiy jadval</option><option value="GROUPS">Guruhlar</option></select></label>
      {rules.groupStageMode==='GROUPS'&&<label className="block text-xs text-[var(--efl-text-2)]">Guruhlar soni<select className={inputClass} value={groups} onChange={e=>patch({groupsCount:Number(e.target.value) as 2|4})}><option value={2}>2 guruh</option>{(maxParticipants>=8||groups===4)&&<option value={4} disabled={maxParticipants<8}>4 guruh · kamida 8 klub</option>}</select></label>}
      <label className="block text-xs text-[var(--efl-text-2)]">Pley-offga chiqadigan klublar<select className={inputClass} value={rules.playoffQualifiersCount??4} onChange={e=>patch({playoffQualifiersCount:Number(e.target.value) as 2|4|8|16})}>{((rules.playoffQualifiersCount??4)>maxParticipants||(rules.groupStageMode==='GROUPS'&&(rules.playoffQualifiersCount??4)%groups!==0))&&<option value={rules.playoffQualifiersCount??4} disabled>{rules.playoffQualifiersCount??4} klub · reglamentni moslang</option>}{[2,4,8,16].filter(q=>q<=maxParticipants&&(rules.groupStageMode!=='GROUPS'||q%groups===0)).map(q=><option key={q} value={q}>{q} klub{rules.groupStageMode==='GROUPS'?` · har guruhdan ${q/groups} ta`:''}</option>)}</select></label>
    </>}
  </div>;
}
