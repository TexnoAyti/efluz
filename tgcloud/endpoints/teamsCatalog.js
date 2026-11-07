import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readTeamsCatalog} from '../lib/teamsCatalogRead.js';

export default async function(input={},ctx){
 verifiedTelegramId(ctx);
 try{return await readTeamsCatalog(db,input);}
 catch(error){
  const code=String(error?.message||'TEAMS_CATALOG_UNAVAILABLE');
  if(/^(INVALID_TEAMS_|UNKNOWN_TEAMS_FIELD)/.test(code))
   throw new EndpointError('Jamoalar ro‘yxati so‘rovi noto‘g‘ri.',{code});
  throw error;
 }
}
