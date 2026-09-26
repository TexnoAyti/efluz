import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS, FirestoreClubDoc, FirestoreUserDoc } from '../firebase/collections';
import { sendTelegramMessage } from './telegramBotService';
import { createAuditLog } from './adminService';
import {
  redisGetRaw,
  redisSetRaw,
  getUpstashClient,
  memoryRedisStorage,
  KEY_PREFIX,
  SCHEMA_VERSION,
} from '../readModel/readModelStore';
import { SEED_CLUBS, SEED_LEAGUES } from '../db/seed';
import { queryAll, queryGet } from '../db';
import crypto from 'crypto';
import { waitUntil, getDeadline } from '@vercel/functions';

export interface RecipientDirectoryEntry {
  userId: string;
  username: string;
  displayName: string;
  telegramId: string | number | null; // PRIVATE: Never exposed in API responses!
  clubId?: string;
  clubName?: string;
  leagueId?: string;
  leagueName?: string;
  messageable: boolean;
  updatedAt: string;
}

export interface PublicRecipientView {
  userId: string;
  username: string;
  displayName: string;
  clubId?: string;
  clubName?: string;
  leagueId?: string;
  leagueName?: string;
  hasTelegram: boolean;
  messageable: boolean;
  // NOTE: telegramId is STRICTLY OMITTED to prevent exposing numeric IDs!
}

export interface BroadcastRecipientStatus {
  userId: string;
  username: string;
  displayName: string;
  clubName?: string;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED_NO_TELEGRAM';
  sentAt?: string;
  error?: string;
  retryCount: number;
}

export interface TelegramBroadcastRecord {
  id: string;
  seasonId: string;
  title: string;
  body: string;
  type: 'NEW_MATCHDAY' | 'UPCOMING_MATCH' | 'COMPETITION_UPDATE' | 'CUSTOM_ALERT';
  targetAudience: 'ALL_USERS' | 'CLUB_OWNERS' | 'LEAGUE_OWNERS' | 'SELECTED_RECIPIENTS';
  targetLeagueId?: string;
  createdById: string;
  createdByUsername: string;
  createdAt: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'PARTIALLY_FAILED';
  metrics: {
    totalRecipients: number;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
  };
  recipients: BroadcastRecipientStatus[];
}

export interface NotificationQueueJob {
  jobId: string;
  broadcastId: string;
  userId: string;
  username: string;
  displayName: string;
  telegramId?: string | number; // PRIVATE
  title: string;
  body: string;
  type: string;
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED' | 'SKIPPED_NO_TELEGRAM';
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  availableAt?: number;
  sentAt?: string;
  error?: string;
  bodyIsHtml?: boolean;
  replyMarkup?: any;
}

const BROADCASTS_KEY = `${KEY_PREFIX}:telegram:broadcasts`;
const QUEUE_KEY = `${KEY_PREFIX}:telegram:queue`;
const PROCESSING_KEY = `${KEY_PREFIX}:telegram:processing`;
const WORKER_LOCK = `${KEY_PREFIX}:telegram:worker-lock`;
const RECIPIENT_DIR_KEY = `${KEY_PREFIX}:private:recipient-directory`;

// In-memory memory fallback stores
const memoryBroadcasts = new Map<string, TelegramBroadcastRecord>();
const memoryJobQueue: NotificationQueueJob[] = [];
const memoryRecipientDirectory = new Map<string, RecipientDirectoryEntry>();
let memoryRecipientSeason = '';

const MAX_CONTINUATION_HOPS = 256;
const DRAIN_BUDGET_MS = 45000;

