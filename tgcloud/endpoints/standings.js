import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';

// Standings projection for confirmed league results only. Cup tie-breaks
// and official ranking rules require a parity-verified implementation.
export default async function(input={},ctx) {
  verifiedTelegramId(ctx);
  const leagueId=typeof input.leagueId==='string'?input.leagueId.trim():'';
  const seasonId=typeof input.seasonId==='string'?input.seasonId.trim():'';
  if(!/^[\w:-]{1,100}$/.test(leagueId)||!/^[\w:-]{1,100}$/.test(seasonId))
    throw new EndpointError('Liga yoki mavsum noto‘g‘ri.',{code:'INVALID_SCOPE'});
  const clubs=await db.all(`SELECT c.id,c.name,c.short_name AS shortName,c.logo_url AS logoUrl
    FROM efl_clubs c JOIN efl_leagues l ON l.id=c.league_id
    WHERE l.id=:league AND l.season_id=:season ORDER BY c.sort_order,c.id`,
    {':league':leagueId,':season':seasonId});
  const fixtures=await db.all(`SELECT home_club_id AS homeClubId,away_club_id AS awayClubId,
    f.home_score AS homeScore,f.away_score AS awayScore
    FROM efl_fixtures f
    JOIN efl_competitions comp ON comp.id=f.competition_id
      AND comp.season_id=f.season_id AND comp.type='LEAGUE'
    WHERE f.league_id=:league AND f.season_id=:season AND
    f.status='CONFIRMED' AND f.home_score IS NOT NULL AND f.away_score IS NOT NULL`,
    {':league':leagueId,':season':seasonId});
  const rows=clubs.map(c=>({...c,played:0,wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,goalDifference:0,points:0}));
  const byId=new Map(rows.map(r=>[r.id,r]));
  for(const f of fixtures){
    const h=byId.get(f.homeClubId),a=byId.get(f.awayClubId);
    if(!h||!a||!Number.isSafeInteger(f.homeScore)||!Number.isSafeInteger(f.awayScore)) continue;
    h.played++;a.played++;h.goalsFor+=f.homeScore;h.goalsAgainst+=f.awayScore;
    a.goalsFor+=f.awayScore;a.goalsAgainst+=f.homeScore;
    if(f.homeScore>f.awayScore){h.wins++;a.losses++;h.points+=3;}
    else if(f.homeScore<f.awayScore){a.wins++;h.losses++;a.points+=3;}
    else{h.draws++;a.draws++;h.points++;a.points++;}
  }
  for(const r of rows)r.goalDifference=r.goalsFor-r.goalsAgainst;
  rows.sort((a,b)=>b.points-a.points||b.goalDifference-a.goalDifference||b.goalsFor-a.goalsFor||a.name.localeCompare(b.name));
  return {ok:true,seasonId,leagueId,rows:rows.map((r,i)=>({...r,position:i+1})),
    provisional:true,source:'telegram-serverless'};
}
