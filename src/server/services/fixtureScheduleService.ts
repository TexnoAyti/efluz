import { isSeasonCompetitionEnabled } from '../../lib/seasonParticipationPolicy';
import { randomUUID } from 'node:crypto';
import type { User } from '../../types';
import { isLeagueAdmin, permittedAdminCompetitionIds } from '../../lib/adminPermissions';
import { getFirestoreDb } from '../firebase/admin';
import { normalizeFixtureSnapshot, invalidateFixtureReadModels } from '../readModel/readModelStore';
import { invalidateFirestoreCache } from '../firebase/firestoreStore';
import { upsertFixtureToSqlite } from '../db';
import { isRetiredFixture } from './retiredFixtureService';

export type ScheduleSelector = { seasonId: string; fixtureId?: string; competitionId?: string; category?: string; matchday?: number; includeCompleted?: boolean };
export type ScheduleExpected = { id: string; updatedAt: string | null; scheduledAt: string; status: string };
const closed = new Set(['CONFIRMED', 'CANCELLED']);
function fail(code: string, statusCode: number): never { throw Object.assign(new Error(code), { code, statusCode }); }
function signature(f: any): ScheduleExpected { return { id: f.id, updatedAt: f.updatedAt ?? null, scheduledAt: f.scheduledAt ?? '', status: f.status }; }
function same(a: ScheduleExpected, b: ScheduleExpected) { return a.id === b.id && a.updatedAt === b.updatedAt && a.scheduledAt === b.scheduledAt && a.status === b.status; }

export async function previewFixtureSchedule(user: User, selector: ScheduleSelector) {
  const db = getFirestoreDb();
  const scoped = isLeagueAdmin(user) ? new Set(permittedAdminCompetitionIds(user)) : null;
  const competitions = await db.collection('competitions').where('seasonId', '==', selector.seasonId).get();
  const allowed = new Set(competitions.docs.map(doc => ({id:doc.id, ...doc.data()} as any)).filter(c =>
    isSeasonCompetitionEnabled(c.id,selector.seasonId) && (!scoped || scoped.has(c.id)) && (!selector.competitionId || c.id === selector.competitionId) &&
    (!selector.category || selector.category === 'ALL' || (selector.category === 'EUROPEAN' ? ['EUROPEAN_KNOCKOUT','EUROPEAN_LEAGUE_PHASE'].includes(c.type) : (selector.category === 'KNOCKOUT' ? ['KNOCKOUT','DOMESTIC_CUP'].includes(c.type) : c.type === selector.category)))
  ).map(c => c.id));
  if (selector.competitionId && scoped && !scoped.has(selector.competitionId)) fail('ADMIN_SCOPE_FORBIDDEN',403);
  let rows: any[];
  if (selector.fixtureId) {
    const doc = await db.collection('fixtures').doc(selector.fixtureId).get();
    if (!doc.exists) fail('FIXTURE_NOT_FOUND',404);
    const row = { ...doc.data(), id:doc.id } as any;
    if (scoped && !scoped.has(row.competitionId)) fail('ADMIN_SCOPE_FORBIDDEN',403);
    if (row.seasonId !== selector.seasonId) fail('FIXTURE_SEASON_MISMATCH',409);
    rows = allowed.has(row.competitionId) ? [row] : [];
  } else {
    // Query the selected season only; avoid unrelated season reads and writes.
    const snapshot = selector.competitionId
      ? await db.collection('fixtures').where('competitionId','==',selector.competitionId).where('seasonId','==',selector.seasonId).get()
      : await db.collection('fixtures').where('seasonId','==',selector.seasonId).get();
    rows = snapshot.docs.map(doc => ({...doc.data(),id:doc.id}));
  }
  const fixtures = rows.filter(f => allowed.has(f.competitionId) && (!selector.matchday || f.matchday === selector.matchday) && (selector.includeCompleted || !closed.has(f.status)) && !isRetiredFixture(f.id,f.seasonId))
    .sort((a,b) => a.competitionId.localeCompare(b.competitionId) || a.matchday-b.matchday || a.id.localeCompare(b.id));
  return { fixtures: fixtures.map(f => normalizeFixtureSnapshot(f,selector.seasonId)), expected: fixtures.map(signature), count:fixtures.length, timeZone:'Asia/Tashkent' };
}

