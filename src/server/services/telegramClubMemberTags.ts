import { waitUntil } from '@vercel/functions';
import { createHash } from 'node:crypto';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { SEED_CLUBS } from '../db/seed';
import { PostgresKeyValueStore } from './postgresKeyValueStore';

const state = () => new PostgresKeyValueStore('telegram_member_tag_state');
const group = () => (process.env.TELEGRAM_GROUP_USERNAME || '@efleagueuz').trim();
const scope = () => createHash('sha256').update(`${process.env.TELEGRAM_BOT_TOKEN?.split(':')[0]}:${group().toLowerCase()}`).digest('hex');
const statusKey = () => 'club-tags:status:' + scope();
const records = 'telegram_member_tags';
const clubs = new Map(SEED_CLUBS.map(c => [c.id, c]));
const aliases: Record<string,string> = {
  'club-man-city':'Manchester City', 'club-man-utd':'Man United', 'club-nottm-forest':'Nottm Forest',
  'club-brighton':'Brighton', 'club-gladbach':'Mönchengladbach', 'club-tottenham':'Tottenham', 'club-wolves':'Wolves', 'club-psg':'PSG', 'club-real-sociedad':'Real Sociedad', 'club-atletico-madrid':'Atletico Madrid', 'club-athletic-bilbao':'Athletic Bilbao', 'club-eintracht-frankfurt':'Frankfurt', 'club-deportivo-la-coruna':'Deportivo', 'club-bayern':'Bayern München', 'club-dortmund':'Dortmund', 'club-leverkusen':'Leverkusen', 'club-union-berlin':'Union Berlin', 'club-brest':'Stade Brestois', 'club-lyon':'Olympique Lyon', 'club-marseille':'Marseille', 'club-strasbourg':'Strasbourg',
};
export function clubMemberTag(club: {id:string;name:string;shortName?:string}): string {
  const clean = (s:string) => s.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{C}\uFE0F]/gu,'').replace(/\s+/g,' ').trim();
  for (const value of [club.name,aliases[club.id],club.shortName]) {
    const text=clean(value || '');
    if (text && text.length <= 16) return text;
  }
  return '';
}
export function clubMemberTagsEnabled(): boolean {
  return process.env.DATABASE_PROVIDER === 'supabase' && process.env.SUPABASE_DATA_NAMESPACE === 'production' &&
    process.env.VERCEL_ENV === 'production' && process.env.MIGRATION_WRITE_FREEZE !== 'true' &&
    process.env.TELEGRAM_CLUB_TAGS_ENABLED !== 'false' && /^\d+:.+/.test(process.env.TELEGRAM_BOT_TOKEN || '') && /^@[A-Za-z0-9_]{5,32}$/.test(group());
}
type Summary = {state:string;checkedAt:string;updated:number;unchanged:number;skipped:number;remaining:number;reason?:string};
export async function clubMemberTagsStatus(): Promise<{enabled:boolean;lastRun?:Summary;taggedOwners?:number;skippedOwners?:number;skippedReasons?:Record<string,number>;pendingDiagnostics?:number}> {
  if (!clubMemberTagsEnabled()) return {enabled:false};
  const lastRun=await state().get<Summary>(statusKey());
  const rows=await getFirestoreDb().collection(records).where('scope','==',scope()).limit(501).get();
  const taggedOwners=rows.docs.filter(d=>d.data().managed===true && d.data().clubId && !d.data().reason).length;
  const skippedOwners=rows.docs.filter(d=>d.data().reason).length;
  const skippedReasons:Record<string,number>={};
  let pendingDiagnostics=0;
  for (const row of rows.docs) {
    const record=row.data();
    if (!record.reason) continue;
    skippedReasons[record.reason]=(skippedReasons[record.reason] || 0)+1;
    if (record.diagnosticVersion !== 2) pendingDiagnostics++;
  }
  return {enabled:true,taggedOwners,skippedOwners,skippedReasons,pendingDiagnostics,...(lastRun ? {lastRun} : {})};
}
class TelegramTagError extends Error {
  constructor(public code: number, public retryAfter = 0, public method = '', public detail = '') { super('TELEGRAM_TAG_API_FAILED'); }
}
async function telegram(method: string, body: Record<string,unknown>, signal: AbortSignal): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,
  });
  const data:any=await response.json();
  if (!response.ok || !data.ok) throw new TelegramTagError(Number(data.error_code || response.status),Number(data.parameters?.retry_after || 0),method,String(data.description || ''));
  return data.result;
}

