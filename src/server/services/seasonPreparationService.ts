import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { generateRoundRobinSchedule } from '../tournament/fixtureEngine';

/** Preview only: no DB imports, activation, ownership copying or real-world results. */
export function previewPreparedLeagueSchedule(leagueId: string) {
  const league = EFL_SECOND_SEASON.leagues.find(item => item.id === leagueId);
  if (!league) return null;
  const fixtures = generateRoundRobinSchedule(league.roster.clubs.map(club => club.id), {
    homeAndAway: league.format.homeAndAway,
  });
  return {
    seasonId: EFL_SECOND_SEASON.id,
    competitionId: league.competitionId,
    leagueId: league.id,
    status: 'PREPARATION',
    persisted: false,
    scheduleKind: 'EFL_DRAFT',
    realSeason: league.roster.realSeason,
    totalMatchdays: league.format.totalMatchdays,
    fixtures,
  };
}

/** Structural preview only. Rank slots are placeholders; no club or random draw is invented. */
export function previewPreparedCupBracket(cupId: string) {
  const cup=EFL_SECOND_SEASON.domesticCups.find(item=>item.id===cupId);
  if(!cup)return null;
  type Slot={leaguePosition:number|null;winnerOfFixtureId:string|null};
  type Match={id:string;round:string;home:Slot;away:Slot};
  const fixtures:Match[]=[];
  const position=(rank:number):Slot=>({leaguePosition:rank,winnerOfFixtureId:null});
  const winner=(id:string):Slot=>({leaguePosition:null,winnerOfFixtureId:id});
  const add=(round:string,index:number,home:Slot,away:Slot)=>{
    const id=cup.id+'-'+round+'-'+index;fixtures.push({id,round,home,away});return id;
  };
  const prelim:string[]=[];
  for(let i=0;i<cup.preliminaryMatches;i++){
    const rank=cup.byeTeams+1+i*2;
    prelim.push(add('PLAY_IN',i,position(rank),position(rank+1)));
  }
  const pureByeMatches=(cup.byeTeams-cup.preliminaryMatches)/2;
  let rank=1;
  let previous:string[]=[];
  for(let i=0;i<8;i++){
    const home=position(rank++);
    const away=i<pureByeMatches?position(rank++):winner(prelim[i-pureByeMatches]);
    previous.push(add('ROUND_OF_16',i,home,away));
  }
  for(const round of ['QUARTER_FINAL','SEMI_FINAL','FINAL']){
    const next:string[]=[];
    for(let i=0;i<previous.length;i+=2)next.push(add(round,i/2,winner(previous[i]),winner(previous[i+1])));
    previous=next;
  }
  return {seasonId:EFL_SECOND_SEASON.id,competitionId:cup.id,status:'PREPARATION',persisted:false,
    previewKind:'RANK_SLOT_TEMPLATE',drawPending:true,totalTeams:cup.expectedEntrants,
    seedingStatus:cup.seedingStatus,totalFixtures:fixtures.length,fixtures};
}
