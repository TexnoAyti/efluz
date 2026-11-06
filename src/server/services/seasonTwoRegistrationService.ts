import { getFirestoreDb } from '../firebase/admin';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { S2_OPENS_AT } from '../../lib/seasonTwoAdmissionWindow';
import { publishAdmissionStatus } from './clubAdmission';

const TARGET = EFL_SECOND_SEASON.id;
const SOURCE = EFL_SECOND_SEASON.sourceSeasonId;

/** Idempotent database activation. Never runs from preview, staging or local environments. */
export async function activateSecondSeasonRegistration(actorId = 'AUTO_SCHEDULE_20261106') {
  const db = getFirestoreDb();
  const result = await db.runTransaction(async tx => {
    const seasonRef = db.collection('seasons').doc(TARGET);
    const admissionRef = db.collection('club_admissions').doc(TARGET);
    const [season, admission] = await Promise.all([tx.get(seasonRef), tx.get(admissionRef)]);
    if (season.data()?.registrationOpen === true && ['registration','active'].includes(String(season.data()?.status).toLowerCase())) return { alreadyActive: true, admissionData: null };
    if (season.exists && !['upcoming','preparation','registration'].includes(String(season.data()?.status).toLowerCase())) {
      throw new Error('SEASON_STATE_CONFLICT');
    }
    if (admission.exists && admission.data()?.enabled === true) throw new Error('ADMISSION_ALREADY_CONFIGURED');
    const at = new Date().toISOString();
    const admissionData = { seasonId: TARGET, enabled: true, automatic: true, stage: 0,
      leagueOverrides: {}, updatedAt: at, revision: at, updatedBy: actorId };
    tx.set(seasonRef, { id: TARGET, name: '2027/28', status: 'registration',
      registrationOpen: true, sourceSeasonId: SOURCE,
      createdAt: season.data()?.createdAt || at, updatedAt: at }, { merge: true });
    tx.set(admissionRef, admissionData);
    return { alreadyActive: false, admissionData };
  });
  if (result.admissionData) await publishAdmissionStatus(TARGET, result.admissionData);
  return { alreadyActive: result.alreadyActive };
}
export async function autoActivateSecondSeasonWhenDue() {
  if (process.env.VERCEL_ENV !== 'production') return false;
  if (Date.now() < Date.parse(S2_OPENS_AT)) return false;
  await activateSecondSeasonRegistration();
  return true;
}
