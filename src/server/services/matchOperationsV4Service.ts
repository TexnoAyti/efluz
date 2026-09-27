import { waitUntil } from '@vercel/functions';
import { Fixture } from '../../types';
import { getFirestoreDb } from '../firebase/admin';
import {
  getFixtureByIdFirestore,
  getFixturesFirestore,
  trackFirestoreRead,
  trackFirestoreWrite,
} from '../firebase/firestoreStore';
import {
  getUpstashClient,
  KEY_PREFIX,
  refreshChangedFixtureReadModel,
} from '../readModel/readModelStore';
import {
  createAuditLog,
  editFixtureResult,
  getDisputes,
  resolveDispute,
} from './adminService';
import { enqueueSmartTelegramNotification } from './smartNotificationService';

const DEADLINE_COLLECTION = 'match_deadlines';
const NO_SHOW_COLLECTION = 'no_show_reports';
const SWEEP_LOCK_PREFIX = `${KEY_PREFIX}:match-ops:deadline-sweep`;
const HOUR_MS = 60 * 60 * 1000;

export type DeadlineState = 'NONE' | 'SCHEDULED' | 'DUE_24H' | 'DUE_6H' | 'OVERDUE' | 'CLOSED';
export type NoShowResolutionAction = 'WALKOVER_HOME' | 'WALKOVER_AWAY' | 'POSTPONE' | 'REJECT';

function ownerId(fixture: any, side: 'home' | 'away'): string | undefined {
  return side === 'home'
    ? (fixture.homeOwnerId || fixture.homeOwner?.userId || fixture.homeUser?.id || fixture.homeClub?.claimedByUserId)
    : (fixture.awayOwnerId || fixture.awayOwner?.userId || fixture.awayUser?.id || fixture.awayClub?.claimedByUserId);
}

function participantSide(fixture: any, userId: string): 'home' | 'away' | null {
  if (ownerId(fixture, 'home') === userId) return 'home';
  if (ownerId(fixture, 'away') === userId) return 'away';
  return null;
}

function fixtureClubName(fixture: any, side: 'home' | 'away'): string {
  return side === 'home'
    ? (fixture.homeClub?.name || fixture.homeClubId || 'Home')
    : (fixture.awayClub?.name || fixture.awayClubId || 'Away');
}

function formatTashkent(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone: 'Asia/Tashkent',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date) + ' (Toshkent)';
  } catch {
    return date.toISOString();
  }
}

export function getDeadlineState(deadlineAt?: string | null, fixtureStatus?: string): DeadlineState {
  if (['CONFIRMED', 'CANCELLED'].includes(String(fixtureStatus || '').toUpperCase())) return 'CLOSED';
  if (!deadlineAt) return 'NONE';
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) return 'NONE';
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return 'OVERDUE';
  if (remaining <= 6 * HOUR_MS) return 'DUE_6H';
  if (remaining <= 24 * HOUR_MS) return 'DUE_24H';
  return 'SCHEDULED';
}

