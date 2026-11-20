import {db,api,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {prepareRoundGuideBatch,dispatchRoundGuideBatch} from '../lib/roundGuideBroadcast.js';

// Separate staging-only cutover gate. Enqueue is safe on the isolated
// staging database; actual Telegram sends remain disabled until the owner
// has verified SDK behavior AND stopped the legacy production dispatcher.
export const ROUND_GUIDE_CONTROL=Object.freeze({
 prepareEnabled:false,
 sendEnabled:false,
 productionReady:false,
});
export default async function(input={},ctx){
 const actor=verifiedTelegramId(ctx);
 if(!input||typeof input!=='object'||Array.isArray(input)||
    !['prepare','dispatch'].includes(input.action))
  throw new EndpointError('Noto‘g‘ri so‘rov.',{code:'INVALID_ROUND_GUIDE_REQUEST'});
 const {action,...options}=input;
 if((action==='prepare'&&!ROUND_GUIDE_CONTROL.prepareEnabled)||
    (action==='dispatch'&&(!ROUND_GUIDE_CONTROL.sendEnabled||!ROUND_GUIDE_CONTROL.productionReady)))
   throw new EndpointError('Tarqatish hali yoqilmagan.',{code:'ROUND_GUIDE_DELIVERY_DISABLED'});
 try{
  return action==='prepare'
   ? await prepareRoundGuideBatch(db,actor,options)
   : await dispatchRoundGuideBatch(db,api,actor,options);
 }catch(error){
  const code=String(error?.message||'ROUND_GUIDE_FAILED');
  if(['ROUND_GUIDE_FORBIDDEN','INVALID_ROUND_GUIDE_REQUEST','ROUND_GUIDE_BATCH_TOO_LARGE',
     'AUTH_REQUIRED'].includes(code))
   throw new EndpointError('Xabarlarni boshqarish ruxsat etilmagan.',{code});
  throw error;
 }
}
