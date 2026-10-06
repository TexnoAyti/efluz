import type { Request, Response, NextFunction } from 'express';
import type { User } from '../../types';
import { isLeagueAdmin, permittedAdminLeagues, permittedAdminCompetitionIds } from '../../lib/adminPermissions';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

export async function enforceLeagueAdminScope(req: Request, res: Response, next: NextFunction) {
  if (!isLeagueAdmin(req.user!)) return next();
  const allowed = permittedAdminLeagues(req.user!);
  const leagueIds = new Set(allowed.map(league => league.id));
  const competitionIds = new Set(permittedAdminCompetitionIds(req.user!));
  const cupIds = new Set(allowed.map(league => league.cupCompetitionId));
  const path = new URL(req.originalUrl, 'https://efluz.invalid').pathname;
  const deny = () => { res.status(403).json({ error: 'ADMIN_SCOPE_FORBIDDEN', message: 'Sizda bu liga yoki amal uchun ruxsat yo‘q.' }); };
  if (req.method === 'GET' && path === '/api/admin/access') return next();
  if (req.method === 'POST' && /^\/api\/admin\/image-exports\/?$/.test(path)) return next();
  if (!allowed.length) return deny();
  if (req.method === 'GET' && /^\/api\/admin\/competitions\/([^/]+)\/matchday\/control$/.test(path) && competitionIds.has(decodeURIComponent(path.split('/')[4]))) return next();
  if (req.method === 'GET' && ['/api/admin/scoped/overview', '/api/admin/scoped/users', '/api/admin/scoped/reviews'].includes(path)) return next();
  const db = getFirestoreDb();
  if (req.method === 'GET' && path === '/api/admin/cups') return next();
  const cupMatch = path.match(/^\/api\/admin\/cups\/([^/]+)(?:\/(health|reconcile|round|round\/advance|bracket\/preview))?$/);
  if (cupMatch && cupIds.has(decodeURIComponent(cupMatch[1])) &&
      ((req.method === 'GET' && (!cupMatch[2] || cupMatch[2] === 'health')) ||
       (req.method === 'POST' && ['reconcile', 'round', 'round/advance', 'bracket/preview'].includes(cupMatch[2])))) return next();
  const cupFixtureMatch = path.match(/^\/api\/admin\/cups\/matches\/([^/]+)\/advance$/);
  const submissionsFixtureId = req.method === 'GET' && path === '/api/admin/submissions' && typeof req.query.fixtureId === 'string' ? req.query.fixtureId : null;
  if ((req.method === 'POST' && cupFixtureMatch) || submissionsFixtureId) {
    const fixtureId = submissionsFixtureId || decodeURIComponent(cupFixtureMatch![1]);
    const fixture = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
    const scope = submissionsFixtureId ? competitionIds : cupIds;
    if (!fixture.exists || !scope.has(fixture.data()!.competitionId)) return deny();
    return next();
  }
  const pairingMatch = path.match(/^\/api\/admin\/cups\/([^/]+)\/bracket\/fixture\/([^/]+)$/);
  if (req.method === 'PATCH' && pairingMatch && cupIds.has(decodeURIComponent(pairingMatch[1]))) {
    const fixture = await db.collection(COLLECTIONS.FIXTURES).doc(decodeURIComponent(pairingMatch[2])).get();
    if (!fixture.exists || fixture.data()!.competitionId !== decodeURIComponent(pairingMatch[1])) return deny();
    return next();
  }
  const disputeMatch = path.match(/^\/api\/admin\/disputes\/([^/]+)\/resolve$/);
  if (req.method === 'POST' && disputeMatch) {
    const dispute = await db.collection(COLLECTIONS.DISPUTES).doc(decodeURIComponent(disputeMatch[1])).get();
    if (!dispute.exists || typeof dispute.data()!.fixtureId !== 'string') return deny();
    const fixture = await db.collection(COLLECTIONS.FIXTURES).doc(dispute.data()!.fixtureId).get();
    if (!fixture.exists || !competitionIds.has(fixture.data()!.competitionId)) return deny();
    return next();
  }
  const clubMatch = path.match(/^\/api\/admin\/clubs\/([^/]+)\/(assign|release)$/);
  if (req.method === 'POST' && clubMatch) {
    const club = await db.collection(COLLECTIONS.CLUBS).doc(decodeURIComponent(clubMatch[1])).get();
    if (!club.exists || !leagueIds.has(club.data()!.leagueId)) return deny();
    if (clubMatch[2] === 'assign') {
      const { resolveAdminUserReference } = await import('./adminUserDirectory');
      const targetId = await resolveAdminUserReference(String(req.body?.targetUserId || ''));
      req.body.targetUserId = targetId;
      const membership = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${String(req.body?.seasonId || 'season-2026-27')}_${targetId}`).get();
      if (membership.exists && membership.data()!.status === 'active') {
        const previous = await db.collection(COLLECTIONS.CLUBS).doc(membership.data()!.clubId).get();
        if (!previous.exists || !leagueIds.has(previous.data()!.leagueId)) return deny();
      }
    }
    return next();
  }
  const fixtureMatch = path.match(/^\/api\/admin\/(?:fixtures|results)\/([^/]+)(?:\/(result|delete-result|reopen|approve|reject|deadline|remind))?$/);
  if (fixtureMatch && (req.method === 'POST' || req.method === 'DELETE')) {
    const fixture = await db.collection(COLLECTIONS.FIXTURES).doc(decodeURIComponent(fixtureMatch[1])).get();
    if (!fixture.exists || !competitionIds.has(fixture.data()!.competitionId)) return deny();
    return next();
  }
  const competitionMatch = path.match(/^\/api\/admin\/competitions\/([^/]+)\/(?:rebuild-standings|matchday\/(?:override|advance|open-now|set-timer|remind|control))$/);
  if (req.method === 'POST' && competitionMatch && competitionIds.has(decodeURIComponent(competitionMatch[1]))) return next();
  // Every other admin endpoint, including new endpoints, is denied by default.
  return deny();
}

export async function getLeagueAdminOverview(user: User, seasonId: string) {
  const { getAdminClubsFromReadModel, getCompetitionFixturesFromReadModel, getCompetitionsFromReadModel } = await import('../readModel/readModelStore');
  const allowed = permittedAdminLeagues(user);
  const competitionIds = new Set(permittedAdminCompetitionIds(user));
  const catalog = await getCompetitionsFromReadModel(seasonId);
  const competitions = catalog.competitions.filter(competition => competitionIds.has(competition.id));
  const rows = await Promise.all(allowed.map(async league => {
    const [clubs, fixtureSnapshots] = await Promise.all([getAdminClubsFromReadModel(seasonId, league.id), Promise.all([league.competitionId, league.cupCompetitionId].map(competitionId => getCompetitionFixturesFromReadModel(competitionId, { seasonId })))]);
    return { clubs: clubs.clubs, fixtures: fixtureSnapshots.flatMap(snapshot => snapshot.fixtures), stale: clubs.stale || fixtureSnapshots.some(snapshot => snapshot.stale), degraded: clubs.degraded || fixtureSnapshots.some(snapshot => snapshot.degraded) };
  }));
  return { leagues: allowed, competitions, clubs: rows.flatMap(row => row.clubs).filter(club => allowed.some(league => league.id === club.leagueId)), fixtures: rows.flatMap(row => row.fixtures).filter(fixture => competitionIds.has(fixture.competitionId)), stale: catalog.stale || rows.some(row => row.stale), degraded: catalog.degraded || rows.some(row => row.degraded) };
}
