import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {submitTeamJoin} from '../lib/teamsJoinWorkflow.js';

export default async function(input={},ctx){
 if(!MUTATION_CONTROL.enabled)
  throw new EndpointError('TEAMS arizalari yangi backendda hali yoqilmagan.',
   {code:'SHADOW_WRITE_DISABLED'});
 const {telegramId,user}=await currentUser(ctx);
 if(!user)throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
 try{return await submitTeamJoin(db,{id:user.id,telegramId},input);}
 catch(error){
  const code=String(error?.message||'TEAMS_JOIN_FAILED');
  if(/^(INVALID_TEAMS_JOIN|UNKNOWN_TEAMS_JOIN_FIELD|TEAMS_)/.test(code))
   throw new EndpointError('TEAMS arizasi qabul qilinmadi.',{code});
  throw error;
 }
}
