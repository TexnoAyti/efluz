import { assertSeasonCompetitionEnabled } from '../../lib/seasonParticipationPolicy';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { isLeagueAdmin, permittedAdminCompetitionIds } from '../../lib/adminPermissions';
import { filterRetiredFixtures } from './retiredFixtureService';
import { SEED_CLUBS } from '../db/seed';
import type { User } from '../../types';

export const bulkLeagueResultSchema = z.object({
  seasonId: z.string().regex(/^season-\d{4}-\d{2}$/),
  fromMatchday: z.coerce.number().int().min(1).max(38).default(1),
  toMatchday: z.coerce.number().int().min(1).max(38),
  homeScore: z.coerce.number().int().min(0).max(99),
  awayScore: z.coerce.number().int().min(0).max(99),
}).strict().refine(p => p.fromMatchday <= p.toMatchday, 'Invalid round range');
export const bulkLeagueApplySchema = bulkLeagueResultSchema.safeExtend({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/), expectedCount: z.number().int().min(1).max(120),
});
type Selection = z.infer<typeof bulkLeagueResultSchema>;
const fail = (message: string, statusCode = 409): never => { throw Object.assign(new Error(message), { statusCode }); };
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Authoritative, bounded transaction reads. Submitted, disputed, scored and
 * retired fixtures never count as unplayed. No read-model or offline fallback. */
