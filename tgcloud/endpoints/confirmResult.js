import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {confirmFixtureResult} from '../lib/confirmResult.js';

// Never enable without result consensus, dispute and audit parity in staging.
export default async function(input={},ctx){
  if(!MUTATION_CONTROL.enabled)
    throw new EndpointError('Natijani tasdiqlash yangi backendda hali yoqilmagan.',
      {code:'SHADOW_WRITE_DISABLED'});
  const {user}=await currentUser(ctx);
  if(!user)throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
  try{return await confirmFixtureResult(db,user.id,input);}
  catch(error){
    const code=String(error?.message||'CONFIRM_FAILED');
    if(/^(INVALID_|UNKNOWN_CONFIRMATION_FIELD|USER_BANNED_OR_MISSING|SUBMISSION_|SELF_CONFIRM_FORBIDDEN|FIXTURE_INCOMPLETE|CONFIRM_)/.test(code))
      throw new EndpointError('Natijani tasdiqlash rad etildi.',{code});
    throw error;
  }
}