async function readSeasonDeadlines(seasonId: string): Promise<any[]> {
  const db = getFirestoreDb();
  const snap = await db.collection(DEADLINE_COLLECTION).where('seasonId', '==', seasonId).limit(300).get();
  trackFirestoreRead(DEADLINE_COLLECTION, snap.size, 'matchOperationsV4:readSeasonDeadlines');
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function readUserNoShows(userId: string, seasonId: string): Promise<any[]> {
  const db = getFirestoreDb();
  const snap = await db.collection(NO_SHOW_COLLECTION).where('reporterUserId', '==', userId).limit(100).get();
  trackFirestoreRead(NO_SHOW_COLLECTION, snap.size, 'matchOperationsV4:readUserNoShows');
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((item: any) => !item.seasonId || item.seasonId === seasonId);
}

export async function setFixtureDeadline(params: {
  fixtureId: string;
  deadlineAt: string;
  actorUserId: string;
  actorUsername?: string;
  notes?: string;
}) {
  const deadlineMs = Date.parse(params.deadlineAt);
  if (!Number.isFinite(deadlineMs)) throw new Error('INVALID_DEADLINE');
  if (deadlineMs <= Date.now() + 5 * 60 * 1000) throw new Error('DEADLINE_MUST_BE_IN_FUTURE');
  if (deadlineMs > Date.now() + 30 * 24 * HOUR_MS) throw new Error('DEADLINE_TOO_FAR');

  const fixture: any = await getFixtureByIdFirestore(params.fixtureId, params.actorUserId);
  if (!fixture) throw new Error('FIXTURE_NOT_FOUND');
  if (['CONFIRMED', 'CANCELLED'].includes(String(fixture.status))) throw new Error('FIXTURE_ALREADY_CLOSED');

  const db = getFirestoreDb();
  const ref = db.collection(DEADLINE_COLLECTION).doc(params.fixtureId);
  const previousSnap = await ref.get();
  trackFirestoreRead(DEADLINE_COLLECTION, 1, 'matchOperationsV4:setDeadline:previous');
  const previous = previousSnap.exists ? previousSnap.data() : null;
  const now = new Date().toISOString();
  const record = {
    fixtureId: fixture.id,
    seasonId: fixture.seasonId || 'season-2026-27',
    competitionId: fixture.competitionId,
    competitionName: fixture.competitionName || fixture.competitionId,
    matchday: Number(fixture.matchday || 0),
    roundName: fixture.roundName || null,
    homeClubId: fixture.homeClubId || null,
    awayClubId: fixture.awayClubId || null,
    homeClubName: fixtureClubName(fixture, 'home'),
    awayClubName: fixtureClubName(fixture, 'away'),
    homeOwnerId: ownerId(fixture, 'home') || null,
    awayOwnerId: ownerId(fixture, 'away') || null,
    deadlineAt: new Date(deadlineMs).toISOString(),
    // A changed deadline gets fresh reminder windows. Old sent markers must not suppress it.
    reminder24SentAt: previous?.deadlineAt === new Date(deadlineMs).toISOString() ? previous?.reminder24SentAt || null : null,
    reminder6SentAt: previous?.deadlineAt === new Date(deadlineMs).toISOString() ? previous?.reminder6SentAt || null : null,
    overdueSentAt: previous?.deadlineAt === new Date(deadlineMs).toISOString() ? previous?.overdueSentAt || null : null,
    notes: params.notes || null,
    updatedBy: params.actorUserId,
    updatedAt: now,
    createdAt: previous?.createdAt || now,
  };
  await ref.set(record, { merge: true });
  trackFirestoreWrite(DEADLINE_COLLECTION, 1, 'matchOperationsV4:setDeadline');
  await createAuditLog(
    params.actorUserId,
    'FIXTURE_DEADLINE_SET',
    'FIXTURE',
    params.fixtureId,
    previous || undefined,
    record,
    undefined,
    params.actorUsername || 'admin',
    params.notes
  ).catch(() => {});
  return { ...record, state: getDeadlineState(record.deadlineAt, fixture.status) };
}

export async function getMyMatchOperations(userId: string, seasonId = 'season-2026-27') {
  const [fixtures, deadlines, reports] = await Promise.all([
    getFixturesFirestore({ userId, seasonId }),
    readSeasonDeadlines(seasonId).catch(() => []),
    readUserNoShows(userId, seasonId).catch(() => []),
  ]);
  const deadlineByFixture = new Map(deadlines.map((item: any) => [item.fixtureId || item.id, item]));
  const reportByFixture = new Map(reports.map((item: any) => [item.fixtureId, item]));
  const rows = fixtures.map((fixture: any) => {
    const deadline = deadlineByFixture.get(fixture.id) as any;
    const report = reportByFixture.get(fixture.id) as any;
    const deadlineAt = deadline?.deadlineAt || null;
    const deadlineMs = deadlineAt ? Date.parse(deadlineAt) : NaN;
    return {
      fixture,
      deadline: deadline ? {
        ...deadline,
        state: getDeadlineState(deadlineAt, fixture.status),
        remainingMs: Number.isFinite(deadlineMs) ? deadlineMs - Date.now() : null,
      } : null,
      noShowReport: report || null,
      canReportNoShow: Boolean(participantSide(fixture, userId)) && !['CONFIRMED', 'CANCELLED'].includes(fixture.status),
      participantSide: participantSide(fixture, userId),
    };
  });
  return { seasonId, rows, generatedAt: new Date().toISOString() };
}

export async function reportNoShowV4(params: {
  fixtureId: string;
  seasonId: string;
  userId: string;
  username?: string;
  reason: string;
  evidenceUrl?: string | null;
}) {
  const reason = params.reason.trim();
  if (reason.length < 3 || reason.length > 1000) throw new Error('INVALID_NO_SHOW_REASON');
  if (params.evidenceUrl && !/^https:\/\//i.test(params.evidenceUrl)) throw new Error('EVIDENCE_URL_MUST_BE_HTTPS');

  const fixture: any = await getFixtureByIdFirestore(params.fixtureId, params.userId);
  if (!fixture) throw new Error('FIXTURE_NOT_FOUND');
  const side = participantSide(fixture, params.userId);
  if (!side) throw new Error('FIXTURE_NOT_OWNED_BY_USER');
  if (['CONFIRMED', 'CANCELLED'].includes(String(fixture.status))) throw new Error('FIXTURE_ALREADY_CLOSED');

  const db = getFirestoreDb();
  const id = `${params.fixtureId}__${params.userId}`;
  const ref = db.collection(NO_SHOW_COLLECTION).doc(id);
  const previous = await ref.get();
  trackFirestoreRead(NO_SHOW_COLLECTION, 1, 'matchOperationsV4:reportNoShow:previous');
  if (previous.exists && ['OPEN', 'UNDER_REVIEW'].includes(String(previous.data()?.status))) {
    return { success: true, duplicate: true, report: { id: previous.id, ...previous.data() } };
  }

  const deadlineSnap = await db.collection(DEADLINE_COLLECTION).doc(params.fixtureId).get().catch(() => null);
  if (deadlineSnap) trackFirestoreRead(DEADLINE_COLLECTION, 1, 'matchOperationsV4:reportNoShow:deadline');
  const deadline: any = deadlineSnap?.exists ? deadlineSnap.data() : null;
  const now = new Date().toISOString();
  const report = {
    id,
    seasonId: params.seasonId || fixture.seasonId || 'season-2026-27',
    fixtureId: fixture.id,
    competitionId: fixture.competitionId,
    competitionName: fixture.competitionName || fixture.competitionId,
    matchday: Number(fixture.matchday || 0),
    reporterUserId: params.userId,
    reporterUsername: params.username || null,
    reporterSide: side,
    homeClubId: fixture.homeClubId,
    awayClubId: fixture.awayClubId,
    homeClubName: fixtureClubName(fixture, 'home'),
    awayClubName: fixtureClubName(fixture, 'away'),
    reason,
    evidenceUrl: params.evidenceUrl || null,
    deadlineAt: deadline?.deadlineAt || null,
    deadlineState: getDeadlineState(deadline?.deadlineAt, fixture.status),
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(report, { merge: false });
  trackFirestoreWrite(NO_SHOW_COLLECTION, 1, 'matchOperationsV4:reportNoShow');
  await createAuditLog(
    params.userId,
    'NO_SHOW_REPORTED',
    'FIXTURE',
    params.fixtureId,
    undefined,
    report,
    undefined,
    params.username || 'player',
    reason
  ).catch(() => {});
  return { success: true, duplicate: false, report };
}

export async function getAdminMatchOperations(seasonId = 'season-2026-27') {
  const db = getFirestoreDb();
  const [deadlines, noShowSnap, disputes] = await Promise.all([
    readSeasonDeadlines(seasonId).catch(() => []),
    db.collection(NO_SHOW_COLLECTION).where('seasonId', '==', seasonId).limit(150).get(),
    getDisputes('OPEN').catch(() => []),
  ]);
  trackFirestoreRead(NO_SHOW_COLLECTION, noShowSnap.size, 'matchOperationsV4:adminControl:noShows');
  const noShowReports = noShowSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const now = Date.now();
  const hydratedDeadlines = deadlines
    .map((item: any) => ({
      ...item,
      state: getDeadlineState(item.deadlineAt),
      remainingMs: Date.parse(item.deadlineAt || '') - now,
    }))
    .sort((a: any, b: any) => Date.parse(a.deadlineAt || '') - Date.parse(b.deadlineAt || ''));
  return {
    seasonId,
    deadlines: hydratedDeadlines,
    noShowReports: noShowReports.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    disputes,
    counters: {
      deadlines: hydratedDeadlines.length,
      due24h: hydratedDeadlines.filter((item: any) => item.state === 'DUE_24H').length,
      due6h: hydratedDeadlines.filter((item: any) => item.state === 'DUE_6H').length,
      overdue: hydratedDeadlines.filter((item: any) => item.state === 'OVERDUE').length,
      openNoShows: noShowReports.filter((item: any) => ['OPEN', 'UNDER_REVIEW'].includes(String(item.status))).length,
      openDisputes: disputes.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

function reminderKind(deadline: any): '24h' | '6h' | 'overdue' | null {
  const deadlineMs = Date.parse(deadline.deadlineAt || '');
  if (!Number.isFinite(deadlineMs)) return null;
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0 && !deadline.overdueSentAt) return 'overdue';
  if (remaining > 0 && remaining <= 6 * HOUR_MS && !deadline.reminder6SentAt) return '6h';
  if (remaining > 6 * HOUR_MS && remaining <= 24 * HOUR_MS && !deadline.reminder24SentAt) return '24h';
  return null;
}

async function sendDeadlineReminder(deadline: any, kind: '24h' | '6h' | 'overdue') {
  const fixture: any = await getFixtureByIdFirestore(deadline.fixtureId).catch(() => null);
  if (!fixture || ['CONFIRMED', 'CANCELLED'].includes(String(fixture.status))) return { attempted: false, queued: 0 };
  const owners = [ownerId(fixture, 'home'), ownerId(fixture, 'away')].filter(Boolean) as string[];
  if (owners.length === 0) return { attempted: false, queued: 0 };
  const competition = fixture.competitionName || fixture.competitionId || 'EFL UZ';
  const title = kind === 'overdue' ? '⛔ Match deadline o‘tdi' : kind === '6h' ? '⏳ 6 soat qoldi' : '⏰ 24 soat qoldi';
  const deadlineText = formatTashkent(deadline.deadlineAt);
  const body = `<b>${competition}</b> • ${fixture.roundName || `Matchday ${fixture.matchday || 1}`}\n\n⚽ <b>${fixtureClubName(fixture, 'home')}</b> vs <b>${fixtureClubName(fixture, 'away')}</b>\n⏳ Deadline: <b>${deadlineText}</b>\n\n${kind === 'overdue' ? 'Muddat tugadi. Natijani yuboring yoki no-show holatini EFL UZ ichida belgilang.' : 'O‘yinni kelishib, muddatdan oldin natijani yuboring.'}`;
  const results = await Promise.allSettled(owners.map((userId) => enqueueSmartTelegramNotification({
    userId,
    seasonId: deadline.seasonId || 'season-2026-27',
    eventId: `matchday-open:deadline:${kind}:${deadline.fixtureId}:${deadline.deadlineAt}`,
    title,
    body,
    replyMarkup: { inline_keyboard: [[{ text: '🏟 Mening o‘yinlarim', url: 'https://efluz.vercel.app/my-matches' }]] },
  })));
  const queued = results.filter((item) => item.status === 'fulfilled' && item.value).length;
  return { attempted: true, queued };
}

export async function runDeadlineSweep(seasonId = 'season-2026-27', force = false) {
  const client = getUpstashClient();
  if (!client) return { skipped: true, reason: 'REDIS_REQUIRED', checked: 0, reminders: 0 };
  const lockKey = `${SWEEP_LOCK_PREFIX}:${seasonId}`;
  if (!force) {
    const accepted = await client.set(lockKey, String(Date.now()), { nx: true, ex: 3600 });
    if (!accepted) return { skipped: true, reason: 'HOURLY_LOCK', checked: 0, reminders: 0 };
  }

  const deadlines = await readSeasonDeadlines(seasonId);
  let checked = 0;
  let reminders = 0;
  const db = getFirestoreDb();
  for (const deadline of deadlines) {
    const kind = reminderKind(deadline);
    if (!kind) continue;
    checked++;
    const result = await sendDeadlineReminder(deadline, kind);
    if (!result.attempted) continue;
    // If delivery could not be queued (Redis recipient directory/settings), leave the
    // marker empty so the next hourly event-driven sweep can retry safely. Smart
    // notification event IDs are deterministic, so successful recipients dedupe.
    if (result.queued <= 0) continue;
    reminders += result.queued;
    const field = kind === '24h' ? 'reminder24SentAt' : kind === '6h' ? 'reminder6SentAt' : 'overdueSentAt';
    await db.collection(DEADLINE_COLLECTION).doc(deadline.fixtureId).set({ [field]: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
    trackFirestoreWrite(DEADLINE_COLLECTION, 1, `matchOperationsV4:sweep:${kind}`);
  }
  return { skipped: false, checked, reminders };
}

export function scheduleDeadlineSweep(seasonId = 'season-2026-27') {
  const work = runDeadlineSweep(seasonId).catch((error) => {
    console.warn('[MATCH_OPS_DEADLINE_SWEEP_FAILED]', error?.message || error);
  });
  if (process.env.VERCEL === '1') waitUntil(work);
  else void work;
}

export async function resolveNoShowV4(params: {
  reportId: string;
  action: NoShowResolutionAction;
  adminUserId: string;
  adminUsername?: string;
  notes?: string;
  deadlineAt?: string | null;
}) {
  const db = getFirestoreDb();
  const ref = db.collection(NO_SHOW_COLLECTION).doc(params.reportId);
  const snap = await ref.get();
  trackFirestoreRead(NO_SHOW_COLLECTION, 1, 'matchOperationsV4:resolveNoShow');
  if (!snap.exists) throw new Error('NO_SHOW_REPORT_NOT_FOUND');
  const report: any = { id: snap.id, ...snap.data() };
  let result: any = null;

  if (params.action === 'WALKOVER_HOME') {
    result = await editFixtureResult(params.adminUserId, params.adminUsername || 'admin', report.fixtureId, {
      homeScore: 3, awayScore: 0, status: 'CONFIRMED', notes: params.notes || '3–0 walkover (no-show)',
    });
  } else if (params.action === 'WALKOVER_AWAY') {
    result = await editFixtureResult(params.adminUserId, params.adminUsername || 'admin', report.fixtureId, {
      homeScore: 0, awayScore: 3, status: 'CONFIRMED', notes: params.notes || '0–3 walkover (no-show)',
    });
  } else if (params.action === 'POSTPONE') {
    if (!params.deadlineAt) throw new Error('POSTPONE_DEADLINE_REQUIRED');
    await setFixtureDeadline({
      fixtureId: report.fixtureId,
      deadlineAt: params.deadlineAt,
      actorUserId: params.adminUserId,
      actorUsername: params.adminUsername,
      notes: params.notes || 'Postponed after no-show review',
    });
    await db.collection('fixtures').doc(report.fixtureId).set({ status: 'POSTPONED', updatedAt: new Date().toISOString() }, { merge: true });
    trackFirestoreWrite('fixtures', 1, 'matchOperationsV4:postponeFixture');
    await refreshChangedFixtureReadModel(report.fixtureId).catch(() => {});
  }

  const now = new Date().toISOString();
  const resolution = {
    status: params.action === 'REJECT' ? 'DISMISSED' : 'RESOLVED',
    resolutionAction: params.action,
    resolutionNotes: params.notes || null,
    resolvedAt: now,
    resolvedBy: params.adminUserId,
    updatedAt: now,
  };
  const related = await db.collection(NO_SHOW_COLLECTION).where('fixtureId', '==', report.fixtureId).limit(4).get().catch(() => null);
  if (related) {
    trackFirestoreRead(NO_SHOW_COLLECTION, related.size, 'matchOperationsV4:resolveNoShow:related');
    const batch = db.batch();
    for (const doc of related.docs) batch.set(doc.ref, resolution, { merge: true });
    await batch.commit();
    trackFirestoreWrite(NO_SHOW_COLLECTION, related.size, 'matchOperationsV4:resolveNoShow:related');
  } else {
    await ref.set(resolution, { merge: true });
    trackFirestoreWrite(NO_SHOW_COLLECTION, 1, 'matchOperationsV4:resolveNoShow:single');
  }
  await createAuditLog(
    params.adminUserId,
    'NO_SHOW_RESOLVED',
    'FIXTURE',
    report.fixtureId,
    report,
    { ...report, ...resolution },
    undefined,
    params.adminUsername || 'admin',
    params.notes
  ).catch(() => {});
  return { success: true, report: { ...report, ...resolution }, result };
}

export async function resolveResultDisputeV4(params: {
  disputeId: string;
  adminUserId: string;
  action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH';
  manualHomeScore?: number;
  manualAwayScore?: number;
  notes?: string;
}) {
  return resolveDispute(params.adminUserId, params.disputeId, {
    action: params.action,
    manualHomeScore: params.manualHomeScore,
    manualAwayScore: params.manualAwayScore,
    notes: params.notes,
  });
}
