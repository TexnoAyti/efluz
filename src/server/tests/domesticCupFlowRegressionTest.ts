process.env.FIREBASE_FORCE_LOCAL_FALLBACK = 'true';
process.env.NODE_ENV = 'test';

import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { advanceDomesticCupWinnerSafe } from '../tournament/domesticCupService';
import {
  advanceDomesticCupRoundSafe,
  getDomesticCupBracketHealth,
  reconcileDomesticCupSourceFixture,
  setDomesticCupRoundStateSafe,
} from '../tournament/domesticCupRoundOps';

const competitionId = 'comp-fa-cup-2026';
const seasonId = 'season-2026-27';
const sourceFixtureId = `fix-${competitionId}-r1-m0`;
const targetFixtureId = `fix-${competitionId}-r2-m4`;
const actor = { adminUserId: 'test-admin', adminUsername: 'cup-e2e-test' };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const db = getFirestoreDb();
  const now = new Date().toISOString();

  await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).set({
    id: competitionId,
    seasonId,
    name: 'FA Cup',
    type: 'DOMESTIC_CUP',
    currentMatchday: 1,
    isMatchdayOpen: false,
    status: 'active',
    updatedAt: now,
  });

  await db.collection(COLLECTIONS.FIXTURES).doc(sourceFixtureId).set({
    id: sourceFixtureId,
    competitionId,
    seasonId,
    matchday: 1,
    roundName: 'Play-in',
    homeClubId: 'club-arsenal',
    awayClubId: 'club-chelsea',
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    winnerClubId: null,
    resultConfirmedAt: null,
    scheduledAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).set({
    id: targetFixtureId,
    competitionId,
    seasonId,
    matchday: 2,
    roundName: 'Round of 16',
    homeClubId: 'club-liverpool',
    awayClubId: null,
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    winnerClubId: null,
    resultConfirmedAt: null,
    homeSourceFixtureId: null,
    awaySourceFixtureId: sourceFixtureId,
    scheduledAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // 1. Round control: explicitly open the play-in.
  const opened = await setDomesticCupRoundStateSafe(competitionId, 1, 'OPEN', actor);
  assert(opened.isOpen === true && opened.roundNumber === 1, 'Play-in did not open.');

  // 2. Confirm a result and prove winner advancement.
  await db.collection(COLLECTIONS.FIXTURES).doc(sourceFixtureId).update({
    status: 'CONFIRMED', homeScore: 2, awayScore: 0,
    winnerClubId: 'club-arsenal', resultConfirmedAt: now, updatedAt: now,
  });
  const advanced = await advanceDomesticCupWinnerSafe(sourceFixtureId, actor);
  assert(advanced.advanced === true && advanced.targetFixtureId === targetFixtureId, 'Winner was not advanced.');
  let target = (await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).get()).data();
  assert(target?.awayClubId === 'club-arsenal', 'Advanced winner is missing from target slot.');

  // 3. Reopen/correct source and prove stale winner cleanup.
  await db.collection(COLLECTIONS.FIXTURES).doc(sourceFixtureId).update({
    status: 'SCHEDULED', homeScore: null, awayScore: null,
    winnerClubId: null, resultConfirmedAt: null, updatedAt: new Date().toISOString(),
  });
  const cleanup = await reconcileDomesticCupSourceFixture(sourceFixtureId, {
    actorUserId: actor.adminUserId,
    actorUsername: actor.adminUsername,
    reason: 'e2e-reopen-proof',
  });
  assert(cleanup.domesticCup && cleanup.changed === 1 && cleanup.blocked === 0, 'Reopen did not clean stale progression.');
  target = (await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).get()).data();
  assert(target?.awayClubId == null, 'Stale winner remained after reopen.');

  // 4. Correct the result to the other club and prove re-advancement is deterministic.
  await db.collection(COLLECTIONS.FIXTURES).doc(sourceFixtureId).update({
    status: 'CONFIRMED', homeScore: 1, awayScore: 3,
    winnerClubId: 'club-chelsea', resultConfirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const readvanced = await advanceDomesticCupWinnerSafe(sourceFixtureId, actor);
  assert(readvanced.advanced === true, 'Corrected winner was not advanced.');
  target = (await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).get()).data();
  assert(target?.awayClubId === 'club-chelsea', 'Corrected winner did not replace the cleared slot.');

  // 5. Round completion opens the next round only after the source round is fully confirmed.
  const next = await advanceDomesticCupRoundSafe(competitionId, actor);
  assert(next.fromRound === 1 && next.toRound === 2, 'Round progression did not open Round 2.');
  const comp = (await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get()).data();
  assert(comp?.currentMatchday === 2 && comp?.isMatchdayOpen === true, 'Competition round state is inconsistent.');

  // 6. Bracket health must be clean after reconciliation and corrected advancement.
  const health = await getDomesticCupBracketHealth(competitionId);
  assert(health.healthy === true, `Bracket health failed: ${health.issues.map((i) => i.code).join(', ')}`);

  console.log('DOMESTIC CUP FLOW REGRESSION: PASS');
  console.log(JSON.stringify({
    openRound: opened.roundNumber,
    firstWinner: 'club-arsenal',
    staleCleanupChanged: cleanup.changed,
    correctedWinner: 'club-chelsea',
    nextRound: next.toRound,
    health: 'healthy',
  }, null, 2));
}

main().catch((error) => {
  console.error('DOMESTIC CUP FLOW REGRESSION: FAIL');
  console.error(error);
  process.exit(1);
});
