import http from 'http';
import handler from '../../../api/index.js';

async function testVercelHandler() {
  console.log('====================================================');
  console.log('    TESTING VERCEL SERVERLESS HANDLER (api/index)   ');
  console.log('====================================================');

  // Spin up an HTTP server invoking the exported Vercel handler function directly
  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      console.error('Handler error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message, stack: err.stack }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function fetchJson(path: string, headers: Record<string, string> = {}) {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    const data = await res.json();
    return { status: res.status, data };
  }

  try {
    // 1. Test /api/health
    console.log('\n--- 1. Testing GET /api/health ---');
    const health = await fetchJson('/api/health');
    if (health.status !== 200 || health.data.status !== 'ok') {
      throw new Error(`Health check failed: status=${health.status}, data=${JSON.stringify(health.data)}`);
    }
    console.log('✅ PASS: /api/health -> HTTP 200, status=ok');

    // 2. Test /api/seasons
    console.log('\n--- 2. Testing GET /api/seasons ---');
    const seasons = await fetchJson('/api/seasons');
    if (seasons.status !== 200 || !Array.isArray(seasons.data.seasons) || seasons.data.seasons.length === 0) {
      throw new Error(`Seasons endpoint failed: status=${seasons.status}, data=${JSON.stringify(seasons.data)}`);
    }
    console.log(`✅ PASS: /api/seasons -> HTTP 200, count=${seasons.data.seasons.length}, activeSeason=${seasons.data.seasons[0].id}`);

    // 3. Test /api/leagues
    console.log('\n--- 3. Testing GET /api/leagues ---');
    const leagues = await fetchJson('/api/leagues');
    if (leagues.status !== 200 || !Array.isArray(leagues.data.leagues) || leagues.data.leagues.length !== 5) {
      throw new Error(`Leagues endpoint failed: status=${leagues.status}, data=${JSON.stringify(leagues.data)}`);
    }
    console.log(`✅ PASS: /api/leagues -> HTTP 200, leagues count=${leagues.data.leagues.length}`);

    // 4. Test /api/leagues/league-premier-league/clubs
    console.log('\n--- 4. Testing GET /api/leagues/league-premier-league/clubs ---');
    const plClubs = await fetchJson('/api/leagues/league-premier-league/clubs');
    if (plClubs.status !== 200 || !Array.isArray(plClubs.data.clubs) || plClubs.data.clubs.length !== 20) {
      throw new Error(`Premier League clubs failed: status=${plClubs.status}, count=${plClubs.data.clubs?.length}`);
    }
    console.log(`✅ PASS: /api/leagues/league-premier-league/clubs -> HTTP 200, clubs count=${plClubs.data.clubs.length}`);

    // 5. Test /api/me (unauthenticated -> 401 clean JSON, no ERR_MODULE_NOT_FOUND)
    console.log('\n--- 5. Testing GET /api/me (unauthenticated) ---');
    const meAnon = await fetchJson('/api/me');
    if (meAnon.status !== 401 || meAnon.data.error !== 'Unauthorized') {
      throw new Error(`/api/me anonymous failed: status=${meAnon.status}, data=${JSON.stringify(meAnon.data)}`);
    }
    console.log('✅ PASS: /api/me -> HTTP 401 Unauthorized (Clean JSON error, NO ERR_MODULE_NOT_FOUND)');

    // 6. Test /api/me (authenticated with dev/telegram header -> 200)
    console.log('\n--- 6. Testing GET /api/me (authenticated) ---');
    const meAuth = await fetchJson('/api/me?seasonId=season-2026-27', {
      'x-dev-user-id': 'user-test-admin',
    });
    if (meAuth.status !== 200 || !meAuth.data.authenticated || !meAuth.data.user) {
      throw new Error(`/api/me authenticated failed: status=${meAuth.status}, data=${JSON.stringify(meAuth.data)}`);
    }
    console.log(`✅ PASS: /api/me -> HTTP 200, user=${meAuth.data.user.username}, club=${meAuth.data.currentClub?.name || 'none'}`);

    // 7. Test /api/competitions
    console.log('\n--- 7. Testing GET /api/competitions ---');
    const comps = await fetchJson('/api/competitions');
    if (comps.status !== 200 || !Array.isArray(comps.data.competitions)) {
      throw new Error(`/api/competitions failed: status=${comps.status}, data=${JSON.stringify(comps.data)}`);
    }
    console.log(`✅ PASS: /api/competitions -> HTTP 200, competitions count=${comps.data.competitions.length}`);

    // 8. Test /api/competitions/comp-premier-league-2026/standings
    console.log('\n--- 8. Testing GET /api/competitions/comp-premier-league-2026/standings ---');
    const standings = await fetchJson('/api/competitions/comp-premier-league-2026/standings');
    if (standings.status !== 200 || !Array.isArray(standings.data.standings)) {
      throw new Error(`/api/competitions standings failed: status=${standings.status}, data=${JSON.stringify(standings.data)}`);
    }
    console.log(`✅ PASS: /api/competitions/.../standings -> HTTP 200, standings rows=${standings.data.standings.length}`);

    // 9. Test /api/unknown-endpoint returns JSON 404 (NEVER HTML)
    console.log('\n--- 9. Testing GET /api/unknown-nonexistent-route (JSON 404 Check) ---');
    const notFound = await fetchJson('/api/unknown-nonexistent-route');
    if (notFound.status !== 404 || notFound.data.error !== 'Endpoint not found') {
      throw new Error(`/api/unknown route failed: status=${notFound.status}, data=${JSON.stringify(notFound.data)}`);
    }
    console.log('✅ PASS: /api/unknown-nonexistent-route -> HTTP 404 JSON (NOT HTML)');

    console.log('\n====================================================');
    console.log('   ALL VERCEL SERVERLESS HANDLER CHECKS PASSED!     ');
    console.log('====================================================');
  } finally {
    server.close();
  }
}

testVercelHandler().catch((err) => {
  console.error('\n❌ VERCEL HANDLER TEST FAILED:', err);
  process.exit(1);
});