/** Inspect only the existing Redis queue; no recipient/Firestore refresh. */
async function pendingQueueState(): Promise<{ pending: number; nextAt: number }> {
  const client = getUpstashClient();
  if (!client) throw new Error('REDIS_REQUIRED');
  return client.eval(`
    local jobs = redis.call('LRANGE', KEYS[1], 0, -1)
    local nextAt = 0
    for _, raw in ipairs(jobs) do
      local job = cjson.decode(raw)
      local at = tonumber(job.availableAt or 0)
      if nextAt == 0 or at < nextAt then nextAt = at end
      if at == 0 then break end
    end
    return cjson.encode({pending=#jobs, nextAt=nextAt})
  `, [QUEUE_KEY], []);
}

/** Bounded batches share the invocation lifetime; a new invocation takes over
 * before its deadline. The hop cap prevents an endlessly failing self-loop.
 */
export async function drainNotificationQueue(options: {
  deadline?: number;
  hop?: number;
  continueDrain?: (hop: number) => Promise<void>;
} = {}): Promise<void> {
  const hop = options.hop || 0;
  const deadline = Math.min(options.deadline ?? Date.now() + DRAIN_BUDGET_MS,
    (getDeadline()?.getTime() ?? Infinity) - 15000);
  while (Date.now() + 12000 < deadline) {
    const result = await processNotificationQueue(25, deadline - 12000);
    // The active lock owner is responsible for continuation.
    if (result.locked) return;
    const state = await pendingQueueState();
    if (!state.pending) return;
    const delay = Math.max(0, state.nextAt - Date.now());
    if (Date.now() + delay + 12000 >= deadline) {
      const wait = Math.max(0, deadline - Date.now() - 12000);
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      break;
    }
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  }
  if (!(await pendingQueueState()).pending) return;
  if (hop >= MAX_CONTINUATION_HOPS) {
    console.warn('[NOTIF_QUEUE] Continuation cap reached; pending jobs preserved for recovery');
    return;
  }
  await (options.continueDrain || triggerNotificationContinuation)(hop + 1);
}

export async function triggerNotificationContinuation(hop: number): Promise<void> {
  if (process.env.VERCEL === '1') {
    // Use only Vercel-provided project/deployment hosts, never a request Host.
    // Production uses the public production domain; protected previews may need
    // VERCEL_AUTOMATION_BYPASS_SECRET for authenticated self-invocation.
    const host = process.env.VERCEL_ENV === 'production'
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL
      : process.env.VERCEL_URL;
    const secret = process.env.CRON_SECRET;
    if (!host || !/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(host) || !secret) throw new Error('NOTIFICATION_CONTINUATION_CONFIG_REQUIRED');
    const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const response = await fetch(`https://${host}/api/internal/telegram-worker?hop=${hop}`, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`NOTIFICATION_CONTINUATION_REJECTED_${response.status}`);
    return;
  }
  // Long-lived Cloud Run/local worker: yield before starting the next slice.
  await new Promise(resolve => setTimeout(resolve, 25));
  await drainNotificationQueue({ hop });
}

export function scheduleNotificationQueueDrain(hop = 0): void {
  if (process.env.VERCEL !== '1' && !process.env.K_SERVICE) return;
  const work = drainNotificationQueue({ hop }).catch(error => {
    console.warn('[NOTIF_QUEUE] Drain interrupted; durable jobs retained for recovery:', error?.message || error);
  });
  if (process.env.VERCEL === '1') waitUntil(work);
  else void work;
}

/**
 * Rebuilds and populates the Private Redis Recipient Directory.
 * STRICT PRIVACY RULE: Contains telegramId for bot delivery, but NEVER exposed in public APIs!
 */
