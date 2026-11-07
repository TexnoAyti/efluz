import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readDomainOperationsAudit} from '../lib/domainOperationsAudit.js';

// Private staff-only staging diagnostics. No mutation or raw data export.
export default async function(input={},ctx){
 const telegramId=verifiedTelegramId(ctx);
 try{return await readDomainOperationsAudit(db,telegramId,input);}
 catch(error){
  const code=String(error?.message||'DOMAIN_AUDIT_UNAVAILABLE');
  if(code==='DOMAIN_AUDIT_FORBIDDEN'||code==='INVALID_DOMAIN_AUDIT_REQUEST'||
     code.startsWith('INVALID_DOMAIN_AUDIT_')||code==='DOMAIN_AUDIT_INCONSISTENT_COUNTS')
   throw new EndpointError('Serverless operatsion audit mavjud emas.',{code});
  throw error;
 }
}
