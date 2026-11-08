import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {confirmFixtureResultWithOutbox} from '../lib/confirmResultWithOutbox.js';

// Never enable without result consensus, dispute and audit parity in staging.
export default async function(input={},ctx){
  if(!MUTATION_CONTROL.enabled)
    throw new EndpointError('Natijani tasdiqlash yangi backendda hali yoqilmagan.',
      {code:'SHADOW_WRITE_DISABLED'});
  const {user}=await currentUser(ctx);
  if(!user)throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
  // A plain UPDATE is unsafe: confirmation, audit and two notification rows
  // must commit together or be rolled back. Never silently fall back to db.run.
  const withTransaction=typeof db.transaction==='function'
    ? (callback)=>db.transaction(callback) : null;
  if(!withTransaction)
    throw new EndpointError('Tasdiqlash uchun atomik tranzaksiya mavjud emas.',
      {code:'RESULT_OUTBOX_TRANSACTION_REQUIRED'});
  try{return await confirmFixtureResultWithOutbox(db,user.id,input,withTransaction);}
  catch(error){
    const code=String(error?.message||'CONFIRM_FAILED');
    if(/^(INVALID_|UNKNOWN_CONFIRMATION_FIELD|USER_BANNED_OR_MISSING|SUBMISSION_|SELF_CONFIRM_FORBIDDEN|FIXTURE_INCOMPLETE|CONFIRM_|RESULT_OUTBOX_)/.test(code))
      throw new EndpointError('Natijani tasdiqlash rad etildi.',{code});
    throw error;
  }
}
