import assert from 'node:assert/strict';
import { getFirestoreDb } from '../firebase/admin';
import { resolveDisputeAtomically } from '../services/disputeResolution';
import { assertAdminPlanReady } from '../services/telegramAiAdminPlanReadiness';

const db = getFirestoreDb();
const seed = async (id: string) => {
  await db.collection('fixtures').doc(id).set({ id, homeClubId: 'club-arsenal', awayClubId: 'club-chelsea', status: 'DISPUTED', homeScore: null, awayScore: null });
  await db.collection('result_submissions').doc(id + '-home').set({ fixtureId: id, clubId: 'club-arsenal', homeScore: 5, awayScore: 1 });
  await db.collection('result_submissions').doc(id + '-away').set({ fixtureId: id, clubId: 'club-chelsea', homeScore: 2, awayScore: 3 });
  await db.collection('disputes').doc(id).set({ fixtureId: id, status: 'OPEN', homeSubmissionId: id + '-home', awaySubmissionId: id + '-away' });
};
for (const [action, expected] of [['CONFIRM_HOME_SUBMISSION', [5, 1]], ['CONFIRM_AWAY_SUBMISSION', [2, 3]], ['MANUAL_SCORE', [0, 0]], ['CANCEL_MATCH', [null, null]]] as const) {
  const id = 'case-' + action;
  await seed(id);
  const result = await resolveDisputeAtomically(db, 'user-5209126900', id, { action, ...(action === 'MANUAL_SCORE' ? { manualHomeScore: 0, manualAwayScore: 0 } : {}) });
  const stored = (await db.collection('fixtures').doc(id).get()).data()!;
  assert.deepEqual([stored.homeScore, stored.awayScore], expected);
  assert.equal(stored.status, action === 'CANCEL_MATCH' ? 'POSTPONED' : 'CONFIRMED');
  assert.equal((await db.collection('disputes').doc(id).get()).data()?.status, 'RESOLVED');
  assert.equal((await db.collection('audit_logs').doc('audit_resolve_dispute_' + id).get()).exists, true);
  assert.equal(result.fixture.id, id);
  await assert.rejects(resolveDisputeAtomically(db, 'user-5209126900', id, { action: 'MANUAL_SCORE', manualHomeScore: 9, manualAwayScore: 0 }), /ALREADY_RESOLVED/);
  assert.deepEqual([(await db.collection('fixtures').doc(id).get()).data()?.homeScore, (await db.collection('fixtures').doc(id).get()).data()?.awayScore], expected);
}
for (const params of [{ action: 'MANUAL_SCORE' }, { action: 'MANUAL_SCORE', manualHomeScore: -1, manualAwayScore: 2 }, { action: 'MANUAL_SCORE', manualHomeScore: 1.5, manualAwayScore: 2 }]) {
  await seed('bad-manual');
  await assert.rejects(resolveDisputeAtomically(db, 'user-5209126900', 'bad-manual', params as any), /MANUAL_SCORE_REQUIRED/);
  assert.equal((await db.collection('fixtures').doc('bad-manual').get()).data()?.status, 'DISPUTED');
  assert.equal((await db.collection('disputes').doc('bad-manual').get()).data()?.status, 'OPEN');
}
await seed('race');
const raced = await Promise.allSettled([
  resolveDisputeAtomically(db, 'user-5209126900', 'race', {action:'CONFIRM_HOME_SUBMISSION'}),
  resolveDisputeAtomically(db, 'user-5209126900', 'race', {action:'CONFIRM_AWAY_SUBMISSION'}),
]);
assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
assert.equal(raced.filter(result => result.status === 'rejected').length, 1);
await seed('rollback');
let updates = 0;
const failingDb = { collection: db.collection.bind(db), runTransaction: (callback: any) => db.runTransaction(tx => callback(new Proxy(tx, {get(target, property) {
  if (property === 'update') return (...args: any[]) => { if (++updates === 2) throw new Error('injected-before-commit'); return (target.update as any)(...args); };
  const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
}}))) };
await assert.rejects(resolveDisputeAtomically(failingDb as any, 'user-5209126900', 'rollback', {action:'CONFIRM_HOME_SUBMISSION'}), /injected-before-commit/);
assert.equal((await db.collection('fixtures').doc('rollback').get()).data()?.status, 'DISPUTED');
assert.equal((await db.collection('disputes').doc('rollback').get()).data()?.status, 'OPEN');
assert.equal((await db.collection('audit_logs').doc('audit_resolve_dispute_rollback').get()).exists, false);
await seed('changed');
await db.collection('fixtures').doc('changed').update({status:'CONFIRMED',homeScore:4,awayScore:0});
await assert.rejects(resolveDisputeAtomically(db,'user-5209126900','changed',{action:'CONFIRM_HOME_SUBMISSION'}),/FIXTURE_CHANGED/);
assert.equal((await db.collection('fixtures').doc('changed').get()).data()?.homeScore,4);
await seed('foreign');
await db.collection('result_submissions').doc('foreign-home').update({ fixtureId: 'other-match' });
await assert.rejects(resolveDisputeAtomically(db, 'user-5209126900', 'foreign', { action: 'CONFIRM_HOME_SUBMISSION' }), /SUBMISSION_MISMATCH/);
assert.equal((await db.collection('fixtures').doc('foreign').get()).data()?.status, 'DISPUTED');
await seed('missing');
await db.collection('result_submissions').doc('missing-home').delete();
await assert.rejects(resolveDisputeAtomically(db, 'user-5209126900', 'missing', { action: 'CONFIRM_HOME_SUBMISSION' }), /SUBMISSION_MISMATCH/);
assert.throws(() => assertAdminPlanReady({ action: 'dispute_resolve', targetId: 'd', body: { action: 'MANUAL_SCORE' } }), /ikkala jamoa/);
console.log('PASS stored home/away submission selection, draw, postpone, missing/foreign proof rejection, explicit manual scores, atomic transaction result and duplicate decision rejection');
