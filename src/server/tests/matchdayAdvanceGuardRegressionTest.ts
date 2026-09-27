process.env.FIREBASE_FORCE_LOCAL_FALLBACK = 'true';
process.env.NODE_ENV = 'test';

import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { advanceCompetitionMatchdayFirestore } from '../firebase/firestoreStore';

async function main() {
  const db = getFirestoreDb();
  const competitionId = 'comp-premier-league-2026';
  const seasonId = 'season-2026-27';
  const comp = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const fixtures = db.collection(COLLECTIONS.FIXTURES);
  await comp.set({ id: competitionId, type: 'LEAGUE', seasonId, currentMatchday: 1, totalMatchdays: 19 });
  await fixtures.doc('matchday-guard-a').set({ competitionId, seasonId, matchday: 1, status: 'SCHEDULED' });
  await fixtures.doc('matchday-guard-b').set({ competitionId, seasonId, matchday: 1, status: 'POSTPONED' });

  await assertRejects('remain unfinished', () => advanceCompetitionMatchdayFirestore(competitionId));
  if ((await comp.get()).data()?.currentMatchday !== 1) throw new Error('Blocked advance changed matchday');
  await fixtures.doc('matchday-guard-a').update({ status: 'CONFIRMED' });
  const result = await advanceCompetitionMatchdayFirestore(competitionId);
  if (result.currentMatchday !== 2) throw new Error('Confirmed + postponed round did not advance');
  await assertRejects('no fixtures', () => advanceCompetitionMatchdayFirestore(competitionId));

  await comp.update({ currentMatchday: 19, totalMatchdays: 38 });
  await assertRejects('no next league matchday', () => advanceCompetitionMatchdayFirestore(competitionId));
  if ((await comp.get()).data()?.currentMatchday !== 19) throw new Error('Final matchday was changed');
  console.log('MATCHDAY_ADVANCE_GUARD_REGRESSION_PASS');
}

async function assertRejects(fragment: string, action: () => Promise<unknown>) {
  try { await action(); } catch (error: any) {
    if (String(error?.message).includes(fragment)) return;
    throw error;
  }
  throw new Error(`Expected rejection: ${fragment}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
