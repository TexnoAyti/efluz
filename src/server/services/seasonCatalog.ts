import {EFL_SECOND_SEASON} from '../../lib/seasonPreparation';
import {SEED_CLUBS,SEED_LEAGUES} from '../db/seed';

/** Static metadata only. Owners and results always come from the requested season. */
export function seasonClubs(seasonId:string):typeof SEED_CLUBS{
  if(seasonId!==EFL_SECOND_SEASON.id)return SEED_CLUBS;
  return EFL_SECOND_SEASON.leagues.flatMap(league=>league.roster.clubs.map(club=>{
    const previous=SEED_CLUBS.find(c=>c.id===club.id);
    return {id:club.id,name:club.name,shortName:previous?.shortName||club.name,
      country:league.country,leagueId:league.id,logoUrl:previous?.logoUrl||'',
      ...(previous?.stadium?{stadium:previous.stadium}:{})};
  }));
}
export function seasonLeagues(seasonId:string):typeof SEED_LEAGUES{
  if(seasonId!==EFL_SECOND_SEASON.id)return SEED_LEAGUES;
  return EFL_SECOND_SEASON.leagues.map(league=>({
    id:league.id,name:league.name,country:league.country,tier:1,
    logoUrl:SEED_LEAGUES.find(l=>l.id===league.id)?.logoUrl||'',
  }));
}
export const preparedLeagueReadConfig=Object.fromEntries(EFL_SECOND_SEASON.leagues.map(league=>[
  league.competitionId,{leagueId:league.id,expectedCount:league.roster.clubs.length,name:league.name},
]));
