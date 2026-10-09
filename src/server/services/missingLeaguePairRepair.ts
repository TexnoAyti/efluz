import { getFirestoreDb } from '../firebase/admin';
import { invalidateFirestoreCache } from '../firebase/firestoreStore';
import { COLLECTIONS } from '../firebase/collections';
import { buildAdminFixturesSnapshot } from '../readModel/readModelStore';
import { restoreFixtureTombstone, refreshDerivedCompetitionState } from './fixtureTombstoneService';

export const MISSING_LEAGUE_PAIRS = [
  { competitionId: 'comp-serie-a-2026', round: 18, clubs: ['club-bologna', 'club-venezia'], slugs: ['bologna', 'venezia'] },
  { competitionId: 'comp-bundesliga-2026', round: 1, clubs: ['club-bochum', 'club-union-berlin'], slugs: ['bochum', 'union-berlin'] },
];
const seasonId = 'season-2026-27';
export function isOriginalMissingPair(data: any, pair: typeof MISSING_LEAGUE_PAIRS[number]): boolean {
  return data?.seasonId === seasonId && data.competitionId === pair.competitionId && Number(data.matchday) === pair.round &&
    pair.clubs.includes(data.homeClubId) && pair.clubs.includes(data.awayClubId) && data.homeClubId !== data.awayClubId;
}

// Explicit authenticated admin action only. Never run on startup or public reads.
export async function restoreMissingLeaguePairs(adminId: string) {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore unavailable');
  const results: { competitionId: string; status: string; message?: string }[] = [];
  for (const pair of MISSING_LEAGUE_PAIRS) {
    try {
      const current = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', pair.competitionId).get();
      const present = current.docs.find(doc => {
        const data = doc.data();
        return data.seasonId === seasonId && pair.clubs.includes(data.homeClubId) && pair.clubs.includes(data.awayClubId) && data.homeClubId !== data.awayClubId;
      });
      if (present) {
        if (!isOriginalMissingPair(present.data(), pair)) throw new Error('Bu juftlik boshqa turda mavjud; dublikat yaratilmaydi.');
        await restoreFixtureTombstone(present.id, seasonId, adminId);
        results.push({ competitionId: pair.competitionId, status: 'already_present' });
        continue;
      }
      const candidates: any[] = [];
      for (const [home, away] of [pair.slugs, [...pair.slugs].reverse()]) {
        const id = `fix-${pair.competitionId}-md${pair.round}-${home}-vs-${away}`;
        const audit = await db.collection(COLLECTIONS.AUDIT_LOGS).doc(`audit_ADMIN_DELETE_FIXTURE_fixture_${id}`).get();
        if (!audit.exists) continue;
        const record = audit.data()!;
        const original = JSON.parse(record.oldValueJson || 'null');
        if (record.action === 'ADMIN_DELETE_FIXTURE' && record.entityId === id && original?.id === id && isOriginalMissingPair(original, pair)) candidates.push(original);
      }
      if (candidates.length !== 1) throw new Error('Asl uchrashuv auditda aniq topilmadi; avtomatik yangi o‘yin yaratilmaydi.');
      const original = candidates[0];
      await db.runTransaction(async transaction => {
        const ref = db.collection(COLLECTIONS.FIXTURES).doc(original.id);
        if (!(await transaction.get(ref)).exists) transaction.set(ref, original);
      });
      await restoreFixtureTombstone(original.id, seasonId, adminId);
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(`audit_ADMIN_RESTORE_FIXTURE_fixture_${original.id}`).set({
        id: `audit_ADMIN_RESTORE_FIXTURE_fixture_${original.id}`, action: 'ADMIN_RESTORE_FIXTURE', entityType: 'fixture', entityId: original.id,
        actorUserId: adminId, newValueJson: JSON.stringify(original), createdAt: new Date().toISOString(),
      });
      results.push({ competitionId: pair.competitionId, status: 'restored' });
    } catch (err: any) { results.push({ competitionId: pair.competitionId, status: 'error', message: err.message }); }
  }
  if (results.some(result => result.status !== 'error')) {
    invalidateFirestoreCache('firestore:fixtures');
    invalidateFirestoreCache('firestore:admin');
    await buildAdminFixturesSnapshot(seasonId);
    for (const result of results.filter(result => result.status !== 'error')) await refreshDerivedCompetitionState(result.competitionId, seasonId);
  }
  return { results };
}
