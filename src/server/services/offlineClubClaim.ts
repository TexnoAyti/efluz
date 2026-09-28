import { getUpstashClient, getLkgKey, KEY_PREFIX, ReadModelKeys } from '../readModel/readModelStore';
import { OUTBOX_KEYS, DurablePersistenceUnavailableError, getDurableMutation, type DurableOutboxMutation } from '../outbox/redisOutbox';

const reservationKeys = (seasonId: string, userId: string, clubId: string) => ({
  user: `${KEY_PREFIX}:claim-pending:${seasonId}:user:${userId}`,
  club: `${KEY_PREFIX}:claim-pending:${seasonId}:club:${clubId}`,
});

export async function getPendingClubClaim(userId: string, seasonId: string) {
  const client = getUpstashClient();
  if (!client) return null;
  const key = reservationKeys(seasonId, userId, '').user;
  const clubId = await client.get<string>(key);
  if (!clubId) return null;
  const mutation = await getDurableMutation(`claim_${seasonId}_${clubId}_${userId}`);
  return { clubId, status: mutation?.status || 'PENDING', lastError: mutation?.lastError || null };
}

export async function assertNoOtherPendingClubClaim(userId: string, clubId: string, seasonId: string) {
  const client = getUpstashClient();
  if (!client) return;
  const keys = reservationKeys(seasonId, userId, clubId);
  let reservedUser: string | null;
  let reservedClub: string | null;
  try {
    [reservedUser, reservedClub] = await Promise.all([client.get<string>(keys.user), client.get<string>(keys.club)]);
  } catch {
    throw new DurablePersistenceUnavailableError('Klub bandligini tekshirib bo‘lmadi. Keyinroq qayta urinib ko‘ring.');
  }
  if (reservedUser && reservedUser !== clubId || reservedClub && reservedClub !== userId) {
    const error = new Error('Klub bo‘yicha boshqa so‘rov tasdiqlanishini kutmoqda.');
    Object.assign(error, { code: 'CLUB_CLAIM_PENDING', statusCode: 409 });
    throw error;
  }
}

/** A pending request is durable, but never represents confirmed ownership. */
export async function queueOfflineClubClaim(userId: string, clubId: string, seasonId: string) {
  const client = getUpstashClient();
  if (!client) throw new DurablePersistenceUnavailableError();
  const now = new Date().toISOString();
  const mutationId = `claim_${seasonId}_${clubId}_${userId}`;
  const mutation: DurableOutboxMutation = {
    mutationId, operation: 'CLAIM_CLUB', entityType: 'CLUB_CLAIM', entityId: clubId,
    userId, seasonId, payload: { clubId, userId, seasonId, claimedAt: now },
    createdAt: now, updatedAt: now, retryCount: 0, nextRetryAt: Date.now(),
    lastError: null, status: 'PENDING',
  };
  const keys = reservationKeys(seasonId, userId, clubId);
  try {
    const result = Number(await client.eval(`
      -- reserve-offline-club-claim
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 3 end
      local ok, snapshot = pcall(cjson.decode, raw)
      if not ok or tonumber(snapshot.actualCount or 0) < 96 then return 3 end
      local found = false
      for _, row in ipairs(snapshot.data or {}) do
        if row.id == ARGV[1] then
          found = true
          if row.isOccupied or row.isTaken or row.ownerUserId or row.claimedByUserId then return 1 end
        end
        if row.ownerUserId == ARGV[2] or row.claimedByUserId == ARGV[2] then return 2 end
      end
      if not found then return 3 end
      local reservedClub = redis.call('GET', KEYS[2])
      local reservedUser = redis.call('GET', KEYS[3])
      if reservedClub and reservedClub ~= ARGV[2] then return 1 end
      if reservedUser and reservedUser ~= ARGV[1] then return 2 end
      if reservedClub and reservedUser then return 4 end
      redis.call('SET', KEYS[2], ARGV[2])
      redis.call('SET', KEYS[3], ARGV[1])
      redis.call('SET', KEYS[4], ARGV[3])
      redis.call('ZADD', KEYS[5], ARGV[4], ARGV[5])
      redis.call('SADD', KEYS[6], ARGV[5])
      return 0
    `, [getLkgKey(ReadModelKeys.clubsWithOwners(seasonId)), keys.club, keys.user,
      OUTBOX_KEYS.mutation(mutationId), OUTBOX_KEYS.pending(), OUTBOX_KEYS.all()],
    [clubId, userId, JSON.stringify(mutation), mutation.nextRetryAt, mutationId]));
    if (result === 1) return { accepted: false as const, code: 'CLUB_OCCUPIED' };
    if (result === 2) return { accepted: false as const, code: 'CLUB_SELECTION_LOCKED' };
    if (result === 3) return { accepted: false as const, code: 'READ_MODEL_NOT_WARMED' };
    if (result !== 0 && result !== 4) throw new Error(`Unknown reservation result: ${result}`);
    return { accepted: true as const, clubId, mutationId, pending: true as const };
  } catch (error) {
    if (error instanceof DurablePersistenceUnavailableError) throw error;
    throw new DurablePersistenceUnavailableError('Klub so‘rovi doimiy xotiraga saqlanmadi. Keyinroq qayta urinib ko‘ring.');
  }
}

export async function clearOfflineClubClaim(userId: string, clubId: string, seasonId: string) {
  const client = getUpstashClient();
  if (!client) return;
  const keys = reservationKeys(seasonId, userId, clubId);
  await client.eval(`
    -- clear-offline-club-claim
    if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
    if redis.call('GET', KEYS[2]) == ARGV[2] then redis.call('DEL', KEYS[2]) end
  `, [keys.user, keys.club], [clubId, userId]);
}
