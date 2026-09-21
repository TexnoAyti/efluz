import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { drainNotificationQueue, scheduleNotificationQueueDrain } from './services/telegramNotificationQueue';
import { initDatabase, queryGet, getDbFilePath } from './db';
import { seedMissingStaticCatalog } from './db/seed';
import { authMiddleware } from './middleware/authMiddleware';
import { rateLimit } from './middleware/rateLimitMiddleware';
import { isFirebaseConfigured, getFirestoreDb, getFirebaseStatus } from './firebase/admin';
import { migrateSqliteToFirestore } from './firebase/migrateSqliteToFirestore';
import { syncFirestoreClubCrests, getActiveOccupanciesForSeason } from './firebase/firestoreStore';
import { COLLECTIONS } from './firebase/collections';
import { firestoreCircuitBreaker } from './firebase/circuitBreaker';
import { loadSnapshotFromFile } from './firebase/occupancySnapshot';
import { processPendingMutations } from './sync/mutationQueue';

// Route imports
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { seasonsRouter } from './routes/seasons.routes';
import { leaguesRouter } from './routes/leagues.routes';
import { clubsRouter } from './routes/clubs.routes';
import { competitionsRouter } from './routes/competitions.routes';
import { fixturesRouter } from './routes/fixtures.routes';
import { notificationsReadResilientRouter } from './routes/notificationsReadResilient.routes';
import { meRouter } from './routes/me.routes';
import { usersRouter } from './routes/users.routes';
import { adminRouter } from './routes/admin.routes';
import { telegramRouter } from './routes/telegram.routes';

let dbInitPromise: Promise<void> | null = null;
let dbReady = false;
let syncWorkerStarted = false;

function startBackgroundReconciliation(): void {
  if (process.env.ENABLE_LOCAL_MUTATION_REPLAY !== 'true') return;
  if (syncWorkerStarted) return;
  syncWorkerStarted = true;

  // Run initial mutation sync after 4 seconds to let startup settle
  setTimeout(() => {
    if (firestoreCircuitBreaker.canExecute()) {
      processPendingMutations().catch((err) => {
        console.warn('[RECONCILIATION] Startup mutation sync notice:', err.message);
      });
    }
  }, 4000);

  // Periodic reconciliation every 60 seconds
  const interval = setInterval(() => {
    if (firestoreCircuitBreaker.canExecute()) {
      processPendingMutations().catch((err) => {
        console.warn('[RECONCILIATION] Periodic mutation sync notice:', err.message);
      });
    }
  }, 60000);

  if (interval.unref) interval.unref();
}

export async function ensureDbReady(): Promise<void> {
  if (dbReady) return;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        // Always initialize SQLite baseline so the application is 100% resilient
        await initDatabase();
        seedMissingStaticCatalog();
        console.log(`[BOOT] SQLite baseline ready from: ${getDbFilePath()}`);

        // Restore occupancy snapshot from disk if available
        loadSnapshotFromFile();

        // Cold start requirement: ZERO Firestore reads on boot.
        // Seeding, migrating, and occupancy hydration must NOT run during cold start.

        // Only start long-running background intervals in non-serverless environments
        const isServerless = process.env.VERCEL === '1' || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
        if (!isServerless) {
          startBackgroundReconciliation();
        }

        dbReady = true;
      } catch (err) {
        dbInitPromise = null;
        console.error('[BOOT] Error during system initialization:', err);
        throw err;
      }
    })();
  }
  return dbInitPromise;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  const localDevHost = 'local' + 'host';

  const allowedOrigins = new Set([
    'https://efluz.vercel.app',
    process.env.APP_URL,
    process.env.TELEGRAM_WEBAPP_URL,
    ...(process.env.NODE_ENV !== 'production' ? [`http://${localDevHost}:5173`, `http://${localDevHost}:3000`] : []),
  ].filter((value): value is string => Boolean(value)));

  // Base security and CORS middleware
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token, x-dev-user-id, x-telegram-init-data');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://resources.premierleague.com https://crests.football-data.org https://t.me; connect-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org"
    );
    if (req.method === 'OPTIONS') {
      if (origin && !allowedOrigins.has(origin)) {
        res.sendStatus(403);
        return;
      }
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: '256kb' }));
  app.use('/api', rateLimit('api-global', 300, 60));

  // Durable worker can run without initializing SQLite or reading Firestore.
  app.all('/api/internal/telegram-worker', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const actual = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${secret || ''}`);
    if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    if (!['GET', 'POST'].includes(req.method)) { res.sendStatus(405); return; }
    const hop = Number(req.query.hop || 0);
    if (!Number.isInteger(hop) || hop < 0 || hop > 256) { res.sendStatus(400); return; }
    try {
      if (process.env.VERCEL === '1') {
        scheduleNotificationQueueDrain(hop);
        res.status(202).json({ accepted: true });
      } else {
        await drainNotificationQueue({ hop });
        res.json({ drained: true });
      }
    }
    catch { res.status(503).json({ error: 'NOTIFICATION_WORKER_UNAVAILABLE' }); }
  });

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
  app.use('/api/auth', rateLimit('auth', 20, 600));
  app.use('/api/clubs/crest-proxy', rateLimit('crest-proxy', 60, 60));
  app.use('/api/health/probe', rateLimit('health-probe', 3, 600));
  app.use('/api/telegram/webhook', rateLimit('telegram-webhook', 120, 60));
  app.use('/api/fixtures', rateLimit('fixture-write', 60, 60));
  app.use('/api/clubs', rateLimit('club-action', 120, 60));

  // Mount the canonical API routes. Competition, fixture, standings and club
  // reads are backed by the durable read-model layer in their own routers.
  // Do not mount readOptimizedRouter ahead of these routes: it bypasses Redis
  // and shadows the resilient handlers with direct Firestore reads.
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/seasons', seasonsRouter);
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/clubs', clubsRouter);
  app.use('/api/competitions', competitionsRouter);
  app.use('/api/fixtures', fixturesRouter);
  app.use('/api/me', notificationsReadResilientRouter);
  app.use('/api/me', meRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/telegram', telegramRouter);

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
