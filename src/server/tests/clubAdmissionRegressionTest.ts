import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { seedDatabase } from '../db/seed';
import { claimClubAtomicFirestore } from '../firebase/firestoreStore';
import { advanceClubAdmission, getClubAdmissionStatus } from '../services/clubAdmission';

async function run() {
  await initDatabase();
  seedDatabase();
  const seasonId = 'season-2026-27';
  let status = await getClubAdmissionStatus(seasonId);
  assert.equal(status.enabled, false, 'existing seasons retain open selection until an admin starts stages');

  status = await advanceClubAdmission(seasonId, -1, 'admin-test');
  assert.equal(status.activeLeagueId, 'league-premier-league');
  await assert.rejects(() => advanceClubAdmission(seasonId, -1, 'admin-test'), (err: any) => err.code === 'ADMISSION_STAGE_CHANGED');
  await assert.rejects(
    () => claimClubAtomicFirestore('user-admission-rejected', 'club-real-madrid', seasonId, { authoritativeOnly: true }),
    (err: any) => err.code === 'CLUB_ADMISSION_CLOSED',
  );
  await claimClubAtomicFirestore('user-admission-pl', 'club-arsenal', seasonId, { authoritativeOnly: true });

  status = await advanceClubAdmission(seasonId, 0, 'admin-test');
  assert.equal(status.activeLeagueId, 'league-la-liga');
  await claimClubAtomicFirestore('user-admission-pl', 'club-arsenal', seasonId, { authoritativeOnly: true }); // existing owner stays valid
  await assert.rejects(
    () => claimClubAtomicFirestore('user-admission-rejected', 'club-chelsea', seasonId, { authoritativeOnly: true }),
    (err: any) => err.code === 'CLUB_ADMISSION_CLOSED',
  );
  await claimClubAtomicFirestore('user-admission-la-liga', 'club-real-madrid', seasonId, { authoritativeOnly: true });

  for (let stage = 1; stage < status.leagues.length; stage++) status = await advanceClubAdmission(seasonId, stage, 'admin-test');
  assert.equal(status.activeLeagueId, null);
  await assert.rejects(() => claimClubAtomicFirestore('user-admission-final', 'club-barcelona', seasonId, { authoritativeOnly: true }), (err: any) => err.code === 'CLUB_ADMISSION_CLOSED');
  console.log('Club admission stages regression: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
