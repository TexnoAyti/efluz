import { withSeasonQualificationPolicy } from './seasonQualificationPolicy';
import type { Competition } from '../types';
export interface ImageZone { label:string; start:number; end:number; color:string; tint:string }
export interface ImageBranding { emblemUrl?:string; accent:string; zones:ImageZone[] }
const domestic:Record<string,{icon:string;accent:string}>={
  'league-premier-league':{icon:'premier-league',accent:'#bba3ff'},
  'league-la-liga':{icon:'la-liga',accent:'#ff625e'},
  'league-serie-a':{icon:'serie-a',accent:'#46b8ff'},
  'league-bundesliga':{icon:'bundesliga',accent:'#ff546b'},
  'league-ligue-1':{icon:'ligue-1',accent:'#d7f451'},
};
export function tournamentImageBranding(competition:Competition,competitions:Competition[],teams:number):ImageBranding {
  competitions=competitions.map(c=>withSeasonQualificationPolicy(c,competition.seasonId));
  competition=withSeasonQualificationPolicy(competition,competition.seasonId);
  const brand=competition.leagueId?domestic[competition.leagueId]:undefined;
  const zones:ImageZone[]=[];
  const add=(label:string,start:number,end:number,color:string,tint:string)=>{if(Number.isInteger(start)&&Number.isInteger(end)&&start>0&&end>=start&&end<=teams)zones.push({label,start,end,color,tint});};
  const config=competition.formatConfig as any;
  if(competition.type==='LEAGUE'&&brand){
    const ucl=competitions.find(c=>c.id==='comp-champions-league-2026')?.formatConfig as any;
    const uel=competitions.find(c=>c.id==='comp-europa-league-2026')?.formatConfig as any;
    // Match qualificationEngine's override priority and UEL fallback exactly.
    const uclCount=Number(ucl?.qualificationSlots?.[competition.id]??config?.qualificationSpots);
    const uelCount=Number(uel?.qualificationSlots?.[competition.id]??config?.europaQualificationSpots??config?.qualificationSpots);
    if(Number.isInteger(uclCount)&&Number.isInteger(uelCount)&&uclCount>=0&&uelCount>=0&&uclCount+uelCount<=teams){
      add('UCL',1,uclCount,'#72a9ff','#192e4d');
      add('UEL',uclCount+1,uclCount+uelCount,'#ffb267','#38291f');
    }
    if(teams===18||teams===20)add('↓',teams-2,teams,'#ff8c9c','#382330');
  }else if(competition.type==='EUROPEAN_LEAGUE_PHASE'){
    const direct=Number(config?.directQualifiers),playoffs=Number(config?.playoffTeams);
    add('1/8',1,direct,'#72a9ff','#192e4d');
    add('Play-off',direct+1,direct+playoffs,'#ffb267','#38291f');
  }
  return {emblemUrl:brand?`/export-emblems/${brand.icon}.svg`:undefined,accent:brand?.accent||'#78aaff',zones};
}
