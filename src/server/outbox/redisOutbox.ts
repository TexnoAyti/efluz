import { randomUUID } from 'node:crypto';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';

export type OutboxMutationStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface DurableOutboxMutation<T = any> {
  mutationId: string;
  revision?: string;
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
    mutation.revision = randomUUID();
    const rawJson = JSON.stringify(mutation);
    await client.eval(`
      -- EFL_OUTBOX_PERSIST_V1: validate all key types before publishing.
      local recordType = redis.call('TYPE', KEYS[1]).ok
      local pendingType = redis.call('TYPE', KEYS[2]).ok
      local allType = redis.call('TYPE', KEYS[3]).ok
      if recordType ~= 'none' and recordType ~= 'string' then return redis.error_reply('OUTBOX_RECORD_TYPE_INVALID') end
      if pendingType ~= 'none' and pendingType ~= 'zset' then return redis.error_reply('OUTBOX_PENDING_TYPE_INVALID') end
      if allType ~= 'none' and allType ~= 'set' then return redis.error_reply('OUTBOX_ALL_TYPE_INVALID') end
      redis.call('SET', KEYS[1], ARGV[1])
      if ARGV[4] == 'PENDING' or ARGV[4] == 'SYNCING' then
        redis.call('ZADD', KEYS[2], ARGV[2], ARGV[3])
      else redis.call('ZREM', KEYS[2], ARGV[3]) end
      redis.call('SADD', KEYS[3], ARGV[3])
      return 1
    `, [mutationKey, pendingKey, allKey], [rawJson, mutation.nextRetryAt, mutation.mutationId, mutation.status]);
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
      if (mut && (mut.status === 'PENDING' || mut.status === 'SYNCING')) {
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

/** Change receipt + pending index atomically, and never acknowledge an older
 * revision over a newly accepted edit with the same logical mutation ID. */
async function transitionMutation(mut: DurableOutboxMutation, expectedRevision: string): Promise<boolean> {
  const client = getUpstashClient();
  if (!client) return false;
  return Number(await client.eval(`
    -- EFL_OUTBOX_TRANSITION_V1
    local raw = redis.call('GET', KEYS[1])
    if not raw then return 0 end
    local current = cjson.decode(raw)
    if (current.revision or '') ~= ARGV[2] then return 0 end
    local pendingType = redis.call('TYPE', KEYS[2]).ok
    if pendingType ~= 'none' and pendingType ~= 'zset' then return redis.error_reply('OUTBOX_PENDING_TYPE_INVALID') end
    redis.call('SET', KEYS[1], ARGV[1])
    if ARGV[4] == 'SYNCED' or ARGV[4] == 'FAILED' then
      redis.call('ZREM', KEYS[2], ARGV[3])
    else redis.call('ZADD', KEYS[2], ARGV[5], ARGV[3]) end
    return 1
  `, [OUTBOX_KEYS.mutation(mut.mutationId), OUTBOX_KEYS.pending()],
  [JSON.stringify(mut), expectedRevision, mut.mutationId, mut.status, mut.nextRetryAt])) === 1;
}

async function matchingMutation(id: string, expectedRevision?: string): Promise<DurableOutboxMutation | null> {
  const mut = await getDurableMutation(id);
  if (!mut || (expectedRevision !== undefined && (mut.revision || '') !== expectedRevision)) return null;
  return mut;
}

export async function markMutationSyncing(mutationId: string, expectedRevision?: string): Promise<boolean> {
  try {
    const mut = await matchingMutation(mutationId, expectedRevision);
    if (!mut || (mut.status !== 'PENDING' && mut.status !== 'SYNCING')) return false;
    mut.status = 'SYNCING';
    mut.updatedAt = new Date().toISOString();
    return await transitionMutation(mut, mut.revision || '');
  } catch (err: any) { console.warn('[DURABLE_OUTBOX] Sync receipt deferred:', err?.message); return false; }
}

export async function markMutationSynced(mutationId: string, expectedRevision?: string): Promise<boolean> {
  try {
    const mut = await matchingMutation(mutationId, expectedRevision);
    if (!mut) return false;
    mut.status = 'SYNCED'; mut.lastError = null; mut.updatedAt = new Date().toISOString();
    return await transitionMutation(mut, mut.revision || '');
  } catch (err: any) { console.warn('[DURABLE_OUTBOX] Completion receipt deferred:', err?.message); return false; }
}

export async function markMutationRetryable(mutationId: string, errorMessage: string, expectedRevision?: string): Promise<boolean> {
  try {
    const mut = await matchingMutation(mutationId, expectedRevision);
    if (!mut) return false;
    const retryCount = (mut.retryCount || 0) + 1;
    const backoffMs = Math.min(300000, 3000 * Math.pow(2, Math.min(retryCount, 6)));
    mut.status = 'PENDING'; mut.retryCount = retryCount; mut.nextRetryAt = Date.now() + backoffMs;
    mut.lastError = errorMessage; mut.updatedAt = new Date().toISOString();
    return await transitionMutation(mut, mut.revision || '');
  } catch (err: any) { console.warn('[DURABLE_OUTBOX] Retry receipt deferred:', err?.message); return false; }
}

export async function markMutationFailed(mutationId: string, errorMessage: string, expectedRevision?: string): Promise<boolean> {
  try {
    const mut = await matchingMutation(mutationId, expectedRevision);
    if (!mut) return false;
    mut.status = 'FAILED'; mut.lastError = errorMessage; mut.updatedAt = new Date().toISOString();
    return await transitionMutation(mut, mut.revision || '');
  } catch (err: any) { console.warn('[DURABLE_OUTBOX] Failure receipt deferred:', err?.message); return false; }
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
