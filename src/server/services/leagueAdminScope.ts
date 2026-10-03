import type { Request, Response, NextFunction } from 'express';
import type { User } from '../../types';
import { isLeagueAdmin, permittedAdminLeagues } from '../../lib/adminPermissions';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

export async function enforceLeagueAdminScope(req: Request, res: Response, next: NextFunction) {
  if (!isLeagueAdmin(req.user!)) return next();
  const allowed = permittedAdminLeagues(req.user!);
  const leagueIds = new Set(allowed.map(league => league.id));
  const competitionIds = new Set(allowed.map(league => league.competitionId));
  const path = new URL(req.originalUrl, 'https://efluz.invalid').pathname;
  const deny = () => { res.status(403).json({ error: 'ADMIN_SCOPE_FORBIDDEN', message: 'Sizda bu liga yoki amal uchun ruxsat yo‘q.' }); };
  if (req.method === 'GET' && path === '/api/admin/access') return next();
  if (!allowed.length) return deny();
  if (req.method === 'GET' && path === '/api/admin/scoped/overview') return next();
  const db = getFirestoreDb();
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
  const fixtureMatch = path.match(/^\/api\/admin\/(?:fixtures|results)\/([^/]+)(?:\/(result|delete-result|reopen|approve|reject|deadline))?$/);
  if (fixtureMatch && (req.method === 'POST' || req.method === 'DELETE')) {
    const fixture = await db.collection(COLLECTIONS.FIXTURES).doc(decodeURIComponent(fixtureMatch[1])).get();
    if (!fixture.exists || !competitionIds.has(fixture.data()!.competitionId)) return deny();
    return next();
  }
  const competitionMatch = path.match(/^\/api\/admin\/competitions\/([^/]+)\/(?:rebuild-standings|matchday\/(?:override|advance|open-now|set-timer|remind))$/);
  if (req.method === 'POST' && competitionMatch && competitionIds.has(decodeURIComponent(competitionMatch[1]))) return next();
  // Every other admin endpoint, including new endpoints, is denied by default.
  return deny();
}

export async function getLeagueAdminOverview(user: User, seasonId: string) {
  const { getAdminClubsFromReadModel } = await import('../readModel/readModelStore');
  const { getFixturesFirestore, getAllCompetitionsFirestore } = await import('../firebase/firestoreStore');
  const allowed = permittedAdminLeagues(user);
  const competitions = (await getAllCompetitionsFirestore(seasonId)).filter(competition => allowed.some(league => league.competitionId === competition.id));
  const rows = await Promise.all(allowed.map(async league => {
    const [clubs, fixtures] = await Promise.all([getAdminClubsFromReadModel(seasonId, league.id), getFixturesFirestore({ seasonId, competitionId: league.competitionId })]);
    return { clubs: clubs.clubs, fixtures };
  }));
  return { leagues: allowed, competitions, clubs: rows.flatMap(row => row.clubs).filter(club => allowed.some(league => league.id === club.leagueId)), fixtures: rows.flatMap(row => row.fixtures).filter(fixture => allowed.some(league => league.competitionId === fixture.competitionId)) };
}
