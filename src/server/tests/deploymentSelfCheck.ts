import fs from 'fs';
import path from 'path';
import http from 'http';

async function runDeploymentSelfCheck() {
  console.log('=============================================================');
  console.log('       PRODUCTION DEPLOYMENT & VERCEL SELF-CHECK SUITE        ');
  console.log('=============================================================');

  const rootDir = process.cwd();

  // --- CHECK 1: api/index.js & sql-wasm.wasm exist and are non-empty ---
  console.log('\n--- [CHECK 1] Serverless Entrypoint (api/index.js) & WASM Assets ---');
  const apiEntryPath = path.resolve(rootDir, 'api', 'index.js');
  if (!fs.existsSync(apiEntryPath)) {
    throw new Error('FAILED [CHECK 1]: api/index.js does not exist in project root!');
  }
  const stat = fs.statSync(apiEntryPath);
  if (stat.size < 5000) {
    throw new Error(`FAILED [CHECK 1]: api/index.js is too small (${stat.size} bytes), bundle failed!`);
  }
  console.log(`✅ PASS [CHECK 1.1]: api/index.js exists and is valid bundle (${(stat.size / 1024).toFixed(1)} KB).`);

  const wasmPath = path.resolve(rootDir, 'api', 'sql-wasm.wasm');
  if (!fs.existsSync(wasmPath)) {
    throw new Error('FAILED [CHECK 1.2]: api/sql-wasm.wasm does not exist in api/ directory!');
  }
  const wasmStat = fs.statSync(wasmPath);
  if (wasmStat.size < 500000) {
    throw new Error(`FAILED [CHECK 1.2]: api/sql-wasm.wasm is too small (${wasmStat.size} bytes)!`);
  }
  console.log(`✅ PASS [CHECK 1.2]: api/sql-wasm.wasm exists and is valid (${(wasmStat.size / 1024).toFixed(1)} KB).`);

  // --- CHECK 2: vercel.json routing validation ---
  console.log('\n--- [CHECK 2] Vercel Configuration (vercel.json) ---');
  const vercelConfigPath = path.resolve(rootDir, 'vercel.json');
  if (!fs.existsSync(vercelConfigPath)) {
    throw new Error('FAILED [CHECK 2]: vercel.json does not exist!');
  }
  const vercelRaw = fs.readFileSync(vercelConfigPath, 'utf-8');
  let vercelConfig: any;
  try {
    vercelConfig = JSON.parse(vercelRaw);
  } catch (err: any) {
    throw new Error(`FAILED [CHECK 2]: vercel.json is not valid JSON: ${err.message}`);
  }

  const rewrites: Array<{ source: string; destination: string }> = vercelConfig.rewrites || [];
  const apiRewrite = rewrites.find((r) => r.source === '/api/(.*)' || r.source === '/api/*');
  if (!apiRewrite || (!apiRewrite.destination.includes('/api/index.js') && !apiRewrite.destination.includes('/api'))) {
    throw new Error('FAILED [CHECK 2]: vercel.json missing rewrite from /api/(.*) to /api/index.js!');
  }

  const spaRewrite = rewrites.find((r) => r.destination === '/index.html' || r.destination === 'index.html');
  if (!spaRewrite || !spaRewrite.source.includes('?!api')) {
    throw new Error('FAILED [CHECK 2]: vercel.json SPA rewrite must exclude /api to prevent index.html routing on API requests!');
  }
  console.log('✅ PASS [CHECK 2]: vercel.json correctly routes /api to serverless handler and protects SPA fallback.');

  // --- CHECK 3: API bundle execution & health check ---
  console.log('\n--- [CHECK 3] Live API Bundle Invocation ---');
  let handler: any;
  try {
    const imported = await import(apiEntryPath);
    handler = imported.default || imported;
    if (typeof handler !== 'function') {
      throw new Error('Exported handler is not a function');
    }
  } catch (err: any) {
    throw new Error(`FAILED [CHECK 3]: Could not load api/index.js: ${err.message}`);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function testEndpoint(endpoint: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      body: options.body,
    });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not json
    }
    return {
      status: res.status,
      contentType,
      text,
      json,
      isJson: json !== null,
    };
  }

  try {
    // 3.1 /api/health
    const health = await testEndpoint('/api/health');
    if (health.status !== 200 || !health.isJson || health.json?.status !== 'ok') {
      throw new Error(`FAILED [CHECK 3.1]: /api/health failed -> HTTP ${health.status}, text="${health.text}"`);
    }
    console.log('✅ PASS [CHECK 3.1]: GET /api/health returned HTTP 200 JSON { status: "ok" }');

    // 3.2 /api/leagues
    const leagues = await testEndpoint('/api/leagues');
    if (leagues.status !== 200 || !leagues.isJson || !Array.isArray(leagues.json?.leagues) || leagues.json.leagues.length !== 5) {
      throw new Error(`FAILED [CHECK 3.2]: /api/leagues failed -> HTTP ${leagues.status}, leagues count=${leagues.json?.leagues?.length}`);
    }
    console.log(`✅ PASS [CHECK 3.2]: GET /api/leagues returned HTTP 200 JSON (${leagues.json.leagues.length} leagues)`);

    // 3.3 /api/leagues/league-premier-league/clubs
    const plClubs = await testEndpoint('/api/leagues/league-premier-league/clubs');
    if (plClubs.status !== 200 || !plClubs.isJson || !Array.isArray(plClubs.json?.clubs) || plClubs.json.clubs.length !== 20) {
      throw new Error(`FAILED [CHECK 3.3]: Premier League clubs count failed -> count=${plClubs.json?.clubs?.length}`);
    }
    console.log(`✅ PASS [CHECK 3.3]: GET /api/leagues/.../clubs returned HTTP 200 JSON (20 2026/27 clubs)`);

    // 3.4 /api/me (unauthenticated must be JSON 401, NEVER HTML)
    const meAnon = await testEndpoint('/api/me');
    if (meAnon.status !== 401 || !meAnon.isJson || meAnon.text.includes('<!doctype html>')) {
      throw new Error(`FAILED [CHECK 3.4]: /api/me (unauthenticated) returned HTTP ${meAnon.status} (expected JSON 401, got text="${meAnon.text.slice(0, 80)}")`);
    }
    console.log('✅ PASS [CHECK 3.4]: GET /api/me returned HTTP 401 JSON (Clean 401, NOT HTML)');

    // 3.5 /api/auth/dev-profiles
    const devProfiles = await testEndpoint('/api/auth/dev-profiles');
    if (devProfiles.status !== 200 || !devProfiles.isJson || !Array.isArray(devProfiles.json?.profiles)) {
      throw new Error(`FAILED [CHECK 3.5]: /api/auth/dev-profiles failed -> HTTP ${devProfiles.status}, text="${devProfiles.text}"`);
    }
    console.log(`✅ PASS [CHECK 3.5]: GET /api/auth/dev-profiles returned HTTP 200 JSON (${devProfiles.json.profiles.length} profiles)`);

    // 3.6 /api/auth/telegram (empty body -> JSON 400, NEVER 405 HTML)
    const authTest = await testEndpoint('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData: '' }),
    });
    if (authTest.status !== 400 || !authTest.isJson || authTest.text.includes('<!doctype html>')) {
      throw new Error(`FAILED [CHECK 3.6]: POST /api/auth/telegram returned HTTP ${authTest.status} (expected JSON 400, got text="${authTest.text.slice(0, 80)}")`);
    }
    console.log('✅ PASS [CHECK 3.6]: POST /api/auth/telegram returned HTTP 400 JSON (Clean JSON error, NOT HTML)');
  } finally {
    server.close();
  }

  // --- CHECK 4: Zero hardcoded localhost URLs in client code ---
  console.log('\n--- [CHECK 4] Zero Localhost URLs in Client Code ---');
  const srcDir = path.resolve(rootDir, 'src');
  function scanFiles(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const s = fs.statSync(fullPath);
      if (s.isDirectory()) {
        if (file !== 'node_modules' && file !== 'dist' && file !== '.git') {
          results = results.concat(scanFiles(fullPath));
        }
      } else if (/\.(ts|tsx|js|jsx|html)$/.test(file) && !fullPath.includes('/server/tests/')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const clientFiles = scanFiles(srcDir);
  for (const filePath of clientFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes('http://localhost') || content.includes('http://127.0.0.1')) {
      throw new Error(`FAILED [CHECK 4]: Found hardcoded localhost URL in ${path.relative(rootDir, filePath)}`);
    }
  }
  console.log(`✅ PASS [CHECK 4]: All ${clientFiles.length} client files use clean relative API routes.`);

  console.log('\n=============================================================');
  console.log('      ALL PRODUCTION DEPLOYMENT SELF-CHECKS PASSED!          ');
  console.log('=============================================================');
}

runDeploymentSelfCheck().catch((err) => {
  console.error('\n❌ DEPLOYMENT SELF-CHECK FAILED:', err.message);
  process.exit(1);
});