export async function syncRecipientDirectory(seasonId = 'season-2026-27'): Promise<number> {
  const dirMap = new Map<string, RecipientDirectoryEntry>();
  const now = new Date().toISOString();

  try {
    const db = getFirestoreDb();
    const [usersSnap, occSnap] = await Promise.all([
      db.collection(COLLECTIONS.USERS).limit(1001).get(),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId', '==', seasonId).get(),
    ]);
    if (usersSnap.size > 1000) throw new Error('RECIPIENT_DIRECTORY_TOO_LARGE');

    const occupancyMap = new Map<string, { clubId: string; claimedAt: string }>();
    for (const doc of occSnap.docs) {
      const data = doc.data();
      if (data.userId && data.clubId && !['released', 'inactive'].includes(data.status)) {
        occupancyMap.set(data.userId, { clubId: data.clubId, claimedAt: data.claimedAt });
      }
    }

    const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
    const leaguesMap = new Map(SEED_LEAGUES.map((l) => [l.id, l]));

    for (const doc of usersSnap.docs) {
      const u = { ...doc.data(), id: doc.id } as FirestoreUserDoc;
      const occ = occupancyMap.get(u.id);
      const club = occ ? clubsMap.get(occ.clubId) : undefined;
      const league = club ? leaguesMap.get(club.leagueId) : undefined;

      const hasTelegram = Boolean(u.telegramId && String(u.telegramId).trim().length > 0);

      const entry: RecipientDirectoryEntry = {
        userId: u.id,
        username: u.username || `player_${u.id.substring(0, 6)}`,
        displayName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'EFL Player',
        telegramId: u.telegramId || null,
        clubId: club?.id,
        clubName: club?.name,
        leagueId: league?.id,
        leagueName: league?.name,
        messageable: hasTelegram && !u.isSuspended,
        updatedAt: now,
      };

      dirMap.set(u.id, entry);
    }
  } catch (error) {
    // Never replace the directory with an incomplete SQLite fallback during quota exhaustion.
    throw new Error('RECIPIENT_DIRECTORY_UNAVAILABLE: existing directory preserved');
  }

  // Persist into private Redis directory
  const entriesArray = Array.from(dirMap.values());
  const client = getUpstashClient();
  if (client) {
    await client.set(`${RECIPIENT_DIR_KEY}:${seasonId}`, entriesArray);
  }
  memoryRecipientDirectory.clear();
  for (const entry of entriesArray) memoryRecipientDirectory.set(entry.userId, entry);
  memoryRecipientSeason = seasonId;

  return entriesArray.length;
}

/**
 * Returns safe recipient list for the Admin Panel UI.
 * STRICT DATA SAFETY RULE: Never expose Telegram numeric IDs in UI or API responses!
 */
export async function getSafeEligibleRecipients(
  filter?: { audience?: string; leagueId?: string },
  seasonId = 'season-2026-27'
): Promise<PublicRecipientView[]> {
  if (memoryRecipientSeason !== seasonId) memoryRecipientDirectory.clear();
  const client = getUpstashClient();
  let entries: RecipientDirectoryEntry[] = [];

  if (client) {
    try {
      const cached = await client.get<RecipientDirectoryEntry[]>(`${RECIPIENT_DIR_KEY}:${seasonId}`);
      if (Array.isArray(cached) && cached.length > 0) {
        entries = cached;
        memoryRecipientDirectory.clear();
        for (const entry of cached) memoryRecipientDirectory.set(entry.userId, entry);
        memoryRecipientSeason = seasonId;
      }
    } catch {}
  }

  if (entries.length === 0) {
    if (memoryRecipientDirectory.size === 0) await syncRecipientDirectory(seasonId);
    entries = Array.from(memoryRecipientDirectory.values());
  }

  // Apply audience filters
  let filtered = entries;
  if (filter?.audience === 'CLUB_OWNERS') {
    filtered = filtered.filter((r) => Boolean(r.clubId));
  } else if (filter?.audience === 'LEAGUE_OWNERS' && filter.leagueId) {
    filtered = filtered.filter((r) => r.leagueId === filter.leagueId && Boolean(r.clubId));
  }

  // Sanitize: strip telegramId completely!
  return filtered.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    clubId: r.clubId,
    clubName: r.clubName,
    leagueId: r.leagueId,
    leagueName: r.leagueName,
    hasTelegram: Boolean(r.telegramId),
    messageable: r.messageable,
  }));
}