async function selection(tx: any, competitionId: string, p: Selection) {
  assertSeasonCompetitionEnabled(competitionId,p.seasonId);
  const db = getFirestoreDb();
  const comp = await tx.get(db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId));
  if (!comp.exists || comp.data().type !== 'LEAGUE' || comp.data().seasonId !== p.seasonId)
    fail('Faqat tanlangan mavsumdagi liga o‘yinlariga ommaviy natija beriladi.', 400);
  const season = await tx.get(db.collection(COLLECTIONS.SEASONS).doc(p.seasonId));
  if (!season.exists || season.data().status !== 'ACTIVE') fail('Faqat faol mavsumdagi o‘yinlar bilan ishlash mumkin.');
  const snapshot = await tx.get(db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).where('seasonId', '==', p.seasonId).limit(1001));
  if (snapshot.size > 1000) fail('Ro‘yxat juda katta. Amalni kichikroq turnir doirasida bajaring.');
  const rows = filterRetiredFixtures(snapshot.docs.map((d: any) => ({ ...d.data(), id: d.id })))
    .filter((f: any) => Number.isInteger(f.matchday) && f.matchday >= p.fromMatchday && f.matchday <= p.toMatchday)
    .sort((a: any, b: any) => a.matchday - b.matchday || a.id.localeCompare(b.id)) as any[];
  const protectedIds = new Set<string>();
  for (let i = 0; i < rows.length; i += 30) {
    const ids = rows.slice(i, i + 30).map(f => f.id);
    for (const collection of [COLLECTIONS.RESULT_SUBMISSIONS, COLLECTIONS.DISPUTES]) {
      const records = await tx.get(db.collection(collection).where('fixtureId', 'in', ids).limit(1001));
      if (records.size > 1000) fail('Natija arizalari to‘liq o‘qilmadi. Amal bajarilmadi.');
      for (const doc of records.docs) protectedIds.add(doc.data().fixtureId);
    }
  }
  const eligible = rows.filter(f => ['SCHEDULED', 'POSTPONED'].includes(f.status) &&
    ['homeScore','awayScore','homeExtraTimeScore','awayExtraTimeScore','homePenaltyScore','awayPenaltyScore','winnerClubId','resultConfirmedAt'].every(k => f[k] == null) &&
    f.homeClubId && f.awayClubId && f.homeClubId !== f.awayClubId && ![f.homeClubId, f.awayClubId].some(id => /^(?:TBD|BYE)$/i.test(id)) && !protectedIds.has(f.id));
  if (eligible.length > 120) fail('120 tadan ko‘p o‘yin tanlandi. Tur oralig‘ini kichraytiring.', 400);
  const previewHash = hash([competitionId, p, rows.map(f => [f.id,f.matchday,f.homeClubId,f.awayClubId,f.status,f.homeScore??null,f.awayScore??null,f.updatedAt??null,eligible.some(e=>e.id===f.id)])]);
  const rounds: Record<string, number> = {};
  for (const f of eligible) rounds[f.matchday] = (rounds[f.matchday] || 0) + 1;
  const names = new Map(SEED_CLUBS.map(c => [c.id, c.name]));
  return { eligible, previewHash, competitionName: String(comp.data().name || competitionId), count: eligible.length, skipped: rows.length - eligible.length, rounds,
    sample: eligible.slice(0, 4).map(f => `${f.matchday}-tur: ${names.get(f.homeClubId) || f.homeClubId} — ${names.get(f.awayClubId) || f.awayClubId}`) };
}
function authorize(user: User, competitionId: string) {
  if (!user.isAdmin || user.isSuspended || isLeagueAdmin(user) && !permittedAdminCompetitionIds(user).includes(competitionId)) fail('Bu liga uchun admin ruxsati yo‘q.', 403);
  if (process.env.DATABASE_PROVIDER !== 'supabase' || process.env.MIGRATION_WRITE_FREEZE === 'true') fail('Ommaviy natija uchun asosiy PostgreSQL bazasi faol bo‘lishi kerak.', 503);
}
export async function previewBulkLeagueResults(user: User, competitionId: string, input: unknown) {
  authorize(user, competitionId);
  const p = bulkLeagueResultSchema.parse(input);
  const { eligible, ...preview } = await getFirestoreDb().runTransaction(tx => selection(tx, competitionId, p));
  return { success: true, ...preview, fixtures: eligible.map(f => ({id:f.id,matchday:f.matchday,homeClubId:f.homeClubId,awayClubId:f.awayClubId})) };
}
export async function applyBulkLeagueResults(user: User, competitionId: string, input: unknown, operationId: string) {
  authorize(user, competitionId);
  const { previewHash, expectedCount, ...p } = bulkLeagueApplySchema.parse(input);
  if (!operationId || operationId.length > 200) fail('Amal uchun idempotency kodi kerak.', 400);
  const db = getFirestoreDb(), receiptRef = db.collection('bulk_result_receipts').doc(hash([user.id, operationId]));
  const requestHash = hash([competitionId, p, previewHash, expectedCount]);
  return db.runTransaction(async tx => {
    // Recheck the account in the same transaction as the results.
    const actor = await tx.get(db.collection(COLLECTIONS.USERS).doc(user.id));
    if (!actor.exists) fail('Admin akkaunti topilmadi.', 403);
    authorize({ ...actor.data(), id: user.id } as User, competitionId);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data()!.requestHash !== requestHash) fail('Amal kodi boshqa topshiriq uchun ishlatilgan.');
      return { ...receipt.data()!.result, replayed: true };
    }
    const selected = await selection(tx, competitionId, p);
    if (selected.previewHash !== previewHash || selected.count !== expectedCount) fail('O‘yinlar taklifdan keyin o‘zgargan. Hech narsa yozilmadi; yangi reja tayyorlang.');
    const now = new Date().toISOString(), version = hash([operationId, requestHash]);
    for (const f of selected.eligible) {
      const changed = { status: 'CONFIRMED', homeScore: p.homeScore, awayScore: p.awayScore, homeExtraTimeScore: null, awayExtraTimeScore: null, homePenaltyScore: null, awayPenaltyScore: null,
        winnerClubId: p.homeScore === p.awayScore ? null : p.homeScore > p.awayScore ? f.homeClubId : f.awayClubId, resultConfirmedAt: now, updatedAt: now };
      const fixture = { ...f, ...changed };
      tx.update(db.collection(COLLECTIONS.FIXTURES).doc(f.id), changed);
      tx.set(db.collection('durable_fixture_overrides').doc(f.id), fixture);
      tx.set(db.collection(COLLECTIONS.AUDIT_LOGS).doc(`bulk_${version}_${hash(f.id).slice(0,20)}`), { id:`bulk_${version}_${hash(f.id).slice(0,20)}`,actorUserId:user.id,actorUsername:user.username||null,action:'ADMIN_BULK_SET_RESULT',entityType:'fixture',entityId:f.id,oldValueJson:JSON.stringify({status:f.status,homeScore:null,awayScore:null}),newValueJson:JSON.stringify(changed),notes:`Bulk league results ${p.fromMatchday}-${p.toMatchday}; ${operationId}`,createdAt:now });
      tx.set(db.collection('result_refresh_jobs').doc(f.id), { fixtureId:f.id,competitionId,seasonId:p.seasonId,version:now,status:'pending',leaseUntil:0,notifyResult:true,notificationActorId:user.id,notificationVersion:version,notificationFixture:fixture });
    }
    const result = { success:true,authoritative:true,appliedCount:selected.count,competitionId,seasonId:p.seasonId,fromMatchday:p.fromMatchday,toMatchday:p.toMatchday,homeScore:p.homeScore,awayScore:p.awayScore,previewHash,derivedPending:true };
    tx.set(receiptRef, {requestHash,result,createdAt:now,actorUserId:user.id});
    return result;
  });
}
