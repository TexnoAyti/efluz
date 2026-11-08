import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readCompetitionRoundPlan} from '../lib/competitionRoundPlan.js';

// Safe staging preview. Real round advancement remains disabled.
export default async function(input={},ctx){
 const actor=verifiedTelegramId(ctx);
 try{return await readCompetitionRoundPlan(db,actor,input);}
 catch(error){
  const code=String(error?.message||'ROUND_PLAN_UNAVAILABLE');
  if(code==='ROUND_PLAN_FORBIDDEN'||code==='ROUND_PLAN_COMPETITION_NOT_FOUND'||
     code.startsWith('INVALID_ROUND_PLAN_')||code==='ROUND_PLAN_INCONSISTENT')
   throw new EndpointError('Tur ma’lumotlarini tekshirib bo‘lmadi.',{code});
  throw error;
 }
}
