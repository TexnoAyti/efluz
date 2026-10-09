import { filterRetiredFixtures } from './retiredFixtureService';
import { randomUUID } from 'node:crypto';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS, FirestoreCompetitionDoc, FirestoreMatchdayLockDoc, FirestoreFixtureDoc } from '../firebase/collections';
import { resolveMatchdayGate } from '../../lib/matchdayState';
import { syncCompetitionMatchdayState } from '../firebase/firestoreStore';

export type MatchdayAction = 'SELECT' | 'OPEN' | 'LOCK' | 'EXTEND' | 'RESTART';
export class MatchdayControlError extends Error {
  constructor(public code: string, message: string, public statusCode = 400, public blockers: { id: string; status: string }[] = []) { super(message); }
}
const finalStatuses = new Set(['CONFIRMED', 'CANCELLED', 'POSTPONED']);
function totalRounds(comp: FirestoreCompetitionDoc, fixtures: FirestoreFixtureDoc[]): number {
  if (comp.type === 'LEAGUE') {
    const teams = Number(comp.formatConfig?.totalClubs || (comp.leagueId === 'league-bundesliga' || comp.leagueId === 'league-ligue-1' ? 18 : 20));
    return teams - 1;
  }
  return Math.max(1, Number(comp.totalMatchdays || 1), ...fixtures.map(f => Number(f.matchday || 1)));
}
async function loadCompetition(competitionId: string) {
  const db = getFirestoreDb();
  const ref = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const doc = await ref.get();
  if (!doc.exists) throw new MatchdayControlError('COMPETITION_NOT_FOUND', 'Musobaqa topilmadi.', 404);
  const competition = { ...doc.data(), id: competitionId } as FirestoreCompetitionDoc;
  const fixtureDocs = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  const fixtures = fixtureDocs.docs.filter(d => !d.data().seasonId || d.data().seasonId === competition.seasonId).map(d => ({ ...d.data(), id: d.id } as FirestoreFixtureDoc));
  return { db, ref, competition, fixtures: filterRetiredFixtures(fixtures, competition.seasonId) };
}
export async function getCompetitionMatchdayControl(competitionId: string) {
  const { db, competition, fixtures } = await loadCompetition(competitionId);
  const lockDocs = await db.collection(COLLECTIONS.MATCHDAY_LOCKS).where('competitionId', '==', competitionId).get();
  const locks = new Map<number, FirestoreMatchdayLockDoc>();
  for (const doc of lockDocs.docs) {
    const lock = doc.data() as FirestoreMatchdayLockDoc;
    if (lock.seasonId === competition.seasonId) locks.set(lock.matchday, lock);
  }
  return {
    competitionId, currentMatchday: competition.currentMatchday || 1,
    updatedAt: competition.updatedAt || null,
    totalMatchdays: totalRounds(competition, fixtures),
    rounds: Array.from({ length: totalRounds(competition, fixtures) }, (_, index) => {
      const matchday = index + 1, lock = locks.get(matchday);
      const round = fixtures.filter(f => Number(f.matchday) === matchday);
      const explicit = resolveMatchdayGate(lock);
      const fallback = matchday === (competition.currentMatchday || 1) && competition.isMatchdayOpen !== false && !['FORCE_LOCKED', 'PAUSED'].includes(competition.adminOverrideStatus || '') && (!competition.nextMatchdayOpenAt || Date.parse(competition.nextMatchdayOpenAt) > Date.now());
      return { matchday, isOpen: explicit ?? fallback, deadlineAt: lock ? lock.expiresAt || null : matchday === (competition.currentMatchday || 1) ? competition.nextMatchdayOpenAt || null : null,
        fixtureCount: round.length, unfinished: round.filter(f => !finalStatuses.has(String(f.status))).map(f => ({ id: f.id, status: String(f.status) })) };
    }),
  };
}

