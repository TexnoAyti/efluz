// Read-only club schedule. Returns a complete bounded result or fails closed.
import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_:-]{1,120}$/.test(x);
export default async function(input={},ctx){
 verifiedTelegramId(ctx);
 const {seasonId,clubId}=input;
 if(!validId(seasonId)||!validId(clubId)||
    Object.keys(input).some(k=>!['seasonId','clubId'].includes(k)))
   throw new EndpointError('Klub jadvali so‘rovi noto‘g‘ri.',{code:'INVALID_CLUB_FIXTURES'});
 const club=await db.get(`SELECT c.id FROM efl_clubs c
   JOIN efl_leagues l ON l.id=c.league_id
   WHERE c.id=:club AND l.season_id=:season LIMIT 1`,
   {':club':clubId,':season':seasonId});
 if(!club)throw new EndpointError('Klub topilmadi.',{code:'CLUB_NOT_FOUND'});
 const fixtures=await db.all(`SELECT id,season_id AS seasonId,
   competition_id AS competitionId,league_id AS leagueId,
   round,home_club_id AS homeClubId,away_club_id AS awayClubId,
   home_score AS homeScore,away_score AS awayScore,status,
   confirmation_status AS confirmationStatus,
   scheduled_at AS scheduledAt,played_at AS playedAt
   FROM efl_fixtures WHERE season_id=:season
    AND (home_club_id=:club OR away_club_id=:club)
   ORDER BY round ASC,id ASC LIMIT 101`,
   {':season':seasonId,':club':clubId});
 if(fixtures.length>100)
   throw new EndpointError('Jadval uchun sahifalash talab qilinadi.',{code:'FIXTURE_PAGINATION_REQUIRED'});
 return {ok:true,seasonId,clubId,fixtures,stale:false,degraded:false,
   source:'telegram-serverless'};
}
