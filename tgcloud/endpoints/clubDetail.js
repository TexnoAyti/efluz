// Public club details with signed caller's own ownership flag; never expose owner identity.
import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
const goodId=x=>typeof x==='string'&&/^[A-Za-z0-9_:-]{1,120}$/.test(x);
export default async function(input={},ctx){
 const telegramId=verifiedTelegramId(ctx);
 const {seasonId,clubId}=input;
 if(!goodId(seasonId)||!goodId(clubId)||
    Object.keys(input).some(k=>!['seasonId','clubId'].includes(k)))
   throw new EndpointError('Klub so‘rovi noto‘g‘ri.',{code:'INVALID_CLUB_REQUEST'});
 const record=await db.get(`SELECT c.id,c.name,c.short_name AS shortName,
   c.country,c.league_id AS leagueId,c.logo_url AS logoUrl,
   c.stadium,c.created_at AS createdAt,l.name AS leagueName,
   CASE WHEN o.id IS NULL THEN 0 ELSE 1 END AS isTaken,
   CASE WHEN o.telegram_id=:telegram THEN 1 ELSE 0 END AS isCurrentUserClub
   FROM efl_clubs c JOIN efl_leagues l ON l.id=c.league_id
   LEFT JOIN efl_club_occupancies o ON o.club_id=c.id
    AND o.league_id=l.id AND o.season_id=:season AND o.status='ACTIVE'
   WHERE c.id=:club AND l.season_id=:season LIMIT 1`,
   {':telegram':telegramId,':season':seasonId,':club':clubId});
 if(!record)throw new EndpointError('Klub topilmadi.',{code:'CLUB_NOT_FOUND'});
 return {ok:true,club:{...record,active:true,
   isTaken:Boolean(record.isTaken),isCurrentUserClub:Boolean(record.isCurrentUserClub),
   logoUrl:record.logoUrl||''},source:'telegram-serverless'};
}
