// Read-only fixture identity and score. No result submission or moderation.
import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
export default async function(input={},ctx){
 verifiedTelegramId(ctx);
 const {fixtureId}=input;
 if(typeof fixtureId!=='string'||!/^[A-Za-z0-9_:-]{1,120}$/.test(fixtureId)||
    Object.keys(input).some(k=>k!=='fixtureId'))
   throw new EndpointError('Uchrashuv so‘rovi noto‘g‘ri.',{code:'INVALID_FIXTURE'});
 const fixture=await db.get(`SELECT id,season_id AS seasonId,
   competition_id AS competitionId,league_id AS leagueId,round,
   home_club_id AS homeClubId,away_club_id AS awayClubId,
   home_score AS homeScore,away_score AS awayScore,status,
   confirmation_status AS confirmationStatus,scheduled_at AS scheduledAt,
   played_at AS playedAt FROM efl_fixtures WHERE id=:fixture LIMIT 1`,
   {':fixture':fixtureId});
 if(!fixture)throw new EndpointError('Uchrashuv topilmadi.',{code:'FIXTURE_NOT_FOUND'});
 return {ok:true,fixture,source:'telegram-serverless'};
}
