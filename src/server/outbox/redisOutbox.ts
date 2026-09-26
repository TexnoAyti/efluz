import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';

export type OutboxMutationStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface DurableOutboxMutation<T = any> {
  mutationId: string;
  operation: string;
  entityType: string;
  entityId: string;
  userId?: string;
  adminUserId?: string;
  seasonId: string;
  competitionId?: string;
  payload: T;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  nextRetryAt: number;
  lastError: string | null;
  status: OutboxMutationStatus;
}

export class DurablePersistenceUnavailableError extends Error {
  public readonly code = 'DURABLE_PERSISTENCE_UNAVAILABLE';
  public readonly statusCode = 503;
  public readonly status = 503;

  constructor(message = 'Durable persistence is temporarily unavailable. Mutation was not accepted; retry when service recovers.') {
    super(message);
    this.name = 'DurablePersistenceUnavailableError';
  }
}

export const OUTBOX_KEYS = {
  mutation: (mutationId: string) => `${KEY_PREFIX}:outbox:mutation:${mutationId}`,
  pending: () => `${KEY_PREFIX}:outbox:pending`,
  all: () => `${KEY_PREFIX}:outbox:all`,
};

export function isRedisOutboxConfigured(): boolean {
  return getUpstashClient() !== null;
}


const DEFAULT_CLAIM_LEASE_MS = 120_000;

/**
 * Atomically claims due Redis outbox mutations for one replay worker.
 * A claimed item is moved to SYNCING and leased for 120 seconds so a dead
 * worker can be recovered without duplicate concurrent replay.
 */
export async function claimDuePendingMutations(
  limit = 15,
  leaseMs = DEFAULT_CLAIM_LEASE_MS
): Promise<DurableOutboxMutation[]> {
  const client = getUpstashClient();
  if (!client) return [];

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const staleBeforeIso = new Date(now - leaseMs).toISOString();
  const leaseUntil = now + leaseMs;
  const mutationPrefix = `${KEY_PREFIX}:outbox:mutation:`;

  try {
    const raw = await client.eval<any>(`
      local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
      local claimed = {}
      for _, id in ipairs(ids) do
        local mutationKey = ARGV[6] .. id
        local encoded = redis.call('GET', mutationKey)
        if encoded then
          local ok, mut = pcall(cjson.decode, encoded)
          if ok and mut then
            local status = tostring(mut.status or 'PENDING')
            local updatedAt = tostring(mut.updatedAt or '')
            local canClaim = status == 'PENDING'
              or (status == 'SYNCING' and updatedAt ~= '' and updatedAt <= ARGV[4])
            if canClaim then
              mut.status = 'SYNCING'
              mut.updatedAt = ARGV[3]
              mut.nextRetryAt = tonumber(ARGV[5])
              local nextEncoded = cjson.encode(mut)
              redis.call('SET', mutationKey, nextEncoded)
              redis.call('ZADD', KEYS[1], ARGV[5], id)
              table.insert(claimed, nextEncoded)
            end
          end
        else
          redis.call('ZREM', KEYS[1], id)
        end
      end
      return cjson.encode(claimed)
    `, [OUTBOX_KEYS.pending()], [
      String(now),
      String(Math.max(1, Math.min(limit, 50))),
      nowIso,
      staleBeforeIso,
      String(leaseUntil),
      mutationPrefix,
    ]);

    const rows: any[] = typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
    return rows
      .map((row) => {
        if (typeof row === 'string') {
          try { return JSON.parse(row); } catch { return null; }
        }
        return row;
      })
      .filter(Boolean) as DurableOutboxMutation[];
  } catch (err: any) {
    console.warn('[DURABLE_OUTBOX] Atomic claim failed:', err?.message || err);
    return [];
  }
}

/**
 * Persists a complete replayable mutation to the durable Redis outbox.
 * Throws DurablePersistenceUnavailableError if Redis client is not available or write fails.
 */
