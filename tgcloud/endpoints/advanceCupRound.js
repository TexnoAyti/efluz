import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {advanceCupRound} from '../lib/advanceCupRound.js';

// Staging engine only. Do NOT enable until outbox, history and legacy policy
// parity are proven. Never modify a live tournament through this endpoint.
export default async function(input={},ctx){
 if(!MUTATION_CONTROL.enabled)
  throw new EndpointError('Tur almashish hali sinov rejimida.',{code:'SHADOW_WRITE_DISABLED'});
 const telegramId=verifiedTelegramId(ctx);
 try{return await advanceCupRound(db,telegramId,input);}
 catch(error){
  const code=String(error?.message||'ROUND_ADVANCE_FAILED');
  if(code.startsWith('ROUND_ADVANCE_')||code==='INVALID_ADVANCE_ROUND')
   throw new EndpointError('Tur almashish rad etildi.',{code});
  throw error;
 }
}
