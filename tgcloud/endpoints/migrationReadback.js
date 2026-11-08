import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {READBACK_CONTROL} from '../lib/importControl.js';
import {readMigrationPage} from '../lib/migrationReadback.js';

// Private staging-only target readback. Do not publish or enable on production.
export default async function(input={},ctx){
  const telegramId=verifiedTelegramId(ctx);
  if(!READBACK_CONTROL.enabled||!READBACK_CONTROL.ownerTelegramId||
     telegramId!==READBACK_CONTROL.ownerTelegramId)
    throw new EndpointError('Migratsiya tekshiruvi yopiq.',{code:'READBACK_DISABLED'});
  try{return await readMigrationPage(db,input);}
  catch(error){
    const code=String(error?.message||'READBACK_FAILED');
    if(/^(INVALID_READBACK_|READBACK_)/.test(code))
      throw new EndpointError('Migratsiya readback tekshiruvi rad etildi.',{code});
    throw error;
  }
}
