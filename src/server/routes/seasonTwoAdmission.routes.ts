import { Router, type Request, type Response } from 'express';
import { S2_OPENS_AT, S2_PUBLIC_AT, seasonTwoAdmissionPhase } from '../../lib/seasonTwoAdmissionWindow';
import { requireAuth } from '../middleware/authMiddleware';
import { getFirestoreDb } from '../firebase/admin';
import { isPrimaryOwner } from '../services/telegramAiConfigService';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { invalidateClubReadModels, invalidateUserMembershipReadModel } from '../readModel/readModelStore';
import { publishAdmissionStatus } from '../services/clubAdmission';

export const seasonTwoAdmissionRouter = Router();
const TARGET = EFL_SECOND_SEASON.id;
const SOURCE = EFL_SECOND_SEASON.sourceSeasonId;

const phase = seasonTwoAdmissionPhase;
function failure(code: string, status = 409): never {
  throw Object.assign(new Error(code), { statusCode: status });
}
function handle(res: Response, error: any) {
  console.error('[SEASON2_ADMISSION]', error?.message || error);
  res.status(error?.statusCode || 503).json({ code: error?.message || 'ADMISSION_UNAVAILABLE' });
}

const rosterClubs = new Set(EFL_SECOND_SEASON.leagues.flatMap(l => l.roster.clubs.map(c => c.id)));
const rosterLeague = new Map(EFL_SECOND_SEASON.leagues.flatMap(l => l.roster.clubs.map(c => [c.id, l.id] as const)));

/** Public read; deliberately does not infer the user's ownership from an untrusted request. */
seasonTwoAdmissionRouter.get('/status', async (_req, res) => {
  try {
    const doc = await getFirestoreDb().collection('seasons').doc(TARGET).get();
    const enabled = doc.data()?.registrationOpen === true && String(doc.data()?.status).toLowerCase() === 'registration';
    res.setHeader('Cache-Control', 'no-store');
    res.json({ seasonId: TARGET, sourceSeasonId: SOURCE, phase: enabled ? phase() : 'NOT_ACTIVATED',
      priorityFrom: S2_OPENS_AT, publicFrom: S2_PUBLIC_AT, registrationOpen: enabled });
  } catch (error) { handle(res, error); }
});

/** Authenticated players choose per existing club, without changing season 1 ownership. */
seasonTwoAdmissionRouter.get('/mine', requireAuth, async (req, res) => {
  try {
    const uid = req.user!.id, db = getFirestoreDb();
    const [source, ban, decisions] = await Promise.all([
      db.collection('club_occupancies').where('seasonId', '==', SOURCE).where('userId', '==', uid).get(),
      db.collection('club_selection_bans').doc(uid).get(),
      db.collection('season2_retention_decisions').where('userId', '==', uid).get(),
    ]);
    const selections = new Map(decisions.docs.map(doc => [String(doc.data().clubId), doc.data()]));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ phase: phase(), banned: ban.data()?.isBanned === true,
      clubs: source.docs.filter(d => !['released','inactive'].includes(String(d.data().status))).map(d => ({
        clubId: String(d.data().clubId), eligible: rosterClubs.has(String(d.data().clubId)),
        choice: selections.get(String(d.data().clubId))?.choice || null,
      })) });
  } catch (error) { handle(res, error); }
});