export async function updateFixtureSchedule(user: User, selector: ScheduleSelector, scheduledAt: string | null, expected: ScheduleExpected[], venue?: string | null) {
  const preview = await previewFixtureSchedule(user,selector);
  if (!preview.count) fail('NO_EDITABLE_FIXTURES',409);
  const expectedMap = new Map(expected.map(f => [f.id,f]));
  if (expectedMap.size !== expected.length || preview.count !== expected.length || preview.expected.some(f => !expectedMap.has(f.id) || !same(f,expectedMap.get(f.id)!))) fail('SCHEDULE_PREVIEW_CHANGED',409);
  if (venue !== undefined && !selector.fixtureId) fail('VENUE_REQUIRES_SINGLE_FIXTURE',400);
  const db = getFirestoreDb();
  const savedAt = new Date().toISOString();
  const operationId = randomUUID();
  const changed: any[] = [];
  const competitions = new Set<string>();
  try {
    // Firestore's write limit is 500: each chunk writes <= 401 documents.
    for (let offset=0;offset<preview.expected.length;offset+=200) {
      const chunk = preview.expected.slice(offset,offset+200);
      const saved = await db.runTransaction(async tx => {
        const docs = await Promise.all(chunk.map(f => tx.get(db.collection('fixtures').doc(f.id))));
        const rows = docs.map((doc,index) => {
          if (!doc.exists) fail('SCHEDULE_PREVIEW_CHANGED',409);
          const row = {...doc.data(),id:doc.id} as any;
          if (row.seasonId !== selector.seasonId || row.competitionId !== preview.fixtures.find(f=>f.id===row.id)?.competitionId || (!selector.includeCompleted && closed.has(row.status)) || !same(signature(row),chunk[index])) fail('SCHEDULE_PREVIEW_CHANGED',409);
          return row;
        });
        const next = rows.map(row => ({...row,scheduledAt:scheduledAt || '',adminScheduledAt:scheduledAt || '',...(venue !== undefined ? {venue:venue?.trim() || null} : {}),updatedAt:savedAt}));
        next.forEach(row => {
          tx.update(db.collection('fixtures').doc(row.id),{scheduledAt:row.scheduledAt,adminScheduledAt:row.adminScheduledAt,...(venue !== undefined ? {venue:row.venue} : {}),updatedAt:savedAt});
          tx.set(db.collection('durable_fixture_overrides').doc(row.id),JSON.parse(JSON.stringify(normalizeFixtureSnapshot(row,selector.seasonId))));
        });
        tx.set(db.collection('audit_logs').doc(`schedule_${operationId}_${offset}`),{id:`schedule_${operationId}_${offset}`,actorUserId:user.id,action:'ADMIN_SCHEDULE_FIXTURES',entityType:'fixture_schedule',entityId:selector.fixtureId || selector.competitionId || selector.category || 'ALL',oldValueJson:JSON.stringify(rows.map(r=>({...signature(r),venue:r.venue??null}))),newValueJson:JSON.stringify(next.map(r=>({...signature(r),venue:r.venue??null}))),createdAt:savedAt});
        return next;
      });
      changed.push(...saved);
      for (const row of saved) { competitions.add(row.competitionId); try { upsertFixtureToSqlite(row); } catch {} }
    }
  } catch (error: any) {
    if (!changed.length) throw error;
    return { success:false,partial:true,updated:changed.length,total:preview.count,scheduledAt:scheduledAt || '',error:error.code || 'SCHEDULE_UPDATE_FAILED' };
  } finally {
    if (changed.length) {
      invalidateFirestoreCache();
      await Promise.allSettled([...competitions].map(id=>invalidateFixtureReadModels(id,selector.seasonId)));
    }
  }
  return { success:true,partial:false,updated:changed.length,total:preview.count,scheduledAt:scheduledAt || '',venue:venue === undefined ? undefined : venue?.trim() || null };
}
