import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {finalizeUzeflifeResult} from '../lib/uzeflifeResultAdmin.js';

// The shared mutation switch remains disabled. Never enable until the
// official bracket advancement, proof checks, and durable audit are ported.
export default async function(input={},ctx){
 if(!MUTATION_CONTROL.enabled)
   throw new EndpointError('UZEFLIFE natijalarini boshqarish yangi backendda hali yoqilmagan.',
    {code:'SHADOW_WRITE_DISABLED'});
 const actor=verifiedTelegramId(ctx);
 try{return await finalizeUzeflifeResult(db,actor,input);}
 catch(error){
  const code=String(error?.message||'UZEFLIFE_DECISION_FAILED');
  if(/^(INVALID_UZEFLIFE_|UNKNOWN_UZEFLIFE_DECISION_FIELD|UZEFLIFE_)/.test(code))
   throw new EndpointError('UZEFLIFE natijasini tasdiqlash rad etildi.',{code});
  throw error;
 }
}
