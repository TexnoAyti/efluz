import { randomUUID } from 'node:crypto';
import { isLeagueSelectionOpen } from '../../lib/clubAdmission';
import { trackFirestoreRead } from '../firebase/firestoreStore';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { SEED_LEAGUES } from '../db/seed';
import { ReadModelKeys, ReadModelNotWarmedError, redisGetFresh, redisGetLkg, redisSetRaw } from '../readModel/readModelStore';

export const CLUB_ADMISSION_LEAGUES = SEED_LEAGUES.map(({ id, name }) => ({ id, name }));
const COLLECTION = 'club_admissions';
const ADMISSION_CACHE_TTL_SECONDS = 300;
const pendingStatusReads = new Map<string, Promise<ClubAdmissionStatus>>();

export interface ClubAdmissionStatus {
  seasonId: string;
  enabled: boolean;
  stage: number;
  activeLeagueId: string | null;
  leagues: typeof CLUB_ADMISSION_LEAGUES;
  updatedAt: string | null;
  stale?: boolean;
  leagueOverrides: Record<string, boolean>;
  revision: string | null;
}

export class ClubAdmissionConflict extends Error {
  constructor(public readonly code: 'ADMISSION_STAGE_CHANGED' | 'ADMISSION_FINISHED' | 'ADMISSION_STATE_CHANGED') {
    super(code === 'ADMISSION_FINISHED' ? 'Klub qabuli yakunlangan.' : 'Qabul holati o‘zgargan. Sahifani yangilang.');
  }
}

export function admissionStatus(seasonId: string, data?: Record<string, unknown>): ClubAdmissionStatus {
  const enabled = data?.enabled === true;
  const rawStage = Number(data?.stage);
  if (enabled && (!Number.isInteger(rawStage) || rawStage < 0 || rawStage > CLUB_ADMISSION_LEAGUES.length)) {
    throw new Error('INVALID_CLUB_ADMISSION_STATE');
  }
  const stage = enabled ? rawStage : -1;
  return {
    seasonId,
    enabled,
    stage,
    activeLeagueId: stage >= 0 ? CLUB_ADMISSION_LEAGUES[stage]?.id || null : null,
    leagues: CLUB_ADMISSION_LEAGUES,
    leagueOverrides: Object.fromEntries(CLUB_ADMISSION_LEAGUES.filter(league => typeof (data?.leagueOverrides as any)?.[league.id] === 'boolean').map(league => [league.id, (data!.leagueOverrides as Record<string, boolean>)[league.id]])),
    revision: typeof data?.revision === 'string' ? data.revision : typeof data?.updatedAt === 'string' ? data.updatedAt : null,
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : null,
  };
}

export async function getClubAdmissionStatus(seasonId: string): Promise<ClubAdmissionStatus> {
  const pending = pendingStatusReads.get(seasonId);
  if (pending) return pending;
  const read = loadClubAdmissionStatus(seasonId);
  pendingStatusReads.set(seasonId, read);
  try {
    return await read;
  } finally {
    if (pendingStatusReads.get(seasonId) === read) pendingStatusReads.delete(seasonId);
  }
}

async function loadClubAdmissionStatus(seasonId: string): Promise<ClubAdmissionStatus> {
  const key = ReadModelKeys.clubAdmission(seasonId);
  const fresh = await redisGetFresh<ClubAdmissionStatus>(key);
  if (fresh?.data) {
    return { ...admissionStatus(seasonId, fresh.data as unknown as Record<string, unknown>), stale: !firestoreCircuitBreaker.isHealthy() };
  }

  const lastKnown = async () => {
    const snapshot = await redisGetLkg<ClubAdmissionStatus>(key);
    return snapshot?.data ? { ...admissionStatus(seasonId, snapshot.data as unknown as Record<string, unknown>), stale: true } : null;
  };
  // Every admission mutation publishes this durable snapshot. A cached UI status
  // must not probe an exhausted database on each cold server; claims revalidate in a transaction.
  const saved = await lastKnown();
  if (saved) return saved;
  if (!firestoreCircuitBreaker.canExecute()) {
    const cached = await lastKnown();
    if (cached) return cached;
    throw new ReadModelNotWarmedError('Club admission state is not cached while Firestore is unavailable.');
  }

  let status: ClubAdmissionStatus;
  try {
    const doc = await getFirestoreDb().collection(COLLECTION).doc(seasonId).get();
    trackFirestoreRead(COLLECTION, 1, 'getClubAdmissionStatus');
    status = admissionStatus(seasonId, doc.data());
    firestoreCircuitBreaker.recordSuccess();
  } catch (error) {
    firestoreCircuitBreaker.recordFailure(error);
    const cached = await lastKnown();
    if (cached) return cached;
    throw new ReadModelNotWarmedError('Club admission state is not cached and Firestore could not be read.');
  }

  try {
    await redisSetRaw(key, { data: status, sourceVersion: `club-admission-${status.updatedAt || 'disabled'}` }, ADMISSION_CACHE_TTL_SECONDS);
  } catch (error) {
    console.warn('[CLUB_ADMISSION] Could not cache admission state:', error);
  }
  return status;
}