export async function persistDurableMutation<T = any>(
  mutation: DurableOutboxMutation<T>
): Promise<void> {
  const client = getUpstashClient();
  if (!client) {
    throw new DurablePersistenceUnavailableError(
      'Durable Redis outbox is not configured. Local ephemeral storage cannot acknowledge mutations.'
    );
  }

  const mutationKey = OUTBOX_KEYS.mutation(mutation.mutationId);
  const pendingKey = OUTBOX_KEYS.pending();
  const allKey = OUTBOX_KEYS.all();

  try {
    const rawJson = JSON.stringify(mutation);
    await client.set(mutationKey, rawJson);
    if (mutation.status === 'PENDING' || mutation.status === 'SYNCING') {
      await client.zadd(pendingKey, { score: mutation.nextRetryAt, member: mutation.mutationId });
    }
    await client.sadd(allKey, mutation.mutationId);
    console.log(`[DURABLE_OUTBOX] Persisted mutation ${mutation.mutationId} (${mutation.operation}) to Redis`);
  } catch (err: any) {
    console.error(`[DURABLE_OUTBOX] Failed to persist mutation ${mutation.mutationId} to Redis:`, err?.message || err);
    throw new DurablePersistenceUnavailableError(
      `Failed to persist mutation to durable Redis outbox: ${err?.message || 'Upstash error'}`
    );
  }
}

/**
 * Retrieves a mutation record by ID from durable Redis outbox.
 */
export async function getDurableMutation<T = any>(
  mutationId: string
): Promise<DurableOutboxMutation<T> | null> {
  const client = getUpstashClient();
  if (!client) return null;

  try {
    const raw = await client.get<any>(OUTBOX_KEYS.mutation(mutationId));
    if (!raw) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw as DurableOutboxMutation<T>;
  } catch (err: any) {
    console.warn(`[DURABLE_OUTBOX] Failed to read mutation ${mutationId}:`, err?.message || err);
    return null;
  }
}

/**
 * Retrieves due pending mutations from durable Redis outbox.
 * Bounded by score <= now (prevents picking items that are in backoff cooldown)
 * and bounded by batch size limit.
 */
export async function getDuePendingMutations(limit = 25): Promise<DurableOutboxMutation[]> {
  const client = getUpstashClient();
  if (!client) return [];

  try {
    const now = Date.now();
    const members = await client.zrange<string[]>(
      OUTBOX_KEYS.pending(),
      0,
      now,
      { byScore: true, offset: 0, count: limit }
    );

    if (!members || members.length === 0) return [];

    const mutations: DurableOutboxMutation[] = [];
    for (const id of members) {
      const mut = await getDurableMutation(id);
      if (mut && mut.status !== 'SYNCED') {
        mutations.push(mut);
      }
    }

    // Sort FIFO by creation time
    return mutations.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } catch (err: any) {
    console.warn('[DURABLE_OUTBOX] Error retrieving due pending mutations:', err?.message || err);
    return [];
  }
}

/**
 * Marks mutation as SYNCING in Redis.
 */
export async function markMutationSyncing(mutationId: string): Promise<boolean> {
  const client = getUpstashClient();
  if (!client) return false;

  try {
    const mut = await getDurableMutation(mutationId);
    if (!mut || mut.status === 'SYNCED') return false;

    mut.status = 'SYNCING';
    mut.updatedAt = new Date().toISOString();
    await client.set(OUTBOX_KEYS.mutation(mutationId), JSON.stringify(mut));
    return true;
  } catch (err: any) {
    console.warn(`[DURABLE_OUTBOX] Failed to mark mutation ${mutationId} as SYNCING:`, err?.message || err);
    return false;
  }
}

/**
 * Marks mutation as SYNCED in Redis and removes from pending sorted set.
 * The durable record itself is preserved for audit trail.
 */
