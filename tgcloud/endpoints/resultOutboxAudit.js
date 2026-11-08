import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readResultOutboxAudit} from '../lib/resultOutboxAudit.js';

// Staff-only staging read; no notification delivery is dispatched.
export default async function(input={},ctx){
 const actor=verifiedTelegramId(ctx);
 try{return await readResultOutboxAudit(db,actor,input);}
 catch(error){
  const code=String(error?.message||'RESULT_OUTBOX_AUDIT_UNAVAILABLE');
  if(code.startsWith('INVALID_RESULT_OUTBOX_')||
     code==='RESULT_OUTBOX_AUDIT_FORBIDDEN'||
     code==='RESULT_OUTBOX_AUDIT_INCONSISTENT')
   throw new EndpointError('Natija va bildirishnomalar auditi mavjud emas.',{code});
  throw error;
 }
}
