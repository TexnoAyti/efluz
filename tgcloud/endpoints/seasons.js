// Read-only EFLUZ season list for the original React Mini App.
// No owner-supplied identities, no writes, and no legacy API forwarding.
import {db} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';

export function normalizeSeason(row){
  if(!row||typeof row.id!=='string'||!/^season-20\d{2}-\d{2}$/.test(row.id))
    throw Error('SERVERLESS_SEASON_ROW_INVALID');
  const raw=String(row.status||'').toUpperCase();
  const status=raw==='ACTIVE'||row.isActive===1||row.isActive===true?'active':
    raw==='REGISTRATION'?'registration':raw==='COMPLETED'?'completed':'upcoming';
  const toIso=value=>{
    if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return '';
    const millis=value<1e11?value*1000:value;
    const date=new Date(millis);
    return Number.isNaN(date.getTime())?'':date.toISOString();
  };
  return {
    id:row.id,name:typeof row.name==='string'?row.name:row.id,status,
    startDate:toIso(row.startsAt),
    createdAt:toIso(row.createdAt),
    ...(toIso(row.endsAt)?{endDate:toIso(row.endsAt)}:{}),
  };
}
export default async function (_input={},ctx){
  verifiedTelegramId(ctx);
  const rows=await db.all(`SELECT id,name,status,is_active AS isActive,starts_at AS startsAt,
     ends_at AS endsAt,created_at AS createdAt FROM efl_seasons
     ORDER BY created_at DESC LIMIT 20`);
  return {ok:true,seasons:rows.map(normalizeSeason),source:'telegram-serverless'};
}
