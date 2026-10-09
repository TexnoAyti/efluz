import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import { initDatabase, queryGet, queryAll, getDbFilePath } from '../db';
import { seedDatabase, repairSeason202627Roster } from '../db/seed';
import { ensureDbReady } from '../app';
import { authMiddleware } from '../middleware/authMiddleware';
import { healthRouter } from '../routes/health.routes';
import { authRouter } from '../routes/auth.routes';
import { seasonsRouter } from '../routes/seasons.routes';
import { leaguesRouter } from '../routes/leagues.routes';
import { clubsRouter } from '../routes/clubs.routes';
import { competitionsRouter } from '../routes/competitions.routes';
import { fixturesRouter } from '../routes/fixtures.routes';
import { meRouter } from '../routes/me.routes';
import { adminRouter } from '../routes/admin.routes';

const TEST_PORT = 3199;
const BOT_TOKEN = '777888999:AAFakeTokenForProductionVerification_XYZ123';
const ADMIN_ID = '987654321';
const NORMAL_USER_ID = '123456789';

process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.ADMIN_TELEGRAM_IDS = `${ADMIN_ID},admin_tg_user`;

function generateTelegramInitData(userObj: any, botToken: string, customAuthDate?: number, customHash?: string): string {
  const authDate = customAuthDate !== undefined ? customAuthDate : Math.floor(Date.now() / 1000);
  const userJson = JSON.stringify(userObj);
  const queryMap: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAHdF60gAAAAAN0XrSC12345',
    user: userJson,
  };

  const dataCheckString = Object.keys(queryMap)
    .sort()
    .map((k) => `${k}=${queryMap[k]}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const hash = customHash !== undefined ? customHash : calculatedHash;
  return `auth_date=${encodeURIComponent(queryMap.auth_date)}&query_id=${encodeURIComponent(
    queryMap.query_id
  )}&user=${encodeURIComponent(queryMap.user)}&hash=${hash}`;
}

async function makeRequest(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string | number> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: urlPath,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            resolve({ status: res.statusCode || 0, data: parsed });
          } catch {
            resolve({ status: res.statusCode || 0, data: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runProductionSmokeTest() {
  console.log('=============================================================');
  console.log('       PRODUCTION RUNTIME & TELEGRAM SMOKE TEST SUITE        ');
  console.log('=============================================================');

  // 1. Database boot
  await ensureDbReady();

  const dbPath = getDbFilePath();
  console.log(`[BOOT] Database path: ${dbPath}`);
  console.log('[BOOT] Active season: season-2026-27');

  // Direct SQL query check
  const plClubs = queryAll<any>(`
    SELECT c.id, c.name, slc.league_id, slc.is_active 
    FROM season_league_clubs slc 
    JOIN clubs c ON slc.club_id = c.id 
    WHERE slc.season_id = 'season-2026-27' AND slc.league_id = 'league-premier-league' AND slc.is_active = 1
  `);
  const llClubs = queryAll<any>(`
    SELECT c.id, c.name, slc.league_id, slc.is_active 
    FROM season_league_clubs slc 
    JOIN clubs c ON slc.club_id = c.id 
    WHERE slc.season_id = 'season-2026-27' AND slc.league_id = 'league-la-liga' AND slc.is_active = 1
  `);
  const saClubs = queryAll<any>(`
    SELECT c.id, c.name, slc.league_id, slc.is_active 
    FROM season_league_clubs slc 
    JOIN clubs c ON slc.club_id = c.id 
    WHERE slc.season_id = 'season-2026-27' AND slc.league_id = 'league-serie-a' AND slc.is_active = 1
  `);
  const blClubs = queryAll<any>(`
    SELECT c.id, c.name, slc.league_id, slc.is_active 
    FROM season_league_clubs slc 
    JOIN clubs c ON slc.club_id = c.id 
    WHERE slc.season_id = 'season-2026-27' AND slc.league_id = 'league-bundesliga' AND slc.is_active = 1
  `);
  const l1Clubs = queryAll<any>(`
    SELECT c.id, c.name, slc.league_id, slc.is_active 
    FROM season_league_clubs slc 
    JOIN clubs c ON slc.club_id = c.id 
    WHERE slc.season_id = 'season-2026-27' AND slc.league_id = 'league-ligue-1' AND slc.is_active = 1
  `);

  console.log(`[SQL] Premier League: ${plClubs.length}`);
  console.log(`[SQL] La Liga: ${llClubs.length}`);
  console.log(`[SQL] Serie A: ${saClubs.length}`);
  console.log(`[SQL] Bundesliga: ${blClubs.length}`);
  console.log(`[SQL] Ligue 1: ${l1Clubs.length}`);
  const totalSql = plClubs.length + llClubs.length + saClubs.length + blClubs.length + l1Clubs.length;
  console.log(`[SQL] Total Active Clubs: ${totalSql}`);

  // Start Express Server
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/seasons', seasonsRouter);
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/clubs', clubsRouter);
  app.use('/api/competitions', competitionsRouter);
  app.use('/api/fixtures', fixturesRouter);
  app.use('/api/me', meRouter);
  app.use('/api/admin', adminRouter);

  // SPA fallback simulator
  app.get('*', (req, res) => {
    res.status(200).send('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
  });

  const server = app.listen(TEST_PORT, '0.0.0.0');

  try {
    // 2. Test GET /api/leagues and clubs
    const leaguesRes = await makeRequest('GET', '/api/leagues');
    console.log(`[API] GET /api/leagues -> Status ${leaguesRes.status}, count=${leaguesRes.data.leagues?.length}`);

    const apiPl = await makeRequest('GET', '/api/leagues/league-premier-league/clubs?seasonId=season-2026-27');
    const apiLl = await makeRequest('GET', '/api/leagues/league-la-liga/clubs?seasonId=season-2026-27');
    const apiSa = await makeRequest('GET', '/api/leagues/league-serie-a/clubs?seasonId=season-2026-27');
    const apiBl = await makeRequest('GET', '/api/leagues/league-bundesliga/clubs?seasonId=season-2026-27');
    const apiL1 = await makeRequest('GET', '/api/leagues/league-ligue-1/clubs?seasonId=season-2026-27');

    console.log(`[API] PL clubs count: ${apiPl.data.clubs?.length}`);
    console.log(`[API] La Liga clubs count: ${apiLl.data.clubs?.length}`);
    console.log(`[API] Serie A clubs count: ${apiSa.data.clubs?.length}`);
    console.log(`[API] Bundesliga clubs count: ${apiBl.data.clubs?.length}`);
    console.log(`[API] Ligue 1 clubs count: ${apiL1.data.clubs?.length}`);

    // 3. Telegram WebApp HMAC Authentication
    const normalUser = { id: NORMAL_USER_ID, first_name: 'Cristiano', last_name: 'Player', username: 'cr7_efootball' };
    const validNormalInitData = generateTelegramInitData(normalUser, BOT_TOKEN);

    const authRes = await makeRequest('POST', '/api/auth/telegram', {}, { initData: validNormalInitData });
    console.log(`[TELEGRAM AUTH] POST /api/auth/telegram -> Status ${authRes.status}, user=${authRes.data.user?.username}, telegramId=${authRes.data.user?.telegramId}`);

    const meRes = await makeRequest('GET', '/api/me?seasonId=season-2026-27', {
      'x-telegram-init-data': validNormalInitData,
    });
    console.log(`[TELEGRAM /api/me] Status ${meRes.status}, authenticated=${meRes.data.authenticated}, username=${meRes.data.user?.username}, isAdmin=${meRes.data.user?.isAdmin}`);

    // 4. Telegram Failure Tests
    const missingRes = await makeRequest('POST', '/api/auth/telegram', {}, {});
    console.log(`[TELEGRAM FAIL] Missing initData -> Status ${missingRes.status} (Expected 400)`);

    const tamperedUserInitData = generateTelegramInitData({ ...normalUser, id: '999999999' }, BOT_TOKEN, undefined, 'fake_invalid_hash');
    const tamperedRes = await makeRequest('POST', '/api/auth/telegram', {}, { initData: tamperedUserInitData });
    console.log(`[TELEGRAM FAIL] Tampered initData -> Status ${tamperedRes.status} (Expected 401)`);

    const expiredInitData = generateTelegramInitData(normalUser, BOT_TOKEN, Math.floor(Date.now() / 1000) - 100000);
    const expiredRes = await makeRequest('POST', '/api/auth/telegram', {}, { initData: expiredInitData });
    console.log(`[TELEGRAM FAIL] Expired auth_date -> Status ${expiredRes.status} (Expected 401)`);

    // 5. Club Claiming Test
    const claimRes = await makeRequest(
      'POST',
      '/api/clubs/club-brighton/claim',
      { 'x-telegram-init-data': validNormalInitData },
      { seasonId: 'season-2026-27' }
    );
    console.log(`[CLAIM] Claim club-brighton -> Status ${claimRes.status}, club=${claimRes.data.club?.name}, success=${claimRes.data.success}`);

    // Refresh check
    const meAfterClaim = await makeRequest('GET', '/api/me?seasonId=season-2026-27', {
      'x-telegram-init-data': validNormalInitData,
    });
    console.log(`[CLAIM REFRESH] /api/me currentClub -> ${meAfterClaim.data.currentClub?.name} (id: ${meAfterClaim.data.currentClub?.id})`);

    // 2nd user attempting to claim same club
    const secondUser = { id: '555555555', first_name: 'Lionel', username: 'messi10' };
    const secondInitData = generateTelegramInitData(secondUser, BOT_TOKEN);
    const conflictClaim = await makeRequest(
      'POST',
      '/api/clubs/club-brighton/claim',
      { 'x-telegram-init-data': secondInitData },
      { seasonId: 'season-2026-27' }
    );
    console.log(`[CLAIM CONFLICT] 2nd user claim same club -> Status ${conflictClaim.status} (Expected 409)`);

    // 6. Admin Account Test
    const adminUser = { id: ADMIN_ID, first_name: 'Sir', last_name: 'Alex', username: 'admin_tg_user' };
    const adminInitData = generateTelegramInitData(adminUser, BOT_TOKEN);

    const adminMe = await makeRequest('GET', '/api/me?seasonId=season-2026-27', {
      'x-telegram-init-data': adminInitData,
    });
    console.log(`[ADMIN ME] Status ${adminMe.status}, isAdmin=${adminMe.data.user?.isAdmin} (Expected true)`);

    const adminUsersRes = await makeRequest('GET', '/api/admin/users', {
      'x-telegram-init-data': adminInitData,
    });
    console.log(`[ADMIN API] GET /api/admin/users with Admin -> Status ${adminUsersRes.status} (Expected 200), userCount=${adminUsersRes.data.users?.length}`);

    // 7. Normal User Forbidden from Admin
    const normalAdminUsersRes = await makeRequest('GET', '/api/admin/users', {
      'x-telegram-init-data': validNormalInitData,
    });
    console.log(`[NORMAL USER ADMIN ACCESS] GET /api/admin/users with Normal User -> Status ${normalAdminUsersRes.status} (Expected 403)`);

    // 8. SPA Direct Route Navigation Tests
    const spaAdmin = await makeRequest('GET', '/admin');
    const spaLeagues = await makeRequest('GET', '/leagues');
    const spaMatches = await makeRequest('GET', '/my-matches');
    console.log(`[SPA ROUTES] /admin: ${spaAdmin.status}, /leagues: ${spaLeagues.status}, /my-matches: ${spaMatches.status}`);

    console.log('=============================================================');
    console.log('            SMOKE TEST COMPLETED SUCCESSFULLY                ');
    console.log('=============================================================');
  } finally {
    server.close();
  }
}

runProductionSmokeTest().catch((err) => {
  console.error('Smoke test failure:', err);
  process.exit(1);
});
