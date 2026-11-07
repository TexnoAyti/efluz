import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readUzeflifeRoundAudit} from '../lib/uzeflifeRoundAudit.js';

export default async function(input={},ctx){
 const id=verifiedTelegramId(ctx);
 try{return await readUzeflifeRoundAudit(db,id,input);}
 catch(error){
  const code=String(error?.message||'UZEFLIFE_AUDIT_UNAVAILABLE');
  if(/^(INVALID_UZEFLIFE_|UZEFLIFE_)/.test(code))
   throw new EndpointError('Joriy UZEFLIFE turining auditi mavjud emas.',{code});
  throw error;
 }
}
