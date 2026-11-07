import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {getAdminOverview} from '../lib/adminOverview.js';

export default async function(_input={},ctx){
  const telegramId=verifiedTelegramId(ctx);
  try{return await getAdminOverview(db,telegramId);}
  catch(error){
    const code=String(error?.message||'ADMIN_OVERVIEW_UNAVAILABLE');
    if(code==='ADMIN_FORBIDDEN'||code==='ADMIN_OVERVIEW_UNAVAILABLE')
      throw new EndpointError('Administrator ma’lumotlari mavjud emas.',{code});
    throw error;
  }
}
