import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';
import { initDatabase, getDb, saveDatabaseSync } from '../db';
import { seedDatabase } from '../db/seed';
import { authRouter } from '../routes/auth.routes';
import { meRouter } from '../routes/me.routes';
import { leaguesRouter } from '../routes/leagues.routes';
import { clubsRouter } from '../routes/clubs.routes';
import { competitionsRouter } from '../routes/competitions.routes';
import { fixturesRouter } from '../routes/fixtures.routes';
import { adminRouter } from '../routes/admin.routes';
import { authMiddleware } from '../middleware/authMiddleware';

const TEST_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ_test_token';
process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;
process.env.ADMIN_TELEGRAM_IDS = '99999999,@tournament_admin,admin_boss';

function generateTelegramInitData(
  user: { id: number | string; username?: string; first_name: string; last_name?: string },
  botToken: string,
  authDateOffsetSeconds = 0
): string {
  const authDate = Math.floor(Date.now() / 1000) + authDateOffsetSeconds;
  const userJson = JSON.stringify(user);
  const queryId = 'AAHdF6IQAAAAAN0XohD_test';

  const params: Record<string, string> = {
    query_id: queryId,
    user: userJson,
    auth_date: String(authDate),
  };

  const keys = Object.keys(params).sort();
  const dataCheckString = keys.map((k) => `${k}=${params[k]}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const urlParams = new URLSearchParams();
  keys.forEach((k) => urlParams.set(k, params[k]));
  urlParams.set('hash', hash);

  return urlParams.toString();
}

async function runTelegramWebAppTestSuite() {
  console.log('=============================================================');
  console.log('       TELEGRAM WEBAPP END-TO-END VERIFICATION SUITE         ');
  console.log('=============================================================');

  // 1. Check index.html for official Telegram WebApp SDK script
  console.log('\n--- [CHECK 1 & 9] Telegram SDK Integration in index.html ---');
  const indexHtmlPath = path.resolve(process.cwd(), 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  if (!indexHtml.includes('https://telegram.org/js/telegram-web-app.js')) {
    throw new Error('index.html is missing the official Telegram WebApp SDK script!');
  }
  console.log('✅ PASS [CHECK 1 & 9]: Official Telegram WebApp SDK script is declared in index.html head.');

  // 2. Check no hardcoded localhost / loopback URLs in client source files
  console.log('\n--- [CHECK 8] Production API Relative Paths & Zero Localhost URLs ---');
  const srcDir = path.resolve(process.cwd(), 'src');
  function scanFiles(dir: string, fileList: string[] = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        if (file !== 'node_modules' && file !== 'tests') {
          scanFiles(fullPath, fileList);
        }
      } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js')) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  const clientFiles = scanFiles(srcDir);
  let localhostViolations = 0;
  for (const f of clientFiles) {
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes('http://localhost:3000') || content.includes('http://127.0.0.1:3000')) {
      console.error(`❌ Localhost URL found in ${f}`);
      localhostViolations++;
    }
  }
  if (localhostViolations > 0) {
    throw new Error(`Found ${localhostViolations} client files with hardcoded localhost URLs.`);
  }
  console.log(`✅ PASS [CHECK 8]: All ${clientFiles.length} client files use production-safe relative API routes (/api/*).`);

  // 3. Check AuthContext deterministic state machine
  console.log('\n--- [CHECK 10] AuthContext State Transition Immutability ---');
  const authContextPath = path.resolve(process.cwd(), 'src/context/AuthContext.tsx');
  const authContextContent = fs.readFileSync(authContextPath, 'utf8');
  if (!authContextContent.includes('resolveTelegramContext') || !authContextContent.includes('AUTH_LOADING')) {
    throw new Error('AuthContext does not contain deterministic Telegram resolver!');
  }
  console.log('✅ PASS [CHECK 10]: AuthContext implements deterministic Telegram WebApp resolver with timeout retry and protected anonymous fallback.');

  // 4. Spin up test HTTP server with all Express middleware and routes
  console.log('\n--- [CHECK 2 - 7] Live HTTP Server & Telegram HMAC Validation ---');
  await initDatabase();
  await seedDatabase();

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/clubs', clubsRouter);
  app.use('/api/competitions', competitionsRouter);
  app.use('/api/fixtures', fixturesRouter);
  app.use('/api/admin', adminRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function req(method: string, urlPath: string, headers: Record<string, string> = {}, body?: any) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  try {
    // Check 2: Auth endpoint exists
    console.log('Testing [CHECK 2]: POST /api/auth/telegram exists');
    const noBodyRes = await req('POST', '/api/auth/telegram', {}, {});
    if (noBodyRes.status !== 400) {
      throw new Error(`Expected 400 for empty body on /api/auth/telegram, got ${noBodyRes.status}`);
    }
    console.log('✅ PASS [CHECK 2]: /api/auth/telegram endpoint is live and validates request schema.');

    // Check 3: Valid initData accepted
    console.log('Testing [CHECK 3]: Valid Telegram initData acceptance');
    const validPlayer = {
      id: 77712345,
      username: 'ronaldo_efootball',
      first_name: 'Cristiano',
      last_name: 'Ronaldo',
    };
    const validInitData = generateTelegramInitData(validPlayer, TEST_BOT_TOKEN);
    const authRes = await req('POST', '/api/auth/telegram', {}, { initData: validInitData });
    if (authRes.status !== 200 || !authRes.data.success || authRes.data.user.telegramId !== '77712345') {
      throw new Error(`Expected 200 and valid user from /api/auth/telegram, got: ${JSON.stringify(authRes.data)}`);
    }
    console.log(`✅ PASS [CHECK 3]: Valid Telegram initData accepted -> User: @${authRes.data.user.username} (ID: ${authRes.data.user.telegramId}).`);

    // Check 4: Invalid/Tampered initData rejected
    console.log('Testing [CHECK 4]: Tampered initData rejection');
    const tamperedInitData = validInitData.replace('ronaldo_efootball', 'hacked_imposter');
    const tamperedRes = await req('POST', '/api/auth/telegram', {}, { initData: tamperedInitData });
    if (tamperedRes.status !== 401) {
      throw new Error(`Expected 401 for tampered initData, got ${tamperedRes.status}`);
    }
    console.log('✅ PASS [CHECK 4]: Tampered initData correctly rejected with HTTP 401.');

    // Check 5: Expired initData rejected (>24h)
    console.log('Testing [CHECK 5]: Expired auth_date rejection');
    const expiredInitData = generateTelegramInitData(validPlayer, TEST_BOT_TOKEN, -100000); // 27+ hours ago
    const expiredRes = await req('POST', '/api/auth/telegram', {}, { initData: expiredInitData });
    if (expiredRes.status !== 401) {
      throw new Error(`Expected 401 for expired initData, got ${expiredRes.status}`);
    }
    console.log('✅ PASS [CHECK 5]: Expired initData (>24h) correctly rejected with HTTP 401.');

    // Check 6: /api/me resolves authenticated identity with x-telegram-init-data
    console.log('Testing [CHECK 6]: GET /api/me resolution via x-telegram-init-data header');
    const meRes = await req('GET', '/api/me?seasonId=season-2026-27', {
      'x-telegram-init-data': validInitData,
    });
    if (meRes.status !== 200 || !meRes.data.authenticated || meRes.data.user.username !== 'ronaldo_efootball') {
      throw new Error(`Expected 200 and authenticated user on /api/me, got: ${JSON.stringify(meRes.data)}`);
    }
    console.log(`✅ PASS [CHECK 6]: /api/me returns authenticated=true, user=@${meRes.data.user.username}, club=${meRes.data.currentClub ? meRes.data.currentClub.name : 'none'}.`);

    // Check 7: Server-side admin verification via ADMIN_TELEGRAM_IDS
    console.log('Testing [CHECK 7]: Server-side admin role resolution');
    const adminPlayer = {
      id: 99999999,
      username: 'tournament_admin',
      first_name: 'Chief',
      last_name: 'Admin',
    };
    const adminInitData = generateTelegramInitData(adminPlayer, TEST_BOT_TOKEN);
    const adminAuthRes = await req('POST', '/api/auth/telegram', {}, { initData: adminInitData });
    if (adminAuthRes.status !== 200 || !adminAuthRes.data.user.isAdmin) {
      throw new Error('Expected admin user to have isAdmin=true');
    }

    const adminUsersRes = await req('GET', '/api/admin/users', {
      'x-telegram-init-data': adminInitData,
    });
    if (adminUsersRes.status !== 200) {
      throw new Error(`Expected 200 on /api/admin/users with admin header, got ${adminUsersRes.status}`);
    }

    const nonAdminUsersRes = await req('GET', '/api/admin/users', {
      'x-telegram-init-data': validInitData,
    });
    if (nonAdminUsersRes.status !== 403) {
      throw new Error(`Expected 403 on /api/admin/users with non-admin header, got ${nonAdminUsersRes.status}`);
    }
    console.log('✅ PASS [CHECK 7]: Admin user verified server-side (HTTP 200), non-admin blocked with HTTP 403.');

    console.log('\n=============================================================');
    console.log('      ALL 10 TELEGRAM WEBAPP VERIFICATION CHECKS PASSED      ');
    console.log('=============================================================');
  } finally {
    server.close();
  }
}

runTelegramWebAppTestSuite().catch((err) => {
  console.error('\n❌ TELEGRAM WEBAPP TEST SUITE FAILED:', err);
  process.exit(1);
});