/** Production-only desired-state reconciliation. No messages, promotions or
 * admin title edits. Cached snapshots never authorize club-owner identity. */
export async function reconcileClubMemberTags(): Promise<Summary|null> {
  if (!clubMemberTagsEnabled()) return null;
  const store=state(), key=scope(), now=Date.now();
  if (await store.get('club-tags:pause:'+key) || !await store.set('club-tags:lease:'+key,now,{nx:true,ex:60})) return null;
  const summary:Summary={state:'running',checkedAt:new Date(now).toISOString(),updated:0,unchanged:0,skipped:0,remaining:0};
  const signal=AbortSignal.timeout(42000);
  try {
    const botId=Number(process.env.TELEGRAM_BOT_TOKEN!.split(':')[0]);
    const self=await telegram('getChatMember',{chat_id:group(),user_id:botId},signal);
    if (self.status !== 'administrator' || self.can_manage_tags !== true) {
      summary.state='blocked';summary.reason='MANAGE_TAGS_REQUIRED';
      await store.set('club-tags:pause:'+key,true,{ex:300});
      return summary;
    }
    const db=getFirestoreDb();
    const seasons=await db.collection(COLLECTIONS.SEASONS).where('status','in',['active','ACTIVE']).limit(2).get();
    if (seasons.size !== 1) throw Error('ACTIVE_SEASON_UNAVAILABLE');
    const seasonId=seasons.docs[0].id;
    const occupancy=await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId','==',seasonId).limit(501).get();
    const previous=await db.collection(records).where('scope','==',key).limit(501).get();
    if (occupancy.size > 500 || previous.size > 500) throw Error('OWNER_LIST_INCOMPLETE');
    const owners=new Map<string,string[]>();
    for (const row of occupancy.docs) {
      const o=row.data();
      if (o.status !== 'active' || !o.userId || !clubs.has(o.clubId) || row.id !== `${seasonId}_${o.clubId}`) continue;
      owners.set(o.userId,[...new Set([...(owners.get(o.userId)||[]),o.clubId])]);
    }
    const prior=new Map(previous.docs.map(d=>[d.data().userId,{...d.data(),id:d.id}]));
    const ids=[...new Set([...owners.keys(),...prior.keys()])].sort();
    // Old/changed owners first; all others are rechecked after at most six hours.
    const eligible=ids.filter(id=> {
      const old:any=prior.get(id);
      return !old || old.seasonId !== seasonId || JSON.stringify([...(owners.get(id)||[])].sort()) !== old.ownershipKey || old.nextCheckAt <= now || Boolean(old.reason && old.diagnosticVersion !== 2);
    }).sort((a,b)=>Number((prior.get(a) as any)?.nextCheckAt || 0)-Number((prior.get(b) as any)?.nextCheckAt || 0));
    summary.remaining=eligible.length;
    for (const userId of eligible.slice(0,24)) {
      if (signal.aborted) break;
      const ref=db.collection(records).doc(createHash('sha256').update(key+':'+userId).digest('hex'));
      const old:any=prior.get(userId);
      const user=(await db.collection(COLLECTIONS.USERS).doc(userId).get()).data();
      const telegramId=Number(user?.telegramId || old?.telegramId);
      const current=await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId','==',seasonId).where('userId','==',userId).get();
      const owned=current.docs.filter(d=>d.data().status==='active' && d.id===`${seasonId}_${d.data().clubId}` && clubs.has(d.data().clubId)).map(d=>d.data().clubId);
      let clubId=owned.length===1 ? owned[0] : undefined;
      if (owned.length>1) {
        const membership=(await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`).get()).data();
        if (membership?.status==='active' && owned.includes(membership.clubId)) clubId=membership.clubId;
      }
      const desired=clubId ? clubMemberTag(clubs.get(clubId)!) : '';
      let reason='', appliedTag=old?.appliedTag || '', managed=old?.managed===true;
      if (!user && owned.length) reason='OWNER_ACCOUNT_MISSING';
      else if (!Number.isSafeInteger(telegramId) || telegramId<=0) reason='TELEGRAM_ID_MISSING';
      else if (user?.isSuspended) reason='ACCOUNT_SUSPENDED';
      else if (owned.length>1 && !clubId) reason='PRIMARY_CLUB_UNRESOLVED';
      else if (owned.length && !desired) reason='CLUB_TAG_UNAVAILABLE';
      else try {
        const member=await telegram('getChatMember',{chat_id:group(),user_id:telegramId},signal);
        if (['creator','administrator'].includes(member.status)) reason='GROUP_ADMIN';
        else if (member.status==='kicked') reason='BANNED_FROM_GROUP';
        else if (member.status==='left' || member.status==='restricted' && member.is_member !== true) reason='NOT_IN_GROUP';
        else if (member.user?.is_bot) reason='BOT_ACCOUNT';
        else if (!['member','restricted'].includes(member.status)) reason='UNKNOWN_MEMBER_STATUS';
        else if (!desired && (!managed || member.tag !== appliedTag)) { reason='MANUAL_TAG_PRESERVED';managed=false; }
        else if ((member.tag || '') === desired) { summary.unchanged++;appliedTag=desired;managed=Boolean(desired); }
        else {
          await telegram('setChatMemberTag',{chat_id:group(),user_id:telegramId,tag:desired},signal);
          appliedTag=desired;managed=Boolean(desired);summary.updated++;
        }
      } catch (error) {
        if (!(error instanceof TelegramTagError) || error.code !== 400) throw error;
        reason=error.method==='setChatMemberTag' ? 'TAG_REJECTED'
          : /user_not_participant|not a member|not.*participant/i.test(error.detail) ? 'NOT_IN_GROUP'
          : /user not found|user_id_invalid|participant_id_invalid/i.test(error.detail) ? 'TELEGRAM_USER_NOT_FOUND' : 'MEMBER_LOOKUP_FAILED';
      }
      if (reason) summary.skipped++;
      await ref.set({scope:key,userId,telegramId:Number.isSafeInteger(telegramId)?telegramId:null,seasonId,clubId:clubId||null,ownershipKey:JSON.stringify([...owned].sort()),appliedTag,managed,reason,diagnosticVersion:2,checkedAt:new Date().toISOString(),nextCheckAt:Date.now()+(reason?3600000:21600000)});
      summary.remaining--;
    }
    summary.state=summary.remaining ? 'pending' : 'synced';
  } catch(error:any) {
    summary.state='deferred';summary.reason=error instanceof TelegramTagError ? error.code===429 ? 'RATE_LIMITED' : error.code===403 ? 'TELEGRAM_PERMISSION_DENIED' : 'TELEGRAM_API_UNAVAILABLE' : 'OWNER_SYNC_UNAVAILABLE';
    await store.set('club-tags:pause:'+key,true,{ex:Math.max(60,Math.min(86400,Number(error?.retryAfter || 60)))});
  } finally {
    await store.set(statusKey(),summary);
  }
  return summary;
}
let nextScheduleAt=0;
export function scheduleClubMemberTags(): void {
  if (!clubMemberTagsEnabled() || Date.now()<nextScheduleAt) return;
  nextScheduleAt=Date.now()+60000;
  const work=reconcileClubMemberTags().catch(()=>{ console.warn('[CLUB_MEMBER_TAGS_DEFERRED]'); });
  if (process.env.VERCEL==='1') waitUntil(work); else void work;
}
