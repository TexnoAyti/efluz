import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readTeamJoinQueue} from '../lib/teamsJoinQueue.js';

export default async function(input={},ctx){
 const telegramId=verifiedTelegramId(ctx);
 try{return await readTeamJoinQueue(db,telegramId,input);}
 catch(error){
  const code=String(error?.message||'TEAMS_QUEUE_ERROR');
  if(/^(TEAMS_|INVALID_TEAMS_|UNKNOWN_TEAMS_QUEUE_FIELD)/.test(code))
   throw new EndpointError('TEAMS arizalari mavjud emas.',{code});
  throw error;
 }
}
