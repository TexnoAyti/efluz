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
  sentAt?: string;
  error?: string;
}

const BROADCASTS_KEY = `${KEY_PREFIX}:telegram:broadcasts`;
const QUEUE_KEY = `${KEY_PREFIX}:telegram:queue`;
const RECIPIENT_DIR_KEY = `${KEY_PREFIX}:private:recipient-directory`;

// In-memory memory fallback stores
const memoryBroadcasts = new Map<string, TelegramBroadcastRecord>();
const memoryJobQueue: NotificationQueueJob[] = [];
const memoryRecipientDirectory = new Map<string, RecipientDirectoryEntry>();

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
      db.collection(COLLECTIONS.USERS).get(),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId', '==', seasonId).get(),
    ]);

    const occupancyMap = new Map<string, { clubId: string; claimedAt: string }>();
    for (const doc of occSnap.docs) {
      const data = doc.data();
      if (data.userId && data.clubId) {
        occupancyMap.set(data.userId, { clubId: data.clubId, claimedAt: data.claimedAt });
      }
    }

    const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
    const leaguesMap = new Map(SEED_LEAGUES.map((l) => [l.id, l]));

    for (const doc of usersSnap.docs) {
      const u = doc.data() as FirestoreUserDoc;
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
      memoryRecipientDirectory.set(u.id, entry);
    }
  } catch (err) {
    // Fallback: populate from SQLite
    const userRows = queryAll<any>('SELECT * FROM users');
    const occRows = queryAll<any>('SELECT * FROM club_memberships WHERE status = ?', ['active']);
    const occupancyMap = new Map<string, string>();
    for (const o of occRows) {
      if (o.user_id && o.club_id) occupancyMap.set(o.user_id, o.club_id);
    }

    const clubsMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));
    const leaguesMap = new Map(SEED_LEAGUES.map((l) => [l.id, l]));

    for (const u of userRows) {
      const clubId = occupancyMap.get(u.id);
      const club = clubId ? clubsMap.get(clubId) : undefined;
      const league = club ? leaguesMap.get(club.leagueId) : undefined;
      const hasTelegram = Boolean(u.telegram_id);

      const entry: RecipientDirectoryEntry = {
        userId: u.id,
        username: u.username || `player_${u.id.substring(0, 6)}`,
        displayName: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'EFL Player',
        telegramId: u.telegram_id || null,
        clubId: club?.id,
        clubName: club?.name,
        leagueId: league?.id,
        leagueName: league?.name,
        messageable: hasTelegram && !u.is_suspended,
        updatedAt: now,
      };

      dirMap.set(u.id, entry);
      memoryRecipientDirectory.set(u.id, entry);
    }
  }

  // Persist into private Redis directory
  const entriesArray = Array.from(dirMap.values());
  const client = getUpstashClient();
  if (client) {
    try {
      await client.set(RECIPIENT_DIR_KEY, entriesArray);
    } catch {}
  }

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
  if (memoryRecipientDirectory.size === 0) {
    await syncRecipientDirectory(seasonId);
  }

  const client = getUpstashClient();
  let entries: RecipientDirectoryEntry[] = [];

  if (client) {
    try {
      const cached = await client.get<RecipientDirectoryEntry[]>(RECIPIENT_DIR_KEY);
      if (Array.isArray(cached) && cached.length > 0) {
        entries = cached;
      }
    } catch {}
  }

  if (entries.length === 0) {
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
}): Promise<TelegramBroadcastRecord> {
  const seasonId = params.seasonId || 'season-2026-27';
  if (memoryRecipientDirectory.size === 0) {
    await syncRecipientDirectory(seasonId);
  }

  const broadcastId = `bcast-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  // 1. Resolve recipients
  let targetUserIds: string[] = [];
  if (params.targetAudience === 'SELECTED_RECIPIENTS') {
    targetUserIds = params.selectedUserIds || [];
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
    const hasTg = Boolean(recipient?.telegramId);

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

  // Persist record
  memoryBroadcasts.set(broadcastId, record);
  for (const job of jobs) {
    memoryJobQueue.push(job);
  }

  const client = getUpstashClient();
  if (client) {
    try {
      await client.hset(BROADCASTS_KEY, { [broadcastId]: record });
      for (const job of jobs) {
        await client.rpush(QUEUE_KEY, job);
      }
    } catch (err: any) {
      console.warn('[NOTIF_QUEUE] Redis enqueue error:', err.message);
    }
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
  );

  // Trigger non-blocking asynchronous queue processor
  setTimeout(() => {
    processNotificationQueue().catch((err) =>
      console.error('[NOTIF_QUEUE] Background processor failed:', err)
    );
  }, 100);

  return record;
}

/**
 * Worker function that processes pending notification jobs from Redis / memory queue.
 * Implements Telegram Bot API compliant rate limiting (max 25-30 msg/sec).
 */
export async function processNotificationQueue(batchSize = 25): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  const client = getUpstashClient();
  let pendingJobs: NotificationQueueJob[] = [];

  if (client) {
    try {
      // Fetch up to batchSize jobs
      for (let i = 0; i < batchSize; i++) {
        const job = await client.lpop<NotificationQueueJob>(QUEUE_KEY);
        if (!job) break;
        pendingJobs.push(job);
      }
    } catch {}
  }

  if (pendingJobs.length === 0) {
    pendingJobs = memoryJobQueue.splice(0, batchSize);
  }

  if (pendingJobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  for (const job of pendingJobs) {
    processed++;
    const formattedHtml = formatTelegramMessage(job.title, job.body, job.type);

    try {
      const res = await sendTelegramMessage(job.telegramId!, formattedHtml, { parse_mode: 'HTML' });
      const now = new Date().toISOString();

      if (res.ok) {
        succeeded++;
        job.status = 'SENT';
        job.sentAt = now;

        updateBroadcastRecipientState(job.broadcastId, job.userId, 'SENT', undefined, now);
      } else {
        job.retryCount++;
        const errMsg = res.error || 'Telegram API returned not ok';

        if (job.retryCount < job.maxRetries) {
          job.status = 'QUEUED';
          memoryJobQueue.push(job); // re-queue for retry
        } else {
          failed++;
          job.status = 'FAILED';
          job.error = errMsg;
          updateBroadcastRecipientState(job.broadcastId, job.userId, 'FAILED', errMsg);
        }
      }
    } catch (err: any) {
      job.retryCount++;
      if (job.retryCount < job.maxRetries) {
        job.status = 'QUEUED';
        memoryJobQueue.push(job);
      } else {
        failed++;
        job.status = 'FAILED';
        job.error = err.message;
        updateBroadcastRecipientState(job.broadcastId, job.userId, 'FAILED', err.message);
      }
    }

    // Rate-limit throttle: 40ms delay between deliveries (~25 messages/sec)
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  return { processed, succeeded, failed };
}

function formatTelegramMessage(title: string, body: string, type: string): string {
  let icon = '📢';
  if (type === 'NEW_MATCHDAY') icon = '⚽';
  if (type === 'UPCOMING_MATCH') icon = '⏰';
  if (type === 'COMPETITION_UPDATE') icon = '🏆';

  return `<b>${icon} EFL UZ Official Alert</b>\n\n` +
         `<b>${escapeHtml(title)}</b>\n\n` +
         `${escapeHtml(body)}\n\n` +
         `<i>Season 2026/27 • Open EFL WebApp to manage fixtures</i>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateBroadcastRecipientState(
  broadcastId: string,
  userId: string,
  status: 'SENT' | 'FAILED',
  error?: string,
  sentAt?: string
) {
  const bcast = memoryBroadcasts.get(broadcastId);
  if (!bcast) return;

  const r = bcast.recipients.find((rec) => rec.userId === userId);
  if (r) {
    r.status = status;
    if (error) r.error = error;
    if (sentAt) r.sentAt = sentAt;
  }

  if (status === 'SENT') bcast.metrics.sentCount++;
  if (status === 'FAILED') bcast.metrics.failedCount++;

  const totalFinished = bcast.metrics.sentCount + bcast.metrics.failedCount + bcast.metrics.skippedCount;
  if (totalFinished >= bcast.metrics.totalRecipients) {
    bcast.status = bcast.metrics.failedCount > 0 ? 'PARTIALLY_FAILED' : 'COMPLETED';
  }

  // Also persist to Redis if available
  const client = getUpstashClient();
  if (client) {
    client.hset(BROADCASTS_KEY, { [broadcastId]: bcast }).catch(() => {});
  }
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
