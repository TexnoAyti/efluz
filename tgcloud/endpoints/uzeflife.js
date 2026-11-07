import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readUzeflife} from '../lib/uzeflifeRead.js';

export default async function(input={},ctx){
 verifiedTelegramId(ctx);
 try{return await readUzeflife(db,input);}
 catch(error){
  const code=String(error?.message||'UZEFLIFE_UNAVAILABLE');
  if(/^(INVALID_UZEFLIFE_|UNKNOWN_UZEFLIFE_FIELD)/.test(code))
   throw new EndpointError('UZEFLIFE so‘rovi noto‘g‘ri.',{code});
  throw error;
 }
}
