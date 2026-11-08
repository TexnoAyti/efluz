import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {proposeFixtureResult} from '../lib/resultProposal.js';

export default async function(input={},ctx){
  if(!MUTATION_CONTROL.enabled)
    throw new EndpointError('Natija yuborish yangi backendda hali yoqilmagan.',
      {code:'SHADOW_WRITE_DISABLED'});
  const {user}=await currentUser(ctx);
  if(!user)throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
  try{return await proposeFixtureResult(db,user.id,input);}
  catch(err){
    const code=String(err?.message||'PROPOSAL_FAILED');
    if(/^(INVALID_|UNKNOWN_PROPOSAL_FIELD|USER_BANNED_OR_MISSING|FIXTURE_UNAVAILABLE|MATCHDAY_LOCKED|FIXTURE_FORBIDDEN|PROPOSAL_CONFLICT)/.test(code))
      throw new EndpointError('Natija yuborish rad etildi.',{code});
    throw err;
  }
}
