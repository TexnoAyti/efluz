import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readAdminScopedOverview} from '../lib/adminScopedOverview.js';

// Read only. A league moderator is NOT automatically a global admin.
export default async function(input={},ctx){
  const telegramId=verifiedTelegramId(ctx);
  try{return await readAdminScopedOverview(db,telegramId,input);}
  catch(error){
    const code=String(error?.message||'ADMIN_SCOPED_OVERVIEW_FAILED');
    if(/^(INVALID_ADMIN_|ADMIN_FORBIDDEN|ADMIN_SEASON_NOT_FOUND|ADMIN_CATALOG_PAGINATION_REQUIRED)$/.test(code))
      throw new EndpointError('Liga admin ma’lumotlari mavjud emas.',{code});
    throw error;
  }
}
