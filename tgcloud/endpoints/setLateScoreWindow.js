import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {setLateScoreWindow} from '../lib/lateScoreWindow.js';

// Disabled until official legacy approval rules, audit and delivery parity.
export default async function(input={},ctx){
 if(!MUTATION_CONTROL.enabled)
  throw new EndpointError('Oldingi tur natijalarini ochish hali sinov rejimida.',
   {code:'SHADOW_WRITE_DISABLED'});
 const actor=verifiedTelegramId(ctx);
 try{return await setLateScoreWindow(db,actor,input);}
 catch(error){
  const code=String(error?.message||'LATE_SCORE_WINDOW_UNAVAILABLE');
  if(code.startsWith('LATE_SCORE_')||code==='INVALID_LATE_SCORE_WINDOW')
   throw new EndpointError('Natija oynasini o‘zgartirish rad etildi.',{code});
  throw error;
 }
}