/**
 * Creates and enqueues a new Telegram notification broadcast with durable Redis queueing.
 */
export async function enqueueTelegramBroadcast(params: {
  adminUserId: string;
  adminUsername: string;
  title: string;
  body: string;
  type: 'NEW_MATCHDAY' | 'UPCOMING_MATCH' | 'COMPETITION_UPDATE' | 'CUSTOM_ALERT';
  targetAudience: 'ALL_USERS' | 'CLUB_OWNERS' | 'LEAGUE_OWNERS' | 'SELECTED_RECIPIENTS';
  targetLeagueId?: string;
  selectedUserIds?: string[];
  seasonId?: string;
  requestId?: string;
}): Promise<TelegramBroadcastRecord> {
  const seasonId = params.seasonId || 'season-2026-27';
  const durableClient = getUpstashClient();
  if (!durableClient) throw new Error('REDIS_REQUIRED: durable notification storage is unavailable');
  if (!['ALL_USERS', 'CLUB_OWNERS', 'LEAGUE_OWNERS', 'SELECTED_RECIPIENTS'].includes(params.targetAudience)) throw new Error('INVALID_AUDIENCE');
  if (params.targetAudience === 'LEAGUE_OWNERS' && !params.targetLeagueId) throw new Error('LEAGUE_REQUIRED');
  if (typeof params.title !== 'string' || typeof params.body !== 'string' || !params.title.trim() || !params.body.trim() || params.title.length + params.body.length > 3500) throw new Error('INVALID_MESSAGE');
  await getSafeEligibleRecipients(undefined, seasonId);

  if (params.requestId && !/^[a-zA-Z0-9-]{8,100}$/.test(params.requestId)) throw new Error('INVALID_REQUEST_ID');
  const requestId = params.requestId || crypto.randomUUID();
  const broadcastId = `bcast-${crypto.createHash('sha256').update(params.adminUserId + ':' + requestId).digest('hex')}`;
  const now = new Date().toISOString();

  // 1. Resolve recipients
  let targetUserIds: string[] = [];
  if (params.targetAudience === 'SELECTED_RECIPIENTS') {
    if (!Array.isArray(params.selectedUserIds)) throw new Error('RECIPIENTS_REQUIRED');
    targetUserIds = [...new Set(params.selectedUserIds)];
    if (targetUserIds.some(uid => typeof uid !== 'string' || !memoryRecipientDirectory.has(uid))) throw new Error('UNKNOWN_RECIPIENT');
  } else {
    const safeRecipients = await getSafeEligibleRecipients(
      { audience: params.targetAudience, leagueId: params.targetLeagueId },
      seasonId
    );
    targetUserIds = safeRecipients.map((r) => r.userId);
  }

  if (targetUserIds.length === 0) {
    throw new Error('No eligible recipients found for this broadcast selection.');
  }

  // 2. Prepare recipient statuses and queue jobs
  const recipientStatuses: BroadcastRecipientStatus[] = [];
  const jobs: NotificationQueueJob[] = [];

  for (const uid of targetUserIds) {
    const recipient = memoryRecipientDirectory.get(uid);
    const hasTg = Boolean(recipient?.telegramId && recipient.messageable);

    recipientStatuses.push({
      userId: uid,
      username: recipient?.username || 'user',
      displayName: recipient?.displayName || 'User',
      clubName: recipient?.clubName,
      status: hasTg ? 'PENDING' : 'SKIPPED_NO_TELEGRAM',
      error: hasTg ? undefined : 'User has no connected Telegram account',
      retryCount: 0,
    });

    if (hasTg) {
      jobs.push({
        jobId: `job-${broadcastId}-${uid}`,
        broadcastId,
        userId: uid,
        username: recipient?.username || 'user',
        displayName: recipient?.displayName || 'User',
        telegramId: recipient!.telegramId!,
        title: params.title,
        body: params.body,
        type: params.type,
        status: 'QUEUED',
        retryCount: 0,
        maxRetries: 3,
        createdAt: now,
      });
    }
  }

  const record: TelegramBroadcastRecord = {
    id: broadcastId,
    seasonId,
    title: params.title,
    body: params.body,
    type: params.type,
    targetAudience: params.targetAudience,
    targetLeagueId: params.targetLeagueId,
    createdById: params.adminUserId,
    createdByUsername: params.adminUsername,
    createdAt: now,
    status: jobs.length > 0 ? 'QUEUED' : 'COMPLETED',
    metrics: {
      totalRecipients: targetUserIds.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: recipientStatuses.filter((r) => r.status === 'SKIPPED_NO_TELEGRAM').length,
    },
    recipients: recipientStatuses,
  };

  // One atomic write: a returned broadcast always has a durable queue.
  const persistedRecord = await durableClient.eval<unknown[], TelegramBroadcastRecord>(`
    local existing = redis.call('HGET', KEYS[1], ARGV[1])
    if existing then return existing end
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
    local jobs = cjson.decode(ARGV[3])
    for _, job in ipairs(jobs) do redis.call('RPUSH', KEYS[2], cjson.encode(job)) end
    return ARGV[2]
  `, [BROADCASTS_KEY, QUEUE_KEY], [broadcastId, JSON.stringify(record), JSON.stringify(jobs)]);
  if (persistedRecord.title !== record.title || persistedRecord.body !== record.body || persistedRecord.seasonId !== seasonId ||
      JSON.stringify(persistedRecord.recipients.map(r => r.userId).sort()) !== JSON.stringify(targetUserIds.slice().sort())) throw new Error('REQUEST_ID_REUSED_WITH_DIFFERENT_CONTENT');
  memoryBroadcasts.set(broadcastId, persistedRecord);

  scheduleNotificationQueueDrain();

  // Every selected user receives an in-app notification, including users who
  // do not have a messageable Telegram account. Deterministic document IDs make
  // retries with the same requestId idempotent.
  const notificationBatchSize = 400;
  const notificationDb = getFirestoreDb();
  for (let i = 0; i < targetUserIds.length; i += notificationBatchSize) {
    const batch = notificationDb.batch();
    for (const uid of targetUserIds.slice(i, i + notificationBatchSize)) {
      batch.set(notificationDb.collection(COLLECTIONS.NOTIFICATIONS).doc(`notif-${broadcastId}-${uid}`), {
        id: `notif-${broadcastId}-${uid}`,
        userId: uid,
        type: params.type,
        title: params.title,
        message: params.body,
        data: { broadcastId },
        isRead: false,
        createdAt: now,
      }, { merge: true });
    }
    await batch.commit();
  }

  // Create audit log
  await createAuditLog(
    params.adminUserId,
    'TELEGRAM_NOTIFICATION_BROADCAST',
    'BROADCAST',
    broadcastId,
    undefined,
    {
      broadcastId,
      title: params.title,
      type: params.type,
      recipientsTotal: targetUserIds.length,
      queuedJobs: jobs.length,
      skippedNoTelegram: record.metrics.skippedCount,
      timestamp: now,
    },
    undefined,
    params.adminUsername,
    `Enqueued broadcast '${params.title}' for ${targetUserIds.length} recipients (${jobs.length} with Telegram).`
  ).catch(() => console.warn('[NOTIF_QUEUE] Broadcast persisted; auxiliary audit unavailable'));

  return persistedRecord;
}

