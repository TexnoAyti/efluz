import type { Club, Fixture } from '../types';

const seasonId = 'season-2026-27';
const createdAt = '2026-10-01T12:00:00Z';
const key = 'efluz-browser-demo-results-v1';
export const demoClubs: Club[] = [
  {id: 'club-arsenal', name: 'Arsenal', shortName: 'ARS', leagueId: 'league-premier-league', leagueName: 'Premier League', country: 'England', logoUrl: '', active: true, createdAt},
  {id: 'club-real-madrid', name: 'Real Madrid', shortName: 'RMA', leagueId: 'league-la-liga', leagueName: 'La Liga', country: 'Spain', logoUrl: '', active: true, createdAt},
];
const opponents: Club[] = [
  {...demoClubs[0], id: 'club-chelsea', name: 'Chelsea', shortName: 'CHE'},
  {...demoClubs[1], id: 'club-barcelona', name: 'Barcelona', shortName: 'BAR'},
];
export const demoCompetitions = demoClubs.map((club, index) => ({
  id: `demo-league-${index}`, seasonId, leagueId: club.leagueId, name: club.leagueName,
  type: 'LEAGUE', status: 'active', scheduleMode: 'MANUAL', formatConfig: {},
  currentMatchday: 1, isMatchdayOpen: true, adminOverrideStatus: 'AUTO',
  fixtureCount: 1, hasFixtures: true, totalTeams: 2, createdAt,
}));
const initialFixtures: Fixture[] = demoClubs.map((club, index) => ({
  id: `demo-match-${index}`, seasonId, competitionId: demoCompetitions[index].id,
  competitionName: club.leagueName, matchday: 1, roundName: '1-tur',
  homeClubId: club.id, awayClubId: opponents[index].id, homeClub: club, awayClub: opponents[index],
  homeOwnerId: 'design-preview', awayOwnerId: `demo-opponent-${index}`,
  homeUser: {id: 'design-preview', username: 'design_preview', displayName: 'Demo o‘yinchi'},
  awayUser: {id: `demo-opponent-${index}`, username: 'demo_opponent', displayName: 'Demo raqib'},
  isPlayable: true, activeMatchday: 1, status: 'SCHEDULED', scheduledAt: '2026-10-02T12:00:00Z', createdAt, updatedAt: createdAt,
}));
function fixtures(): Fixture[] {
  try { const saved = JSON.parse(sessionStorage.getItem(key) || 'null'); if (Array.isArray(saved) && saved.length === 2) return saved; } catch {}
  return structuredClone(initialFixtures);
}
function save(value: Fixture[]) { sessionStorage.setItem(key, JSON.stringify(value)); }
export function confirmDemoOpponent() {
  save(fixtures().map(f => f.status === 'PENDING_CONFIRMATION' ? {...f, status: 'CONFIRMED', resultConfirmedAt: new Date().toISOString()} : f));
}
export function resetDemoResults() { sessionStorage.removeItem(key); }
function standings(id: string) {
  const f = fixtures().find(f => f.competitionId === id);
  if (!f) return [];
  return [f.homeClub!, f.awayClub!].map((club, index) => {
    const confirmed = f.status === 'CONFIRMED';
    const gf = confirmed ? Number(index ? f.awayScore : f.homeScore) : 0;
    const ga = confirmed ? Number(index ? f.homeScore : f.awayScore) : 0;
    return {clubId: club.id, club, position: index + 1, played: confirmed ? 1 : 0,
      won: confirmed && gf > ga ? 1 : 0, drawn: confirmed && gf === ga ? 1 : 0,
      lost: confirmed && gf < ga ? 1 : 0, goalsFor: gf, goalsAgainst: ga, goalDifference: gf - ga,
      points: confirmed ? gf > ga ? 3 : gf === ga ? 1 : 0 : 0, form: confirmed ? [gf > ga ? 'W' : gf === ga ? 'D' : 'L'] : []};
  }).sort((a,b) => b.points-a.points || b.goalDifference-a.goalDifference).map((row, index) => ({...row, position: index + 1}));
}

// Every demo request stays inside this browser. Unimplemented writes fail closed.
export async function designPreviewRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = new URL(endpoint, window.location.origin);
  const path = url.pathname;
  const method = options.method || 'GET';
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
  const result = path.match(/^\/api\/fixtures\/(demo-match-[01])\/result$/);
  if (result && method === 'POST') {
    const all = fixtures(); const f = all.find(f => f.id === result[1])!;
    if (f.status === 'CONFIRMED') throw Error('Demo: natija allaqachon tasdiqlangan.');
    if (![body.homeScore, body.awayScore].every(n => Number.isInteger(n) && n >= 0 && n <= 99)) throw Error('Hisob 0–99 oralig‘ida bo‘lishi kerak.');
    if (body.proofUrl && !/^https:\/\//.test(body.proofUrl)) throw Error('Skrinshot havolasi HTTPS bo‘lishi kerak.');
    Object.assign(f, {homeScore: body.homeScore, awayScore: body.awayScore, status: 'PENDING_CONFIRMATION',
      userSubmission: {id: `demo-sub-${f.id}`, fixtureId: f.id, clubId: f.homeClubId, homeScore: body.homeScore, awayScore: body.awayScore, proofUrl: body.proofUrl, createdAt}, submissionsCount: 1});
    save(all); return {success: true, fixture: f};
  }
  if (path === '/api/me/notifications/read') return {success: true};
  if (method !== 'GET') throw Error('Bu amal brauzer demosida mavjud emas.');
  if (path === '/api/me/matches') return {fixtures: fixtures()};
  if (path === '/api/me/notifications') return {notifications: []};
  if (path === '/api/seasons') return {seasons: [{id: seasonId, name: '2026/27', status: 'active', createdAt}]};
  if (path === '/api/competitions') return {competitions: demoCompetitions};
  if (path === '/api/leagues') return {leagues: demoClubs.map((c,index) => ({id: c.leagueId, name: c.leagueName, country: c.country, sortOrder: index, clubCount: 2, createdAt}))};
  const comp = path.match(/^\/api\/competitions\/([^/]+)\/(standings|fixtures|participants)$/);
  if (comp) return comp[2] === 'standings' ? {standings: standings(comp[1])} : comp[2] === 'fixtures' ? {fixtures: fixtures().filter(f => f.competitionId === comp[1])} : {participants: []};
  if (/^\/api\/leagues\/[^/]+\/clubs$/.test(path)) return {clubs: [...demoClubs, ...opponents].filter(c => c.leagueId === path.split('/')[3])};
  if (path === '/api/clubs/admission') return {admission: null};
  if (path === '/api/telegram/premium/badges') return {clubIds: demoClubs.map(c => c.id)};
  if (path === '/api/admin/disputes') return {disputes: []};
  if (path === '/api/me') return {user: {id: 'design-preview', isAdmin: true}, currentClub: demoClubs[0], ownedClubs: demoClubs, currentClubStatus: 'resolved'};
  throw Error('Bu bo‘lim brauzer demosida mavjud emas.');
}
