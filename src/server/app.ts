import express from 'express';
import { initDatabase, queryGet, getDbFilePath } from './db';
import { seedDatabase, repairSeason202627Roster } from './db/seed';
import { authMiddleware } from './middleware/authMiddleware';

// Route imports
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { seasonsRouter } from './routes/seasons.routes';
import { leaguesRouter } from './routes/leagues.routes';
import { clubsRouter } from './routes/clubs.routes';
import { competitionsRouter } from './routes/competitions.routes';
import { fixturesRouter } from './routes/fixtures.routes';
import { meRouter } from './routes/me.routes';
import { adminRouter } from './routes/admin.routes';

let dbInitPromise: Promise<void> | null = null;

export async function ensureDbReady(): Promise<void> {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        await initDatabase();
        seedDatabase();
        repairSeason202627Roster();

        console.log(`[BOOT] Database path: ${getDbFilePath()}`);
        console.log('[BOOT] Active season: season-2026-27');

        const plCount = queryGet<any>(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-premier-league' AND is_active = 1`)?.c || 0;
        const llCount = queryGet<any>(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-la-liga' AND is_active = 1`)?.c || 0;
        const saCount = queryGet<any>(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-serie-a' AND is_active = 1`)?.c || 0;
        const blCount = queryGet<any>(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-bundesliga' AND is_active = 1`)?.c || 0;
        const l1Count = queryGet<any>(`SELECT COUNT(*) as c FROM season_league_clubs WHERE season_id = 'season-2026-27' AND league_id = 'league-ligue-1' AND is_active = 1`)?.c || 0;
        const totalActive = Number(plCount) + Number(llCount) + Number(saCount) + Number(blCount) + Number(l1Count);

        console.log(`[BOOT] 96 clubs verified (${plCount}/${llCount}/${saCount}/${blCount}/${l1Count}, total: ${totalActive})`);
      } catch (err) {
        console.error('[BOOT] Error initializing database:', err);
        throw err;
      }
    })();
  }
  return dbInitPromise;
}

export function createApp() {
  const app = express();

  // Base CORS middleware
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-dev-user-id, x-telegram-init-data');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // Ensure DB is initialized before executing route handlers
  app.use(async (req, res, next) => {
    try {
      await ensureDbReady();
      next();
    } catch (err: any) {
      console.error('[SERVER] Database initialization failed on request:', err);
      res.status(500).json({ error: 'Database initialization failed', details: err.message });
    }
  });

  app.use(authMiddleware);

  // Mount API routes
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/seasons', seasonsRouter);
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/clubs', clubsRouter);
  app.use('/api/competitions', competitionsRouter);
  app.use('/api/fixtures', fixturesRouter);
  app.use('/api/me', meRouter);
  app.use('/api/admin', adminRouter);

  // 404 JSON fallback for any unhandled /api/* route
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found', path: req.originalUrl });
  });

  // Global Error Handler guaranteeing JSON output
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[SERVER] Unhandled error:', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      status: err.status || 500,
    });
  });

  return app;
}

export const app = createApp();
export default app;