seasonTwoAdmissionRouter.post('/decision', requireAuth, async (req: Request, res: Response) => {
  const uid = req.user!.id;
  const clubId = String(req.body?.clubId || '');
  const choice = req.body?.choice;
  if (!rosterClubs.has(clubId) || !['KEEP', 'RELEASE'].includes(choice)) {
    res.status(400).json({ code: 'INVALID_DECISION' }); return;
  }
  try {
    const db = getFirestoreDb();
    const result = await db.runTransaction(async tx => {
      const seasonRef = db.collection('seasons').doc(TARGET);
      const banRef = db.collection('club_selection_bans').doc(uid);
      const sourceRef = db.collection('club_occupancies').doc(`${SOURCE}_${clubId}`);
      const decisionRef = db.collection('season2_retention_decisions').doc(`${TARGET}_${clubId}`);
      const occupancyRef = db.collection('club_occupancies').doc(`${TARGET}_${clubId}`);
      const membershipRef = db.collection('user_memberships').doc(`${TARGET}_${uid}`);
      // All authoritative reads precede writes; competing choices serialize on decision/occupancy.
      const [season, ban, source, decision, occupancy, membership] = await Promise.all([
        tx.get(seasonRef), tx.get(banRef), tx.get(sourceRef), tx.get(decisionRef),
        tx.get(occupancyRef), tx.get(membershipRef),
      ]);
      if (season.data()?.registrationOpen !== true || String(season.data()?.status).toLowerCase() !== 'registration') failure('SEASON_NOT_OPEN');
      if (phase() !== 'PRIORITY') failure('PRIORITY_WINDOW_CLOSED');
      if (ban.data()?.isBanned === true) failure('CLUB_SELECTION_BANNED', 403);
      if (source.data()?.userId !== uid || ['released','inactive'].includes(String(source.data()?.status))) failure('NOT_SEASON_ONE_OWNER', 403);
      if (decision.exists) {
        if (decision.data()?.choice !== choice) failure('DECISION_ALREADY_FINAL');
        return { clubId, choice, replayed: true };
      }
      const currentOwner = occupancy.data()?.userId;
      if (currentOwner && currentOwner !== uid && !['released','inactive'].includes(String(occupancy.data()?.status))) failure('CLUB_OCCUPIED');
      const old = membership.data();
      const existing = old?.status === 'active' ? [old.clubId, old.secondaryClubId].filter(Boolean) : [];
      if (choice === 'KEEP' && !existing.includes(clubId) && existing.length >= 2) failure('SEASON_CLUB_LIMIT');
      if (choice === 'KEEP' && !existing.includes(clubId) && existing.some((id: string) => rosterLeague.get(id) === rosterLeague.get(clubId))) failure('SAME_LEAGUE');
      const at = new Date().toISOString();
      tx.create(decisionRef, { seasonId: TARGET, sourceSeasonId: SOURCE, userId: uid, clubId, choice, at });
      if (choice === 'KEEP') {
        tx.set(occupancyRef, { seasonId: TARGET, clubId, userId: uid, status: 'active', claimedAt: at, updatedAt: at });
        tx.set(db.collection('club_memberships').doc(`${TARGET}_${clubId}`), {
          id: `cm-${TARGET}-${clubId}`, seasonId: TARGET, clubId, userId: uid, status: 'active', claimedAt: at, updatedAt: at,
        });
        if (existing.length === 0) tx.set(membershipRef, { seasonId: TARGET, userId: uid, clubId, status: 'active', claimedAt: at, updatedAt: at });
        else if (!existing.includes(clubId)) tx.update(membershipRef, { secondaryClubId: clubId, secondaryLeagueId: rosterLeague.get(clubId), updatedAt: at });
      }
      return { clubId, choice, replayed: false };
    });
    if (result.choice === 'KEEP' && !result.replayed) {
      await Promise.allSettled([invalidateClubReadModels(TARGET), invalidateUserMembershipReadModel(uid, TARGET)]);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...result });
  } catch (error) { handle(res, error); }
});

/** Explicit owner activation. No automatic season activation from deployment. */
seasonTwoAdmissionRouter.post('/activate', requireAuth, async (req, res) => {
  try {
    if (!isPrimaryOwner(req.user!.telegramId)) failure('OWNER_ONLY', 403);
    const db = getFirestoreDb();
    const result = await db.runTransaction(async tx => {
      const seasonRef = db.collection('seasons').doc(TARGET);
      const admissionRef = db.collection('club_admissions').doc(TARGET);
      const [season, admission] = await Promise.all([tx.get(seasonRef), tx.get(admissionRef)]);
      if (season.data()?.registrationOpen === true) return { alreadyActive: true };
      if (season.exists && !['preparation', 'registration'].includes(String(season.data()?.status).toLowerCase())) failure('SEASON_STATE_CONFLICT');
      if (admission.exists && admission.data()?.enabled === true) failure('ADMISSION_ALREADY_CONFIGURED');
      const at = new Date().toISOString();
      tx.set(seasonRef, { id: TARGET, name: '2027/28', status: 'registration', registrationOpen: true,
        sourceSeasonId: SOURCE, createdAt: season.data()?.createdAt || at, updatedAt: at }, { merge: true });
      tx.set(admissionRef, { seasonId: TARGET, enabled: true, automatic: true, stage: 0,
        leagueOverrides: {}, updatedAt: at, revision: at, updatedBy: req.user!.id });
      return { alreadyActive: false };
    });
    if (!result.alreadyActive) {
      await publishAdmissionStatus(TARGET, { seasonId: TARGET, enabled: true, automatic: true, stage: 0, leagueOverrides: {}, updatedAt: new Date().toISOString(), revision: new Date().toISOString() });
    }
    res.json({ success: true, ...result, phase: phase(), priorityFrom: S2_OPENS_AT, publicFrom: S2_PUBLIC_AT });
  } catch (error) { handle(res, error); }
});
