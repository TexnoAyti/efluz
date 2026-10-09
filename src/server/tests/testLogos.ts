import { initDatabase, queryAll } from '../db/index';

async function validateUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    return res.status >= 200 && res.status < 400;
  } catch (err) {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(4000) });
      return res.status >= 200 && res.status < 400;
    } catch {
      return false;
    }
  }
}

async function testAllLogos() {
  await initDatabase();
  console.log('=== VALIDATING LEAGUE LOGOS ===');
  const leagues = queryAll<any>('SELECT * FROM leagues');
  for (const l of leagues) {
    const ok = await validateUrl(l.logo_url);
    console.log(`[${ok ? 'OK' : 'FAILED'}] League: ${l.name} -> ${l.logo_url}`);
  }

  console.log('\n=== VALIDATING CLUB LOGOS (96 CLUBS) ===');
  const clubs = queryAll<any>('SELECT id, name, league_id, logo_url FROM clubs ORDER BY league_id, name');
  let failed = 0;
  for (const c of clubs) {
    const ok = await validateUrl(c.logo_url);
    if (!ok) {
      console.log(`❌ [FAILED] Club: ${c.name} (${c.id}) in ${c.league_id} -> ${c.logo_url}`);
      failed++;
    }
  }
  if (failed === 0) {
    console.log(`✅ All ${clubs.length} club logos validated successfully!`);
  } else {
    console.log(`⚠️ ${failed} club logos failed validation!`);
  }
}

testAllLogos().catch(console.error);
