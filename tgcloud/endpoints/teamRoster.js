import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readPrivateTeamRoster} from '../lib/teamsPrivateRoster.js';

export default async function(input={},ctx){
 const actor=verifiedTelegramId(ctx);
 try{return await readPrivateTeamRoster(db,actor,input);}
 catch(error){
  const code=String(error?.message||'TEAMS_ROSTER_ERROR');
  if(/^(TEAMS_|INVALID_TEAMS_|UNKNOWN_TEAMS_ROSTER_FIELD)/.test(code))
   throw new EndpointError('Jamoa a’zolari ro‘yxati mavjud emas.',{code});
  throw error;
 }
}
