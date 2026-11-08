import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {approveTeamJoin} from '../lib/teamsJoinWorkflow.js';

// This is only a staging implementation of global-admin approval.
// Captain approval, paid tickets and chat-group membership still need parity.
export default async function(input={},ctx){
 if(!MUTATION_CONTROL.enabled)
  throw new EndpointError('TEAMS boshqaruvi yangi backendda hali yoqilmagan.',
   {code:'SHADOW_WRITE_DISABLED'});
 const telegramId=verifiedTelegramId(ctx);
 try{return await approveTeamJoin(db,{telegramId},input);}
 catch(error){
  const code=String(error?.message||'TEAMS_APPROVAL_FAILED');
  if(/^(INVALID_TEAMS_JOIN|UNKNOWN_TEAMS_JOIN_FIELD|TEAMS_)/.test(code))
   throw new EndpointError('TEAMS arizasini tasdiqlab bo‘lmadi.',{code});
  throw error;
 }
}
