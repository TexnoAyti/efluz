import {createHash} from 'node:crypto';
import {EFL_SECOND_SEASON} from '../../lib/seasonPreparation';
import {previewPreparedLeagueSchedule,previewPreparedCupBracket} from './seasonPreparationService';
import {rankPreparedLeagueResults,type PreparedResult} from './preparedStandingsService';
import {generatePreparedEuropeanDraw,type DrawClub,type EuropeanCode} from '../tournament/preparedEuropeanDraw';

export function previewPreparedSuperCup(leagueId:string,input?:{
  fixtures:PreparedResult[];europeanFinalistClubIds?:string[];
  cupFinal:{seasonId:string;competitionId:string;status:string;homeClubId:string;awayClubId:string;winnerClubId:string};
}){
  const plan=EFL_SECOND_SEASON.superCups.find(c=>c.leagueId===leagueId);
  if(!plan)return null;
  const template={seasonId:EFL_SECOND_SEASON.id,competitionId:plan.id,persisted:false,format:plan.format,totalTeams:4,totalFixtures:3,duplicatePolicy:plan.duplicatePolicy};
  if(!input)return {...template,status:'AWAITING_RESULTS',participantClubIds:[] as string[],fixtures:[]};
  const final=input.cupFinal;
  const league=EFL_SECOND_SEASON.leagues.find(l=>l.id===leagueId)!;
  const eligible=new Set(league.roster.clubs.map(c=>c.id));
  if(final.seasonId!==EFL_SECOND_SEASON.id||final.competitionId!==plan.cupId||final.status!=='CONFIRMED'||final.homeClubId===final.awayClubId||![final.homeClubId,final.awayClubId].every(id=>eligible.has(id))||![final.homeClubId,final.awayClubId].includes(final.winnerClubId))throw new Error('INVALID_SUPER_CUP_FINAL');
  const ranked=rankPreparedLeagueResults(leagueId,input.fixtures,{final:true,europeanFinalistClubIds:input.europeanFinalistClubIds});
  if(!ranked.canFinalize)throw new Error('SUPER_CUP_FINAL_STANDINGS_REQUIRED');
  const runnerUp=final.winnerClubId===final.homeClubId?final.awayClubId:final.homeClubId;
  const selected=[final.winnerClubId,runnerUp];
  for(const row of ranked.standings)if(selected.length<4&&!selected.includes(row.id))selected.push(row.id);
  if(selected.length!==4)throw new Error('SUPER_CUP_PARTICIPANTS_INCOMPLETE');
  return {...template,status:'QUALIFIED',participantClubIds:selected,fixtures:[
    {id:plan.id+'-sf-1',round:'SEMI_FINAL',homeClubId:selected[0],awayClubId:selected[3]},
    {id:plan.id+'-sf-2',round:'SEMI_FINAL',homeClubId:selected[1],awayClubId:selected[2]},
    {id:plan.id+'-final',round:'FINAL',homeClubId:null,awayClubId:null,homeSourceFixtureId:plan.id+'-sf-1',awaySourceFixtureId:plan.id+'-sf-2'},
  ]};
}

export interface EuropeanEntry extends DrawClub{
  name:string;
  qualification:{route:'DOMESTIC'|'TITLEHOLDER'|'EPS'|'QUALIFYING';source:string};
}
const officialSource=(value:string)=>{
  try{const url=new URL(value);return url.protocol==='https:'&&(url.hostname==='uefa.com'||url.hostname.endsWith('.uefa.com'));}catch{return false;}
};
/** Verify an imported list before simulating a draw. Proof URLs are provenance, not automatic UEFA approval. */
export function previewPreparedEuropeanCompetition(code:EuropeanCode,entries:EuropeanEntry[],seed:string){
  const plan=EFL_SECOND_SEASON.europeanCompetitions.find(c=>c.code===code);
  if(!plan)throw new Error('INVALID_EUROPEAN_COMPETITION');
  if(entries.some(e=>!e.name||!['DOMESTIC','TITLEHOLDER','EPS','QUALIFYING'].includes(e.qualification?.route)||!officialSource(e.qualification?.source)))throw new Error('UEFA_ENTRY_PROVENANCE_REQUIRED');
  const fixtures=generatePreparedEuropeanDraw(code,entries,seed);
  return {seasonId:EFL_SECOND_SEASON.id,competitionId:plan.id,status:'PREPARATION',persisted:false,
    qualificationStatus:'PROVENANCE_RECORDED_REVIEW_REQUIRED',officialDraw:false,seed,participantClubIds:entries.map(c=>c.id),fixtures};
}
/** Complete reproducible staging package; no active collections or ownership records are touched. */
export function buildPreparedTournamentPackage(){
  const leagues=EFL_SECOND_SEASON.leagues.map(l=>previewPreparedLeagueSchedule(l.id)!);
  const cups=EFL_SECOND_SEASON.domesticCups.map(c=>previewPreparedCupBracket(c.id)!);
  const superCups=EFL_SECOND_SEASON.superCups.map(c=>previewPreparedSuperCup(c.leagueId)!);
  const payload={
    seasonId:EFL_SECOND_SEASON.id,sourceSeasonId:EFL_SECOND_SEASON.sourceSeasonId,
    status:'PREPARATION',registrationOpen:false,active:false,
    leagues,cups,superCups,
    europeanCompetitions:EFL_SECOND_SEASON.europeanCompetitions,
    internationalCompetitions:EFL_SECOND_SEASON.internationalCompetitions,
  };
  const fingerprint=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return {...payload,fingerprint,summary:{leagues:leagues.length,clubs:EFL_SECOND_SEASON.leagues.reduce((n,l)=>n+l.roster.clubs.length,0),
    leagueFixtures:leagues.reduce((n,l)=>n+l.fixtures.length,0),cupFixtures:cups.reduce((n,c)=>n+c.totalFixtures,0),superCups:superCups.length},
    unresolved:['UEFA_ACCESS_LIST','UEFA_PARTICIPANTS','RUNTIME_TRANSITION','SOURCE_SEASON_COMPLETION','START_DATE']};
}
