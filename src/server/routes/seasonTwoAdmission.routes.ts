import { Router, type Request, type Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { S2_OPENS_AT, S2_PUBLIC_AT, seasonTwoAdmissionPhase } from '../../lib/seasonTwoAdmissionWindow';
import { requireAuth } from '../middleware/authMiddleware';
import { getFirestoreDb } from '../firebase/admin';
import { isPrimaryOwner } from '../services/telegramAiConfigService';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { invalidateClubReadModels, invalidateUserMembershipReadModel } from '../readModel/readModelStore';
import { prepareAutomaticAdmissionAdvance, publishAdmissionStatus } from '../services/clubAdmission';
import { activateSecondSeasonRegistration, autoActivateSecondSeasonWhenDue } from '../services/seasonTwoRegistrationService';

export const seasonTwoAdmissionRouter = Router();
const TARGET = EFL_SECOND_SEASON.id;
const SOURCE = EFL_SECOND_SEASON.sourceSeasonId;

const phase = seasonTwoAdmissionPhase;
let lastMilestoneAnnouncementCheck = 0;
function scheduleMilestoneAnnouncementIfDue() {
  if (process.env.VERCEL_ENV !== 'production' || process.env.DATABASE_PROVIDER !== 'supabase') return;
  const now = Date.now();
  if (now < Date.parse(S2_OPENS_AT) || now - lastMilestoneAnnouncementCheck < 300000) return;
  lastMilestoneAnnouncementCheck = now;
  const work = import('../services/seasonTwoTelegramAnnouncements')
    .then(({announceDueSeasonTwoMilestones}) => announceDueSeasonTwoMilestones(now))
    .catch(error => console.warn('[SEASON2_MILESTONE_NOTICE_DEFERRED]', error?.message || error));
  if (process.env.VERCEL === '1') waitUntil(work);
  else void work;
}
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
    // A public status poll is read-only once registration has opened.
    // Avoid repeating a serializable database transaction for every visitor.
    const seasonRef = getFirestoreDb().collection('seasons').doc(TARGET);
    let doc = await seasonRef.get();
    let enabled = doc.data()?.registrationOpen === true && String(doc.data()?.status).toLowerCase() === 'registration';
    if (!enabled && Date.now() >= Date.parse(S2_OPENS_AT)) {
      await autoActivateSecondSeasonWhenDue();
      doc = await seasonRef.get();
      enabled = doc.data()?.registrationOpen === true && String(doc.data()?.status).toLowerCase() === 'registration';
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ seasonId: TARGET, sourceSeasonId: SOURCE, phase: enabled ? phase() : 'NOT_ACTIVATED',
      priorityFrom: S2_OPENS_AT, publicFrom: S2_PUBLIC_AT, registrationOpen: enabled });
    if (enabled) scheduleMilestoneAnnouncementIfDue();
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
      const admissionRef = db.collection('club_admissions').doc(TARGET);
      // All authoritative reads precede writes; competing choices serialize on decision/occupancy.
      const [season, ban, source, decision, occupancy, membership, admissionDoc] = await Promise.all([
        tx.get(seasonRef), tx.get(banRef), tx.get(sourceRef), tx.get(decisionRef),
        tx.get(occupancyRef), tx.get(membershipRef), tx.get(admissionRef),
      ]);
      if (season.data()?.registrationOpen !== true || String(season.data()?.status).toLowerCase() !== 'registration') failure('SEASON_NOT_OPEN');
      if (phase() !== 'PRIORITY') failure('PRIORITY_WINDOW_CLOSED');
      if (ban.data()?.isBanned === true) failure('CLUB_SELECTION_BANNED', 403);
      if (source.data()?.userId !== uid || ['released','inactive'].includes(String(source.data()?.status))) failure('NOT_SEASON_ONE_OWNER', 403);
      if (decision.exists) {
        if (decision.data()?.choice !== choice) failure('DECISION_ALREADY_FINAL');
        return { clubId, choice, replayed: true, stageAdvance: null };
      }
      const currentOwner = occupancy.data()?.userId;
      if (currentOwner && currentOwner !== uid && !['released','inactive'].includes(String(occupancy.data()?.status))) failure('CLUB_OCCUPIED');
      const old = membership.data();
      const existing = old?.status === 'active' ? [old.clubId, old.secondaryClubId].filter(Boolean) : [];
      // One club per player across all leagues in season two, including KEEP.
      if (choice === 'KEEP' && !existing.includes(clubId) && existing.length >= 1) failure('SEASON_CLUB_LIMIT');
      const stageAdvance = choice === 'KEEP' ? await prepareAutomaticAdmissionAdvance(tx, db, TARGET, admissionDoc.data(), clubId) : null;
      const at = new Date().toISOString();
      if (stageAdvance) tx.set(admissionRef, stageAdvance);
      tx.create(decisionRef, { seasonId: TARGET, sourceSeasonId: SOURCE, userId: uid, clubId, choice, at });
      if (choice === 'KEEP') {
        tx.set(occupancyRef, { seasonId: TARGET, clubId, userId: uid, status: 'active', claimedAt: at, updatedAt: at });
        tx.set(db.collection('club_memberships').doc(`${TARGET}_${clubId}`), {
          id: `cm-${TARGET}-${clubId}`, seasonId: TARGET, clubId, userId: uid, status: 'active', claimedAt: at, updatedAt: at,
        });
        if (existing.length === 0) tx.set(membershipRef, { seasonId: TARGET, userId: uid, clubId, status: 'active', claimedAt: at, updatedAt: at });
        else if (!existing.includes(clubId)) tx.update(membershipRef, { secondaryClubId: clubId, secondaryLeagueId: rosterLeague.get(clubId), updatedAt: at });
      }
      return { clubId, choice, replayed: false, stageAdvance };
    });
    if (result.choice === 'KEEP' && !result.replayed) {
      await Promise.allSettled([invalidateClubReadModels(TARGET), invalidateUserMembershipReadModel(uid, TARGET),
        ...(result.stageAdvance ? [publishAdmissionStatus(TARGET, result.stageAdvance)] : [])]);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, ...result });
  } catch (error) { handle(res, error); }
});

/** Same Supabase-backed activation path for admin and scheduled opening. */
seasonTwoAdmissionRouter.post('/activate', requireAuth, async (req, res) => {
  try {
    if (!isPrimaryOwner(req.user!.telegramId)) failure('OWNER_ONLY', 403);
    const result = await activateSecondSeasonRegistration(req.user!.id);
    res.json({ success: true, ...result, phase: phase(), priorityFrom: S2_OPENS_AT, publicFrom: S2_PUBLIC_AT });
  } catch (error) { handle(res, error); }
});