export async function controlCompetitionMatchday(competitionId: string, params: {
  action: MatchdayAction; matchday: number; durationHours?: number; expectedUpdatedAt?: string | null; adminUserId?: string;
}) {
  if (!['SELECT', 'OPEN', 'LOCK', 'EXTEND', 'RESTART'].includes(params.action)) throw new MatchdayControlError('BAD_ACTION', 'Amal noto‘g‘ri.');
  if (!Number.isInteger(params.matchday) || params.matchday < 1) throw new MatchdayControlError('BAD_MATCHDAY', 'Tur butun musbat son bo‘lishi kerak.');
  const hours = params.durationHours ?? 30;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 720) throw new MatchdayControlError('BAD_DURATION', 'Muddat 0 dan katta va 720 soatdan oshmasligi kerak.');
  const { db, ref, competition, fixtures } = await loadCompetition(competitionId);
  const target = params.matchday, current = competition.currentMatchday || 1;
  if (target > totalRounds(competition, fixtures)) throw new MatchdayControlError('BAD_MATCHDAY', 'Bu tur musobaqada mavjud emas.');
  if (!fixtures.some(f => Number(f.matchday) === target)) throw new MatchdayControlError('MATCHDAY_EMPTY', `${target}-turda o‘yinlar yo‘q.`, 409);
  const seasonId = competition.seasonId;
  const key = (round: number) => `${seasonId}:${competitionId}:${round}`;
  const lockRef = db.collection(COLLECTIONS.MATCHDAY_LOCKS).doc(key(target));
  const nowMs = Date.now(), now = new Date(Math.max(nowMs, (Date.parse(competition.updatedAt || '') || 0) + 1)).toISOString();
  const result = await db.runTransaction(async tx => {
    const latest = await tx.get(ref);
    const selected = await tx.get(lockRef);
    if (!latest.exists) throw new MatchdayControlError('COMPETITION_NOT_FOUND', 'Musobaqa topilmadi.', 404);
    const comp = latest.data() as FirestoreCompetitionDoc;
    if ((comp.currentMatchday || 1) !== current || comp.updatedAt !== competition.updatedAt || (params.expectedUpdatedAt !== undefined && (comp.updatedAt || null) !== params.expectedUpdatedAt)) {
      throw new MatchdayControlError('MATCHDAY_CHANGED', 'Tur holati boshqa admin tomonidan o‘zgargan. Yangilab qayta urinib ko‘ring.', 409);
    }
    if (params.action === 'SELECT' && target > current) {
      const round = fixtures.filter(f => Number(f.matchday) >= current && Number(f.matchday) < target);
      if (!round.length) throw new MatchdayControlError('MATCHDAY_EMPTY', `Cannot advance: matchday ${current} has no fixtures.`, 409);
      for (let skipped = current; skipped < target; skipped++) if (!round.some(f => Number(f.matchday) === skipped)) throw new MatchdayControlError('MATCHDAY_EMPTY', `Cannot advance: matchday ${skipped} has no fixtures.`, 409);
      const fresh = await Promise.all(round.map(f => tx.get(db.collection(COLLECTIONS.FIXTURES).doc(f.id))));
      const unfinished = fresh.filter(d => d.exists && !finalStatuses.has(String(d.data()?.status))).map(d => ({ id: d.id, status: String(d.data()?.status) }));
      if (unfinished.length) throw new MatchdayControlError('MATCHDAY_UNFINISHED', `${current}-turda ${unfinished.length} ta tugamagan o‘yin bor. Natijalarni hal qiling yoki o‘yinni admin orqali keyinga qoldiring.`, 409, unfinished);
    }
    const previousLock = selected.exists ? selected.data() as FirestoreMatchdayLockDoc : null;
    const isOpen = params.action !== 'LOCK';
    const priorDeadline = previousLock?.expiresAt || (target === current ? comp.nextMatchdayOpenAt : undefined);
    if (params.action === 'EXTEND' && (resolveMatchdayGate(previousLock) ?? (target === current && comp.isMatchdayOpen !== false && !['FORCE_LOCKED', 'PAUSED'].includes(comp.adminOverrideStatus || ''))) === false) {
      throw new MatchdayControlError('MATCHDAY_LOCKED', 'Yopiq turning muddatini uzaytirib bo‘lmaydi. Avval turni oching.', 409);
    }
    const deadline = isOpen ? new Date((params.action === 'EXTEND' ? Math.max(nowMs, Date.parse(priorDeadline || '') || nowMs) : nowMs) + hours * 3600000).toISOString() : null;
    const lock: FirestoreMatchdayLockDoc = {
      id: key(target), seasonId, competitionId, matchday: target,
      overrideStatus: isOpen ? 'FORCE_OPEN' : 'FORCE_LOCKED', isOpen, isLocked: !isOpen,
      durationHours: hours, updatedAt: now,
      ...(isOpen ? { openedAt: params.action === 'EXTEND' ? previousLock?.openedAt || now : now, expiresAt: deadline! } : { lockedAt: now }),
      ...(params.adminUserId ? { updatedByUserId: params.adminUserId } : {}),
    };
    const changes: Partial<FirestoreCompetitionDoc> = { updatedAt: now };
    const locks = [lock];
    if (params.action === 'SELECT' && target !== current) {
      locks.push({ id: key(current), seasonId, competitionId, matchday: current, overrideStatus: 'FORCE_LOCKED', isOpen: false, isLocked: true, durationHours: hours, lockedAt: now, updatedAt: now, ...(params.adminUserId ? { updatedByUserId: params.adminUserId } : {}) });
      changes.currentMatchday = target;
    }
    if (target === current || params.action === 'SELECT') {
      Object.assign(changes, { isMatchdayOpen: isOpen, adminOverrideStatus: isOpen ? 'AUTO' : 'FORCE_LOCKED', matchdayDurationHours: hours, nextMatchdayOpenAt: deadline, ...(isOpen ? { matchdayOpenedAt: lock.openedAt } : {}) });
    }
    // All state is durable together; failures never report a successful local-only unlock.
    for (const item of locks) tx.set(db.collection(COLLECTIONS.MATCHDAY_LOCKS).doc(item.id), item);
    tx.update(ref, changes);
    tx.set(db.collection(COLLECTIONS.AUDIT_LOGS).doc(randomUUID()), { action: 'MATCHDAY_CONTROL', competitionId, seasonId, matchday: target, operation: params.action, adminUserId: params.adminUserId || null, previousMatchday: current, createdAt: now });
    return { competition: { ...comp, ...changes }, locks, deadlineAt: deadline };
  });
  await syncCompetitionMatchdayState(result.competition as FirestoreCompetitionDoc, result.locks);
  let channelPost: 'QUEUED' | 'EXISTS' | 'SKIPPED' | 'FAILED' = 'SKIPPED';
  if (['SELECT', 'OPEN', 'RESTART'].includes(params.action)) {
    try {
      const { enqueueMatchdayChannelPost } = await import('./matchdayChannelPost');
      channelPost = await enqueueMatchdayChannelPost({ competition: result.competition as any, fixtures: fixtures.map(f => ({ ...f, seasonId: f.seasonId || seasonId })) as any, matchday: target, deadlineAt: result.deadlineAt });
    } catch (error: any) {
      channelPost = 'FAILED';
      console.warn('[MATCHDAY_CHANNEL_ENQUEUE_FAILED]', { competitionId, matchday: target, reason: error?.message });
    }
  }
  return { success: true, competitionId, currentMatchday: result.competition.currentMatchday || 1, matchday: target, isMatchdayOpen: params.action !== 'LOCK', nextMatchdayOpenAt: result.deadlineAt, totalMatchdays: totalRounds(competition, fixtures), channelPost };
}
