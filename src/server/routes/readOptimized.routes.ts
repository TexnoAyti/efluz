import { Router, Request, Response, NextFunction } from 'express';
import { queryAll, queryGet } from '../db';
import { SEED_CLUBS, SEED_COMPETITIONS, SEED_LEAGUES } from '../db/seed';
import { getLocalOccupancySnapshot } from '../firebase/occupancySnapshot';
import { getMaterializedCompetitionStandings, rebuildMaterializedCompetitionStandings } from '../db/sqliteStandings';

export const readOptimizedRouter = Router();

function send(res: Response, body: unknown, maxAge = 30) {
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=120`);
  res.setHeader('X-EFLUZ-READ-SOURCE', 'SQLITE_LOCAL');
  res.json(body);
}

function resolveLeagueId(id: string): string {
  const aliases: Record<string, string> = {
    'league-epl': 'league-premier-league',
    'league-laliga': 'league-la-liga',
    'league-seriea': 'league-serie-a',
    'league-ligue1': 'league-ligue-1',
  };
  return aliases[id] || id;
}

const competitionSeedMap = new Map(SEED_COMPETITIONS.map((c) => [c.id, c]));
const leagueSeedMap = new Map(SEED_LEAGUES.map((l) => [l.id, l]));
const clubSeedMap = new Map(SEED_CLUBS.map((c) => [c.id, c]));

function localClub(clubId: string, seasonId: string, currentUserId?: string) {
  const seed = clubSeedMap.get(clubId);
  if (!seed) return null;
  const occ = queryGet<any>("SELECT user_id AS userId, username FROM active_occupancies_cache WHERE season_id = ? AND club_id = ? AND status = 'active' LIMIT 1", [seasonId, clubId]);
  const isCurrentUserClub = Boolean(currentUserId && occ?.userId === currentUserId);
  return { id: seed.id, name: seed.name, shortName: seed.shortName, leagueId: seed.leagueId, country: seed.country, logoUrl: seed.logoUrl, active: true, createdAt: '', isTaken: Boolean(occ), isCurrentUserClub, claimedByUserId: occ?.userId || null, claimedByUsername: occ?.username || null, managerUsername: occ?.username || undefined, occupancy: { status: isCurrentUserClub ? 'owned' : occ ? 'occupied' : 'available', userId: occ?.userId || undefined, username: occ?.username || undefined } };
}

readOptimizedRouter.get('/leagues', (_req, res) => {
  send(res, { leagues: SEED_LEAGUES }, 86400);
});

readOptimizedRouter.get('/leagues/:id', (req, res) => {
  const league = leagueSeedMap.get(resolveLeagueId(req.params.id));
  if (!league) { res.status(404).json({ error: 'League not found', code: 'NOT_FOUND' }); return; }
  send(res, { league }, 86400);
});

readOptimizedRouter.get('/leagues/:id/clubs', (req, res) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const leagueId = resolveLeagueId(req.params.id);
  const occupancy = getLocalOccupancySnapshot(seasonId);
  const byClub = new Map(occupancy.map((o) => [o.clubId, o]));
  const clubs = SEED_CLUBS.filter((c) => c.leagueId === leagueId).map((seed) => {
    const occ = byClub.get(seed.id); const currentUserId = req.user?.id; const owned = Boolean(currentUserId && occ?.claimedByUserId === currentUserId);
    return { id: seed.id, name: seed.name, shortName: seed.shortName, leagueId: seed.leagueId, country: seed.country, logoUrl: seed.logoUrl, active: true, createdAt: '', isTaken: Boolean(occ), isCurrentUserClub: owned, claimedByUserId: occ?.claimedByUserId || null, claimedByUsername: occ?.username || null, managerUsername: occ?.username || undefined, occupancy: { status: owned ? 'owned' : occ ? 'occupied' : 'available', userId: occ?.claimedByUserId, username: occ?.username } };
  });
  send(res, { clubs }, 30);
});

readOptimizedRouter.get('/clubs/available', (req, res) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const occupied = new Set(getLocalOccupancySnapshot(seasonId).map((o) => o.clubId));
  const clubs = SEED_CLUBS.filter((c) => !occupied.has(c.id)).map((c) => ({ id: c.id, name: c.name, shortName: c.shortName, leagueId: c.leagueId, country: c.country, logoUrl: c.logoUrl, active: true, createdAt: '', isTaken: false, isCurrentUserClub: false, occupancy: { status: 'available' as const } }));
  send(res, { clubs }, 30);
});

// Keep the legacy crest proxy route available; the read optimizer must not shadow it.
readOptimizedRouter.get('/clubs/:id', (req: Request, res: Response, next: NextFunction) => {
  if (req.params.id === 'crest-proxy') { next(); return; }
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const club = localClub(req.params.id, seasonId, req.user?.id);
  if (!club) { res.status(404).json({ error: 'Club not found', code: 'NOT_FOUND' }); return; }
  send(res, { club }, 30);
});

readOptimizedRouter.get('/competitions', (_req, res) => {
  send(res, { competitions: SEED_COMPETITIONS }, 300);
});

readOptimizedRouter.get('/competitions/:id', (req, res) => {
  const seed = competitionSeedMap.get(req.params.id);
  const local = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [req.params.id]);
  if (!seed && !local) { res.status(404).json({ error: 'Competition not found', code: 'NOT_FOUND' }); return; }
  const base: any = seed || {};
  const competition = { id: req.params.id, seasonId: local?.season_id || base.seasonId, leagueId: local?.league_id || base.leagueId, name: local?.name || base.name, type: local?.type || base.type, scheduleMode: local?.schedule_mode || base.scheduleMode, status: local?.status || 'active', formatConfig: base.formatConfig || {}, hasFixtures: Number(local?.fixture_count || 0) > 0, fixtureCount: Number(local?.fixture_count || 0) };
  send(res, { competition }, 60);
});

readOptimizedRouter.get('/competitions/:id/participants', (req, res) => {
  const participants = queryAll<any>(`SELECT cp.id, cp.competition_id AS competitionId, cp.club_id AS clubId, cp.season_id AS seasonId, cp.owner_user_id AS ownerUserId, cp.source_competition_id AS sourceCompetitionId, cp.source_position AS sourcePosition, cp.qualification_reason AS qualificationReason, cp.qualification_timestamp AS qualificationTimestamp, cp.seed_number AS seedNumber, cp.created_at AS createdAt, c.name AS clubName, c.short_name AS clubShortName, c.logo_url AS logoUrl FROM competition_participants cp JOIN clubs c ON c.id = cp.club_id WHERE cp.competition_id = ? ORDER BY cp.seed_number ASC`, [req.params.id]);
  send(res, { participants }, 60);
});

readOptimizedRouter.get('/competitions/:id/standings', (req, res) => {
  let standings = getMaterializedCompetitionStandings(req.params.id);
  if (standings.length === 0) standings = rebuildMaterializedCompetitionStandings(req.params.id);
  send(res, { standings }, 15);
});

readOptimizedRouter.get('/competitions/:id/fixtures', (req, res) => {
  const where = ['f.competition_id = ?']; const params: any[] = [req.params.id];
  if (req.query.matchday !== undefined) { where.push('f.matchday = ?'); params.push(Number(req.query.matchday)); }
  if (typeof req.query.status === 'string' && req.query.status) { where.push('f.status = ?'); params.push(req.query.status); }
  const fixtures = queryAll<any>(`SELECT f.id, f.season_id AS seasonId, f.competition_id AS competitionId, f.matchday, f.round_name AS roundName, f.home_club_id AS homeClubId, f.away_club_id AS awayClubId, f.scheduled_at AS scheduledAt, f.status, f.home_score AS homeScore, f.away_score AS awayScore, f.winner_club_id AS winnerClubId, f.result_confirmed_at AS resultConfirmedAt, f.created_at AS createdAt, f.updated_at AS updatedAt, hc.name AS homeClubName, hc.short_name AS homeClubShortName, hc.logo_url AS homeClubLogo, ac.name AS awayClubName, ac.short_name AS awayClubShortName, ac.logo_url AS awayClubLogo, (SELECT user_id FROM club_memberships cm WHERE cm.season_id = f.season_id AND cm.club_id = f.home_club_id AND cm.status = 'active' LIMIT 1) AS homeOwnerId, (SELECT user_id FROM club_memberships cm WHERE cm.season_id = f.season_id AND cm.club_id = f.away_club_id AND cm.status = 'active' LIMIT 1) AS awayOwnerId FROM fixtures f JOIN clubs hc ON hc.id = f.home_club_id JOIN clubs ac ON ac.id = f.away_club_id WHERE ${where.join(' AND ')} ORDER BY f.matchday ASC, f.scheduled_at ASC`, params);
  send(res, { fixtures }, 15);
});

readOptimizedRouter.get('/users/:id', (req, res) => {
  const user = queryGet<any>(`SELECT id, telegram_id AS telegramId, username, first_name AS firstName, last_name AS lastName, photo_url AS photoUrl, is_admin AS isAdmin, is_suspended AS isSuspended, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ?`, [req.params.id]);
  if (!user) { res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return; }
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const membership = queryGet<any>(`SELECT c.* FROM club_memberships cm JOIN clubs c ON c.id = cm.club_id WHERE cm.user_id = ? AND cm.season_id = ? AND cm.status = 'active' LIMIT 1`, [req.params.id, seasonId]);
  const club = membership ? localClub(membership.id, seasonId, req.params.id) : null;
  const fixtures = membership ? queryAll<any>(`SELECT home_club_id AS homeClubId, away_club_id AS awayClubId, home_score AS homeScore, away_score AS awayScore FROM fixtures WHERE season_id = ? AND status = 'CONFIRMED' AND (home_club_id = ? OR away_club_id = ?) ORDER BY updated_at ASC`, [seasonId, membership.id, membership.id]) : [];
  const stats = { matchesPlayed: fixtures.length, wins: 0, draws: 0, losses: 0, goalsScored: 0, goalsConceded: 0, points: 0, trophies: 0, leaguePosition: 0 };
  for (const f of fixtures) { const home = f.homeClubId === membership.id; const mine = home ? Number(f.homeScore || 0) : Number(f.awayScore || 0); const opp = home ? Number(f.awayScore || 0) : Number(f.homeScore || 0); stats.goalsScored += mine; stats.goalsConceded += opp; if (mine > opp) { stats.wins++; stats.points += 3; } else if (mine === opp) { stats.draws++; stats.points += 1; } else stats.losses++; }
  send(res, { user: { id: user.id, username: user.username, firstName: user.firstName, lastName: user.lastName, photoUrl: user.photoUrl, isAdmin: Boolean(user.isAdmin), createdAt: user.createdAt }, currentClub: club, stats }, 30);
});
