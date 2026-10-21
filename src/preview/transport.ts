import { isDesignPreview, isDesignPreviewBuild } from '../designPreview';
import { previewClubs, previewData, previewLeagues, previewSeasons, previewUser } from './data';
/** Never falls through to the network, including unknown endpoints and inactive preview URLs. */
export async function previewFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = new URL(request?.url || String(input), window.location.origin);
  const method = (init?.method || request?.method || 'GET').toUpperCase();
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (!isDesignPreview || url.origin !== window.location.origin || method !== 'GET' || /\/(admin|auth|payments|balance|tickets)(\/|$)/.test(url.pathname)) return json({ error: 'Preview is read-only and isolated' }, 403);
  const path = url.pathname;
  const season = url.searchParams.get('seasonId') || previewSeasons[0].id;
  const { competitions, fixtures, standings } = previewData(season);
  if(path === '/api/seasons') return json({ seasons: previewSeasons });
  if(path === '/api/leagues') return json({ leagues: previewLeagues });
  if(path === '/api/competitions') return json({ competitions });
  if(path === '/api/me') return json({ user: previewUser, currentClub: previewClubs[0], ownedClubs: [previewClubs[0]] });
  if(path === '/api/me/notifications') return json({ notifications: [] });
  if(path === '/api/me/matches') return json({ fixtures: fixtures.filter(f => [f.homeClubId,f.awayClubId].includes(previewClubs[0].id)) });
  if(path === '/api/clubs/claim-status') return json({ request: null });
  if(path === '/api/clubs/admission') return json({ admission: { seasonId: season, enabled: false, stage: 0, activeLeagueId: null, leagues: previewLeagues, updatedAt: null } });
  let m = path.match(/^\/api\/leagues\/([^/]+)\/clubs$/);
  if(m) return json({ clubs: previewClubs.filter(c=>c.leagueId===m![1]) });
  m = path.match(/^\/api\/competitions\/([^/]+)\/(standings|fixtures|participants|locks)$/);
  if(m) {
    if(m[2]==='standings') return json({ standings: standings(m[1]) });
    if(m[2]==='participants') return json({ participants: standings(m[1]).map(r=>({...r,club:previewClubs.find(c=>c.id===r.clubId)})) });
    if(m[2]==='locks') return json({ locks: [], currentMatchday: 4, isMatchdayOpen: true });
    return json({ fixtures: fixtures.filter(f=>f.competitionId===m![1] && (!url.searchParams.has('matchday') || f.matchday===Number(url.searchParams.get('matchday'))) && (!url.searchParams.has('status') || f.status===url.searchParams.get('status'))) });
  }
  m = path.match(/^\/api\/clubs\/([^/]+)(\/fixtures)?$/);
  if(m) return json(m[2] ? { fixtures: fixtures.filter(f=>[f.homeClubId,f.awayClubId].includes(m![1])), stale:false, degraded:false } : { club: previewClubs.find(c=>c.id===m![1]) });
  if(path === '/api/custom-tournaments') return json({ tournaments: [], hasMore: false });
  return json({ error: `No synthetic fixture for ${path}` }, 404);
}
export function installPreviewTransport() {
  if (!isDesignPreviewBuild) return;
  window.fetch = previewFetch;
  // CSP connect-src 'none' independently denies XHR, sockets, beacons and workers' requests.
  if (navigator.sendBeacon) navigator.sendBeacon = () => false;
}