/**
 * Worker function that processes pending notification jobs from Redis / memory queue.
 * Implements Telegram Bot API compliant rate limiting (max 25-30 msg/sec).
 */
export async function processNotificationQueue(batchSize = 25, stopClaimingAt = Infinity): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  locked?: boolean;
}> {
  const client = getUpstashClient();
  if (!client) throw new Error('REDIS_REQUIRED');
  const token = crypto.randomUUID();
  if (!await client.set(WORKER_LOCK, token, { nx: true, ex: 120 })) return { processed: 0, succeeded: 0, failed: 0, locked: true };
  let processed = 0, succeeded = 0, failed = 0;
  const deadline = Math.min(Date.now() + 20000, stopClaimingAt);
  try {
    // A worker may have died after Telegram accepted a message. Do not blindly resend it.
    const abandoned = await client.hgetall<Record<string, NotificationQueueJob & { claimedAt?: number }>>(PROCESSING_KEY);
    for (const job of Object.values(abandoned || {})) {
      if ((job.claimedAt || 0) + 120000 > Date.now()) continue;
      await updateBroadcastRecipientState(job.broadcastId, job.userId, 'FAILED', 'DELIVERY_UNKNOWN: worker interrupted; verify delivery before creating another broadcast');
      await client.hdel(PROCESSING_KEY, job.jobId);
    }
    for (let i = 0; i < Math.min(Math.max(batchSize, 1), 25) && Date.now() < deadline; i++) {
      const job = await client.eval<unknown[], NotificationQueueJob>(`
        if redis.call('GET', KEYS[3]) ~= ARGV[1] then return nil end
        local count = redis.call('LLEN', KEYS[1])
        for i = 1, count do
          local raw = redis.call('LPOP', KEYS[1])
          local job = cjson.decode(raw)
          if tonumber(job.availableAt or 0) <= tonumber(ARGV[2]) then
            job.claimedAt = tonumber(ARGV[2])
            redis.call('HSET', KEYS[2], job.jobId, cjson.encode(job))
            return cjson.encode(job)
          end
          redis.call('RPUSH', KEYS[1], raw)
        end
        return nil
      `, [QUEUE_KEY, PROCESSING_KEY, WORKER_LOCK], [token, Date.now()]);
      if (!job) break;
      processed++;
      const record = await getBroadcastDetails(job.broadcastId);
      const recipient = record?.recipients.find(r => r.userId === job.userId);
      if (!record || !recipient) throw new Error('BROADCAST_RECORD_MISSING');
      if (['SENT', 'FAILED', 'SKIPPED_NO_TELEGRAM'].includes(recipient.status)) {
        await client.hdel(PROCESSING_KEY, job.jobId);
        continue;
      }
      if (recipient.status === 'SENDING') {
        await updateBroadcastRecipientState(job.broadcastId, job.userId, 'FAILED', 'DELIVERY_UNKNOWN: interrupted send');
        await client.hdel(PROCESSING_KEY, job.jobId);
        continue;
      }
      recipient.status = 'SENDING';
      record.status = 'PROCESSING';
      await client.hset(BROADCASTS_KEY, { [record.id]: record });
      const result = await sendTelegramMessage(
        job.telegramId!,
        formatTelegramMessage(job.title, job.body, job.type, Boolean(job.bodyIsHtml)),
        { parse_mode: 'HTML', reply_markup: job.replyMarkup }
      );
      if (result.ok) {
        await updateBroadcastRecipientState(job.broadcastId, job.userId, 'SENT', undefined, new Date().toISOString());
        succeeded++;
      } else {
        const errorText = result.error_code
          ? `TELEGRAM_${result.error_code}: ${result.error || 'Rejected'}${result.parameters?.retry_after ? '; retry after ' + result.parameters.retry_after + ' seconds' : ''}`
          : 'DELIVERY_UNKNOWN: ' + (result.error || 'No response');
        const definitelyRejected = Boolean(result.error_code);
        const retryable = result.error_code === 429 || Boolean(result.error_code && result.error_code >= 500);
        if (definitelyRejected && retryable && job.retryCount < job.maxRetries) {
          job.retryCount += 1;
          const retryAfterSeconds = Math.max(Number(result.parameters?.retry_after || 0), 2 ** job.retryCount);
          job.availableAt = Date.now() + retryAfterSeconds * 1000;
          job.status = 'QUEUED';
          await updateBroadcastRecipientState(job.broadcastId, job.userId, 'PENDING', errorText, undefined, job.retryCount);
          await client.rpush(QUEUE_KEY, JSON.stringify(job));
        } else {
          // Ambiguous timeouts are never retried automatically because Telegram
          // may have accepted the message before the connection was lost.
          await updateBroadcastRecipientState(job.broadcastId, job.userId, 'FAILED', errorText, undefined, job.retryCount);
          failed++;
        }
      }
      await client.hdel(PROCESSING_KEY, job.jobId);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { processed, succeeded, failed };
  } finally {
    await client.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", [WORKER_LOCK], [token]);
  }
}

function formatTelegramMessage(title: string, body: string, type: string, bodyIsHtml = false): string {
  let icon = '📢';
  if (type === 'NEW_MATCHDAY') icon = '⚽';
  if (type === 'UPCOMING_MATCH') icon = '⏰';
  if (type === 'COMPETITION_UPDATE') icon = '🏆';

  // No permanent "Official Alert" header/footer. Smart bodies are generated server-side
  // and may contain a small, controlled HTML subset; admin-entered bodies stay escaped.
  const safeBody = bodyIsHtml ? body : escapeHtml(body);
  return `<b>${icon} ${escapeHtml(title)}</b>\n\n${safeBody}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function updateBroadcastRecipientState(
  broadcastId: string,
  userId: string,
  status: 'PENDING' | 'SENT' | 'FAILED',
  error?: string,
  sentAt?: string,
  retryCount?: number
) {
  const bcast = await getBroadcastDetails(broadcastId);
  if (!bcast) throw new Error('BROADCAST_RECORD_MISSING');

  const r = bcast.recipients.find((rec) => rec.userId === userId);
  if (r) {
    r.status = status;
    if (error) r.error = error;
    if (sentAt) r.sentAt = sentAt;
    if (retryCount !== undefined) r.retryCount = retryCount;
  }

  bcast.metrics.sentCount = bcast.recipients.filter(r => r.status === 'SENT').length;
  bcast.metrics.failedCount = bcast.recipients.filter(r => r.status === 'FAILED').length;

  const totalFinished = bcast.metrics.sentCount + bcast.metrics.failedCount + bcast.metrics.skippedCount;
  if (totalFinished >= bcast.metrics.totalRecipients) {
    bcast.status = bcast.metrics.failedCount > 0 ? 'PARTIALLY_FAILED' : 'COMPLETED';
  }

  // Also persist to Redis if available
  const client = getUpstashClient();
  if (client) {
    await client.hset(BROADCASTS_KEY, { [broadcastId]: bcast });
  }
  memoryBroadcasts.set(broadcastId, bcast);
}

/**
 * Returns past broadcasts list.
 */
export async function getBroadcastHistory(limit = 20): Promise<TelegramBroadcastRecord[]> {
  const client = getUpstashClient();
  if (client) {
    try {
      const records = await client.hgetall<Record<string, TelegramBroadcastRecord>>(BROADCASTS_KEY);
      if (records) {
        const list = Object.values(records) as TelegramBroadcastRecord[];
        return list
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, limit);
      }
    } catch {}
  }

  return Array.from(memoryBroadcasts.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/**
 * Returns single broadcast record by ID.
 */
export async function getBroadcastDetails(broadcastId: string): Promise<TelegramBroadcastRecord | null> {
  const client = getUpstashClient();
  if (client) {
    try {
      const record = await client.hget<TelegramBroadcastRecord>(BROADCASTS_KEY, broadcastId);
      if (record) return record;
    } catch {}
  }
  return memoryBroadcasts.get(broadcastId) || null;
}
