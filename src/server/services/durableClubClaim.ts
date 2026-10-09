import { randomUUID } from 'node:crypto';
import { getUpstashClient, KEY_PREFIX, ReadModelKeys, redisGetFresh, redisGetLkg, type OwnerNeutralClub } from '../readModel/readModelStore';
import { OUTBOX_KEYS, getDurableMutation, DurablePersistenceUnavailableError, type DurableOutboxMutation } from '../outbox/redisOutbox';
import { admissionStatus, assertClubAdmissionOpen } from './clubAdmission';
import { ClubConflictError, ClubNotFoundError } from '../firebase/firestoreStore';

export const CLUB_CLAIM_KEYS = {
  user: (season: string, user: string) => `${KEY_PREFIX}:club-claim:${season}:user:${user}`,
  club: (season: string, club: string) => `${KEY_PREFIX}:club-claim:${season}:club:${club}`,
  latest: (season: string, user: string) => `${KEY_PREFIX}:club-claim:${season}:latest:${user}`,
};
export type ClubClaimReceipt = { id: string; clubId: string; clubName: string; status: 'PENDING'|'SYNCING'|'SYNCED'|'FAILED'; pendingSync: boolean; createdAt: string; message: string };
export const CLUB_CLAIM_RESERVE_LUA = `
-- EFL_CLUB_CLAIM_RESERVE_V1: exclusive intent + replay record published together.
for i=1,4 do local t=redis.call('TYPE',KEYS[i]).ok; if t~='none' and t~='string' then return redis.error_reply('CLAIM_KEY_TYPE_INVALID') end end
local pt=redis.call('TYPE',KEYS[5]).ok; local at=redis.call('TYPE',KEYS[6]).ok
if pt~='none' and pt~='zset' or at~='none' and at~='set' then return redis.error_reply('CLAIM_OUTBOX_TYPE_INVALID') end
local proposed=cjson.decode(ARGV[1])
local function active(key)
  local id=redis.call('GET',key)
  if not id then return nil end
  local raw=redis.call('GET',ARGV[4]..id)
  if not raw then return {id=id,state='UNKNOWN'} end
  local p=cjson.decode(raw)
  if p.status=='PENDING' or p.status=='SYNCING' then return {id=id,record=p} end
  return nil
end
local user=active(KEYS[1]); local club=active(KEYS[2])
if user then
  if user.record and user.record.entityId==proposed.entityId then return {'EXISTING',user.id} end
  return {'USER_PENDING',user.id}
end
if club then return {'CLUB_PENDING',club.id} end
if redis.call('EXISTS',KEYS[4])==1 then return redis.error_reply('CLAIM_ID_COLLISION') end
redis.call('SET',KEYS[4],ARGV[1])
redis.call('SET',KEYS[1],ARGV[3]); redis.call('SET',KEYS[2],ARGV[3]); redis.call('SET',KEYS[3],ARGV[3])
redis.call('ZADD',KEYS[5],ARGV[2],ARGV[3]); redis.call('SADD',KEYS[6],ARGV[3])
return {'ACCEPTED',ARGV[3]}
`;
function receipt(record: DurableOutboxMutation<any>): ClubClaimReceipt {
  const pendingSync = ['PENDING','SYNCING'].includes(record.status);
  const error = String(record.lastError || '');
  return { id: record.mutationId, clubId: record.entityId, clubName: record.payload.clubName || record.entityId, status: record.status, pendingSync, createdAt: record.createdAt,
    message: pendingSync ? 'Klub tanlash so‘rovi saqlandi. Tasdiqlash kutilmoqda; yakuniy egalik hali biriktirilmagan.' : record.status === 'SYNCED' ? 'Klub sizga biriktirildi.' : /CLUB_OCCUPIED|already been selected/.test(error) ? 'Klub boshqa foydalanuvchiga tegishli. Boshqa klubni tanlang.' : /CLUB_ADMISSION|qabul/.test(error) ? 'Klub qabuli yopilgan. So‘rov bajarilmadi.' : /SUSPENDED|AUTHORIZATION/.test(error) ? 'Hisob ruxsati o‘zgargan. So‘rov bajarilmadi.' : 'Klub tanlash so‘rovi bajarilmadi. Holatni yangilang yoki administratorga murojaat qiling.' };
}
export async function getClubClaimReceipt(userId: string, seasonId: string): Promise<ClubClaimReceipt|null> {
  // Cutover excluded the old Redis outbox; online PostgreSQL claims commit directly.
  if (process.env.DATABASE_PROVIDER === 'supabase') return null;
  const client = getUpstashClient();
  if (!client) throw new DurablePersistenceUnavailableError();
  const id = await client.get<string>(CLUB_CLAIM_KEYS.latest(seasonId,userId));
  if (!id) return null;
  const record = await getDurableMutation(id);
  if (!record || record.userId !== userId || record.seasonId !== seasonId || record.entityType !== 'CLUB_CLAIM') throw new DurablePersistenceUnavailableError('Klub so‘rovi holatini o‘qib bo‘lmadi.');
  return receipt(record);
}
/** Accepts a durable request, never fabricates confirmed ownership from a stale snapshot. */
export type ClaimActorProfile = { id: string; telegramId: string; username?: string; firstName?: string; lastName?: string };
export async function requestDurableClubClaim(userId: string, clubId: string, seasonId: string, actor?: ClaimActorProfile) {
  const verifiedProfile = actor && actor.id === userId && /^\d{1,20}$/.test(String(actor.telegramId)) && userId === `user-${actor.telegramId}` ? { id:userId, telegramId:String(actor.telegramId), username:String(actor.username || '').slice(0,64), firstName:String(actor.firstName || '').slice(0,100), lastName:String(actor.lastName || '').slice(0,100) } : undefined;
  const client = getUpstashClient();
  if (!client) throw new DurablePersistenceUnavailableError('Klub tanlash so‘rovi saqlanmadi: doimiy saqlash xizmati ulanmagan.');
  const last = await getClubClaimReceipt(userId,seasonId);
  if (last?.pendingSync && last.clubId === clubId) return { request: last, club: { id:clubId, name:last.clubName }, pendingSync:true };
  if (last?.pendingSync) throw new ClubConflictError('Avvalgi klub tanlash so‘rovingiz hali tasdiqlanmagan.', 'CLUB_CLAIM_PENDING');
  const snapshot = await redisGetFresh<OwnerNeutralClub[]>(ReadModelKeys.clubsWithOwners(seasonId)) || await redisGetLkg<OwnerNeutralClub[]>(ReadModelKeys.clubsWithOwners(seasonId));
  if (!Array.isArray(snapshot?.data) || snapshot.data.length !== 96) throw new DurablePersistenceUnavailableError('Klublar ma’lumoti to‘liq saqlanmagan. Tanlash so‘rovi qabul qilinmadi.');
  const club = snapshot.data.find(c=>c.id === clubId);
  if (!club || club.active === false) throw new ClubNotFoundError('Klub bu mavsumda topilmadi.');
  if (club.ownerUserId && club.ownerUserId !== userId || !club.ownerUserId && (club.isTaken || club.isOccupied)) throw new ClubConflictError('Bu klub boshqa foydalanuvchiga tegishli.', 'CLUB_OCCUPIED');
  const admission = await redisGetFresh<any>(ReadModelKeys.clubAdmission(seasonId)) || await redisGetLkg<any>(ReadModelKeys.clubAdmission(seasonId));
  if (!admission?.data) throw new DurablePersistenceUnavailableError('Klub qabuli holati saqlanmagan. Qayta urinib ko‘ring.');
  assertClubAdmissionOpen(admissionStatus(seasonId,admission.data),club.leagueId);
  const now = new Date().toISOString(), id='cc-'+randomUUID();
  const mutation: DurableOutboxMutation = { mutationId:id, revision:randomUUID(), entityType:'CLUB_CLAIM', entityId:clubId, operation:'claim', userId, seasonId, payload:{userId,clubId,seasonId,clubName:club.name,requiresActiveUser:true,...(verifiedProfile ? {verifiedProfile} : {})}, createdAt:now,updatedAt:now,retryCount:0,nextRetryAt:Date.now(),lastError:null,status:'PENDING' };
  let result: any;
  try { result = await client.eval(CLUB_CLAIM_RESERVE_LUA, [CLUB_CLAIM_KEYS.user(seasonId,userId),CLUB_CLAIM_KEYS.club(seasonId,clubId),CLUB_CLAIM_KEYS.latest(seasonId,userId),OUTBOX_KEYS.mutation(id),OUTBOX_KEYS.pending(),OUTBOX_KEYS.all()], [JSON.stringify(mutation),mutation.nextRetryAt,id,`${KEY_PREFIX}:outbox:mutation:`]); }
  catch { throw new DurablePersistenceUnavailableError('So‘rov saqlanganligini tasdiqlab bo‘lmadi. Holatni tekshirib, qayta urinib ko‘ring.'); }
  if (result?.[0] === 'USER_PENDING') throw new ClubConflictError('Avvalgi klub so‘rovingiz tasdiqlanishini kuting.', 'CLUB_CLAIM_PENDING');
  if (result?.[0] === 'CLUB_PENDING') throw new ClubConflictError('Bu klub uchun boshqa foydalanuvchining tanlash so‘rovi kutilmoqda.', 'CLUB_CLAIM_RESERVED');
  if (result?.[0] === 'EXISTING') {
    const existing=await getClubClaimReceipt(userId,seasonId); if(!existing) throw new DurablePersistenceUnavailableError();
    return {request:existing,club,pendingSync:existing.pendingSync};
  }
  if (result?.[0] !== 'ACCEPTED') throw new DurablePersistenceUnavailableError();
  return {request:receipt(mutation),club:{id:club.id,name:club.name},pendingSync:true};
}
