import assert from 'node:assert/strict';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { buildStandingsSnapshot, redisGetLkg, ReadModelKeys } from '../readModel/readModelStore';

async function main() {
  const db = getFirestoreDb();
  const competitionId = 'comp-premier-league-2026';
  const seasonId = 'season-2026-27';
  const key = ReadModelKeys.standings(competitionId, seasonId);
  await assert.rejects(buildStandingsSnapshot(competitionId, seasonId), /authoritative competition/);
  assert.equal(await redisGetLkg(key), null);

  const competition = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  await competition.set({ id: competitionId, seasonId: 'season-2025-26', type: 'LEAGUE' });
  await assert.rejects(buildStandingsSnapshot(competitionId, seasonId), /authoritative competition/);
  assert.equal(await redisGetLkg(key), null);

  await competition.update({ seasonId });
  const initialized = await buildStandingsSnapshot(competitionId, seasonId);
  assert.equal(initialized.data.length, 20);
  assert.ok(initialized.data.every(row => row.played === 0 && row.points === 0));
  await competition.delete();
  await assert.rejects(buildStandingsSnapshot(competitionId, seasonId), /preserve last-known-good/);
  assert.deepEqual((await redisGetLkg(key))?.data, initialized.data);
  console.log('PASS: missing/wrong-season competitions cannot publish standings; verified new competitions initialize; last-known-good survives missing source');
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
