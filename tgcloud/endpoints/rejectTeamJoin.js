import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {rejectTeamJoin} from '../lib/teamsJoinWorkflow.js';

// Staging-only captain/manager/admin rejection. No automated messages yet.
export default async function(input={},ctx){
 if(!MUTATION_CONTROL.enabled)
  throw new EndpointError('TEAMS arizalarini boshqarish hali sinov rejimida.',
   {code:'SHADOW_WRITE_DISABLED'});
 const actor=verifiedTelegramId(ctx);
 try{return await rejectTeamJoin(db,{telegramId:actor},input);}
 catch(error){
  const code=String(error?.message||'TEAMS_REJECTION_FAILED');
  if(/^(INVALID_TEAMS_JOIN|UNKNOWN_TEAMS_JOIN_FIELD|TEAMS_)/.test(code))
   throw new EndpointError('TEAMS arizasini rad etib bo‘lmadi.',{code});
  throw error;
 }
}