// Both admin transitions and claims read the same document in Firestore transactions.
// A concurrent stage change therefore retries a claim against the new stage.
export async function advanceClubAdmission(seasonId: string, expectedStage: number, actorId: string): Promise<ClubAdmissionStatus> {
  const db = getFirestoreDb();
  const ref = db.collection(COLLECTION).doc(seasonId);
  const status = await db.runTransaction(async (transaction) => {
    const current = admissionStatus(seasonId, (await transaction.get(ref)).data());
    if (current.stage !== expectedStage) throw new ClubAdmissionConflict('ADMISSION_STAGE_CHANGED');
    if (current.stage >= CLUB_ADMISSION_LEAGUES.length) throw new ClubAdmissionConflict('ADMISSION_FINISHED');
    const stage = current.stage + 1;
    const updatedAt = new Date().toISOString();
    const revision = randomUUID();
    transaction.set(ref, { seasonId, enabled: true, stage, updatedAt, revision, updatedBy: actorId });
    return admissionStatus(seasonId, { enabled: true, stage, updatedAt, revision });
  });
  try {
    await redisSetRaw(ReadModelKeys.clubAdmission(seasonId), { data: status, sourceVersion: `club-admission-${status.updatedAt}` }, ADMISSION_CACHE_TTL_SECONDS);
  } catch (error) {
    // The Firestore transaction has committed; a cache failure must not report the mutation as failed.
    console.warn('[CLUB_ADMISSION] Stage changed but cache update failed:', error);
  }
  return status;
}

export async function setLeagueClubSelection(seasonId: string, leagueId: string, open: boolean, expectedRevision: string | null, actorId: string): Promise<ClubAdmissionStatus> {
  if (!CLUB_ADMISSION_LEAGUES.some(league => league.id === leagueId) || typeof open !== 'boolean') throw new Error('INVALID_LEAGUE_SELECTION');
  const db = getFirestoreDb();
  const ref = db.collection(COLLECTION).doc(seasonId);
  const status = await db.runTransaction(async transaction => {
    const current = admissionStatus(seasonId, (await transaction.get(ref)).data());
    if (current.revision !== expectedRevision) throw new ClubAdmissionConflict('ADMISSION_STATE_CHANGED');
    const data = { seasonId, enabled: current.enabled, stage: current.stage, leagueOverrides: { ...current.leagueOverrides, [leagueId]: open }, updatedAt: new Date().toISOString(), revision: randomUUID(), updatedBy: actorId };
    transaction.set(ref, data);
    return admissionStatus(seasonId, data);
  });
  try {
    await redisSetRaw(ReadModelKeys.clubAdmission(seasonId), { data: status, sourceVersion: `club-admission-${status.revision}` }, ADMISSION_CACHE_TTL_SECONDS);
  } catch (error) {
    console.warn('[CLUB_ADMISSION] League selection changed but cache update failed:', error);
  }
  return status;
}

export function assertClubAdmissionOpen(status: ClubAdmissionStatus, leagueId: string): void {
  if (!isLeagueSelectionOpen(status, leagueId)) {
    throw new ClubAdmissionConflictError('Bu liga uchun klub tanlash admin tomonidan yopilgan.');
  }
}

export class ClubAdmissionConflictError extends Error {
  readonly code = 'CLUB_ADMISSION_CLOSED';
}
