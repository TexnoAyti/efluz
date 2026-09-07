import express from 'express';
import { initDatabase, queryGet, getDbFilePath } from './db';
import { seedDatabase, repairSeason202627Roster } from './db/seed';
import { authMiddleware } from './middleware/authMiddleware';
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
import { meRouter } from './routes/me.routes';
import { usersRouter } from './routes/users.routes';
import { adminFixtureSafetyRouter } from './routes/adminFixtureSafety.routes';
import { adminResilientRouter } from './routes/adminResilient.routes';
import { adminRouter } from './routes/admin.routes';

let dbInitPromise: Promise<void> | null = null;
let syncWorkerStarted = false;

function startBackgroundReconciliation(): void {
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
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        const fbStatus = getFirebaseStatus();

        // Always initialize SQLite baseline so the application is 100% resilient
        await initDatabase();
        seedDatabase();
        repairSeason202627Roster();
        console.log(`[BOOT] SQLite baseline ready from: ${getDbFilePath()}`);

        // Restore occupancy snapshot from disk if available
        loadSnapshotFromFile();

        if (fbStatus.isConfigured) {
          try {
            const db = getFirestoreDb();
            const clubsSnap = await db.collection(COLLECTIONS.CLUBS).limit(1).get();
            if (clubsSnap.empty) {
              console.log('[BOOT] Firestore is empty. Auto-seeding from SQLite baseline...');
              await migrateSqliteToFirestore();
              console.log('[BOOT] Firestore auto-seeding completed.');
            } else {
              console.log(`[BOOT] Connected to authoritative Firestore database: ${fbStatus.databaseId}`);
              // Hydrate occupancy snapshot in background for 0-latency club status checks
              getActiveOccupanciesForSeason('season-2026-27').catch(() => {});
            }
          } catch (fbErr: any) {
            console.warn('[BOOT] Firestore connection warning, operating with resilient SQLite fallback:', fbErr.message);
          }
        }

        // Start background mutation reconciliation worker
        startBackgroundReconciliation();
      } catch (err) {
        console.error('[BOOT] Error during system initialization:', err);
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
  app.use('/api/users', usersRouter);
  // Production safety gate MUST run before legacy admin handlers.
  app.use('/api/admin', adminFixtureSafetyRouter);
  // Local-first admin read/mutation paths MUST run before legacy Firestore-backed handlers.
  app.use('/api/admin', adminResilientRouter);
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