export async function markMutationSynced(mutationId: string): Promise<void> {
  const client = getUpstashClient();
  if (!client) return;

  try {
    const mut = await getDurableMutation(mutationId);
    if (mut) {
      mut.status = 'SYNCED';
      mut.lastError = null;
      mut.updatedAt = new Date().toISOString();
      await client.set(OUTBOX_KEYS.mutation(mutationId), JSON.stringify(mut));
    }
    await client.zrem(OUTBOX_KEYS.pending(), mutationId);
    console.log(`[DURABLE_OUTBOX] Mutation ${mutationId} marked SYNCED in Redis`);
  } catch (err: any) {
    console.warn(`[DURABLE_OUTBOX] Failed to mark mutation ${mutationId} as SYNCED:`, err?.message || err);
  }
}

/**
 * Marks mutation as retryable with exponential backoff on retryable error.
 */
export async function markMutationRetryable(mutationId: string, errorMessage: string): Promise<void> {
  const client = getUpstashClient();
  if (!client) return;

  try {
    const mut = await getDurableMutation(mutationId);
    if (!mut) return;

    const retryCount = (mut.retryCount || 0) + 1;
    // Exponential backoff: 3s, 6s, 12s, 24s, 48s, capped at 300s (5m)
    const backoffMs = Math.min(300000, 3000 * Math.pow(2, Math.min(retryCount, 6)));
    const nextRetryAt = Date.now() + backoffMs;

    mut.status = 'PENDING';
    mut.retryCount = retryCount;
    mut.nextRetryAt = nextRetryAt;
    mut.lastError = errorMessage;
    mut.updatedAt = new Date().toISOString();

    await client.set(OUTBOX_KEYS.mutation(mutationId), JSON.stringify(mut));
    await client.zadd(OUTBOX_KEYS.pending(), { score: nextRetryAt, member: mutationId });
    console.log(`[DURABLE_OUTBOX] Mutation ${mutationId} backed off (retry #${retryCount}, next at ${new Date(nextRetryAt).toISOString()})`);
  } catch (err: any) {
    console.warn(`[DURABLE_OUTBOX] Failed to set retryable on mutation ${mutationId}:`, err?.message || err);
  }
}

/**
 * Marks mutation as permanently FAILED on terminal non-retryable error.
 */
export async function markMutationFailed(mutationId: string, errorMessage: string): Promise<void> {
  const client = getUpstashClient();
  if (!client) return;

  try {
    const mut = await getDurableMutation(mutationId);
    if (mut) {
      mut.status = 'FAILED';
      mut.lastError = errorMessage;
      mut.updatedAt = new Date().toISOString();
      await client.set(OUTBOX_KEYS.mutation(mutationId), JSON.stringify(mut));
    }
    await client.zrem(OUTBOX_KEYS.pending(), mutationId);
    console.error(`[DURABLE_OUTBOX] Mutation ${mutationId} marked permanently FAILED:`, errorMessage);
  } catch (err: any) {
    console.warn(`[DURABLE_OUTBOX] Failed to mark mutation ${mutationId} as FAILED:`, err?.message || err);
  }
}

/**
 * Returns summary stats of durable Redis outbox.
 */
export async function getDurableOutboxStats(): Promise<{
  total: number;
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
}> {
  const client = getUpstashClient();
  if (!client) {
    return { total: 0, pending: 0, syncing: 0, synced: 0, failed: 0 };
  }

  try {
    const members = await client.smembers<string[]>(OUTBOX_KEYS.all());
    if (!members || members.length === 0) {
      return { total: 0, pending: 0, syncing: 0, synced: 0, failed: 0 };
    }

    let pending = 0;
    let syncing = 0;
    let synced = 0;
    let failed = 0;

    for (const id of members) {
      const mut = await getDurableMutation(id);
      if (!mut) continue;
      if (mut.status === 'PENDING') pending++;
      else if (mut.status === 'SYNCING') syncing++;
      else if (mut.status === 'SYNCED') synced++;
      else if (mut.status === 'FAILED') failed++;
    }

    return {
      total: members.length,
      pending,
      syncing,
      synced,
      failed,
    };
  } catch (err: any) {
    console.warn('[DURABLE_OUTBOX] Failed to get stats:', err?.message || err);
    return { total: 0, pending: 0, syncing: 0, synced: 0, failed: 0 };
  }
}
