import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {claimClub} from '../lib/clubClaim.js';

// Locked until verified second-season admissions and ban policy parity.
export default async function(input={},ctx){
  if(!MUTATION_CONTROL.enabled)
    throw new EndpointError('Klub tanlash yangi backendda hali yoqilmagan.',
      {code:'SHADOW_WRITE_DISABLED'});
  const {user}=await currentUser(ctx);
  if(!user)throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
  try{return await claimClub(db,user.id,input);}
  catch(err){
    const code=String(err?.message||'CLUB_CLAIM_FAILED');
    if(/^(INVALID_|UNKNOWN_CLAIM_FIELD|CLUB_CLAIM_)/.test(code))
      throw new EndpointError('Klub tanlash rad etildi.',{code});
    throw err;
  }
}
