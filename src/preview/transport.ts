import { TOP5_LEAGUES } from '../constants/top5Clubs';
import { previewClubs, previewCompetitions, previewFixtures, previewSeasons, previewStandings, previewAccountStats, previewUser } from './data';

export function previewResponse(input: string | URL | Request, init: RequestInit = {}, origin = location.origin): Response {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
  const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  // Fail closed, including cross-origin requests, GET admin actions and unknown routes.
  if (url.origin !== origin || method !== 'GET') return json({ error: 'Design preview: read-only, network disabled.' }, 403);
  const path = url.pathname;
  if (/\/(admin|auth|payments|balance|premium)(\/|$)/.test(path)) return json({ error: 'Design preview: private operation blocked.' }, 403);
  const season = url.searchParams.get('seasonId') || new URLSearchParams(location.search).get('previewSeason') || previewSeasons[0].id;
  const competitions = previewCompetitions(season);
  const identity = { user: previewUser, currentClub: previewClubs[0], ownedClubs: [previewClubs[0]], stats: previewAccountStats(season), currentClubStatus: 'resolved' };
  if (['/api/me', '/api/me/bootstrap', '/api/me/club'].includes(path)) return json(identity);
  if (path === '/api/me/notifications') return json({ notifications: [] });
  if (path === '/api/seasons') return json({ seasons: previewSeasons });
  if (path === '/api/leagues') return json({ leagues: TOP5_LEAGUES });
  if (path === '/api/competitions') return json({ competitions });
  if (path === '/api/clubs/admission') return json({ admission: null });
  if (path === '/api/clubs/claim-status') return json({ request: null });
  const league = path.match(/^\/api\/leagues\/([^/]+)\/clubs$/);
  if (league) return json({ clubs: previewClubs.filter(c => c.leagueId === league[1]) });
  const club = path.match(/^\/api\/clubs\/([^/]+)(\/fixtures)?$/);
  if (club) {
    const selected = previewClubs.find(c => c.id === club[1]);
    if (!selected) return json({ error: 'Unknown demo club' }, 404);
    return json(club[2] ? { fixtures: competitions.flatMap(previewFixtures).filter(f => f.homeClubId === selected.id || f.awayClubId === selected.id), stale: false, degraded: false } : { club: selected });
  }
  if (path === '/api/me/matches') return json({ fixtures: competitions.flatMap(previewFixtures).filter(f => f.homeClubId === previewClubs[0].id || f.awayClubId === previewClubs[0].id) });
  const comp = path.match(/^\/api\/competitions\/([^/]+)\/(standings|fixtures|participants|locks)$/);
  if (comp) {
    // IDs encode season so navigation between archived/current tables is deterministic.
    const selected = [...competitions, ...previewSeasons.flatMap(s => previewCompetitions(s.id))].find(c => c.id === comp[1]);
    if (!selected) return json({ error: 'Unknown demo competition' }, 404);
    if (comp[2] === 'standings') return json({ standings: previewStandings(selected) });
    if (comp[2] === 'participants') return json({ participants: previewClubs.filter(c => !selected.leagueId || c.leagueId === selected.leagueId).slice(0, selected.totalTeams) });
    if (comp[2] === 'locks') return json({ locks: {} });
    const matchday = Number(url.searchParams.get('matchday'));
    return json({ fixtures: previewFixtures(selected).filter(f => (!matchday || f.matchday === matchday) && (!url.searchParams.get('status') || f.status === url.searchParams.get('status'))) });
  }
  const ownFixtures = competitions.flatMap(previewFixtures).filter(f => f.homeClubId === previewClubs[0].id || f.awayClubId === previewClubs[0].id);
  const phases = [{ id: 'LEAGUE_1_9', label: 'Liga · 1–9 tur', description: 'Namuna mavsum', status: 'ACTIVE', confirmed: 40, total: 90, progress: 44, currentMatchday: 5 }];
  if (path === '/api/season-lifecycle') return json({ seasonId: season, currentPhase: 'LEAGUE_1_9', phases, overridePhase: null });
  if (path === '/api/season-ops/overview') return json({ currentPhase: phases[0], phases, counters: { totalFixtures: 190, confirmedFixtures: 40, pendingConfirmations: 0, disputed: 0, overdue: 0 }, deadlines: [], awards: [] });
  if (path === '/api/season-ops/me') return json({ club: { club: previewClubs[0], summary: { ...previewAccountStats(season), played: previewAccountStats(season).matchesPlayed, goalsFor: previewAccountStats(season).goalsScored, goalsAgainst: previewAccountStats(season).goalsConceded, goalDifference: previewAccountStats(season).goalsScored - previewAccountStats(season).goalsConceded }, upcoming: ownFixtures.filter(f => f.status === 'SCHEDULED') } });
  if (path === '/api/season-ops/me/career') return json({ locked: false, career: { overall: { matches: 4, wins: 3, draws: 1, losses: 0 } } });
  if (path === '/api/season-ops/qualification') return json({ leagues: [] });
  if (path === '/api/season-ops/history') return json({ seasons: [{ seasonId: 'season-2025-26', trophyCount: 0 }] });
  if (path === '/api/me/match-ops') return json({ rows: [], counters: {} });
  if (path === '/api/season-ops/h2h') return json({ played: 0, matches: [], summary: {} });
  if (/^\/api\/insights\/player\/[^/]+\/trophies$/.test(path)) return json({ trophies: [], stale: false });
  if (path === '/api/custom-tournaments' || path === '/api/custom-tournaments/my') return json({ tournaments: [], nextCursor: null });
  return json({ error: `Design preview: no synthetic fixture for ${path}` }, 403);
}

export function installPreviewTransport() {
  // Installed before importing App. There is deliberately no reference to native fetch.
  const enabled = new URLSearchParams(location.search).get('designPreview') === '1' && location.hostname !== 'efluz.vercel.app';
  window.fetch = async (input, init) => enabled ? previewResponse(input, init) : Response.json({ error: 'Design preview is not enabled' }, { status: 403 });
  window.XMLHttpRequest = class { constructor() { throw new Error('Design preview: XMLHttpRequest blocked'); } } as any;
  window.WebSocket = class { constructor() { throw new Error('Design preview: WebSocket blocked'); } } as any;
  window.EventSource = class { constructor() { throw new Error('Design preview: EventSource blocked'); } } as any;
  navigator.sendBeacon = () => false;
}
