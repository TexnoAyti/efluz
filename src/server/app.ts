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
import { processPendingMatchdayMutations } from './sync/matchdayMutationSync';
import { attemptFirestoreRecoveryProbe } from './firebase/recoveryProbe';

import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { seasonsRouter } from './routes/seasons.routes';
import { leaguesRouter } from './routes/leagues.routes';
import { clubsRouter } from './routes/clubs.routes';
import { competitionsRouter } from './routes/competitions.routes';
import { fixturesResilientRouter } from './routes/fixturesResilient.routes';
import { fixturesRouter } from './routes/fixtures.routes';
import { meResilientRouter } from './routes/meResilient.routes';
import { meRouter } from './routes/me.routes';
import { usersRouter } from './routes/users.routes';
import { adminFixtureSafetyRouter } from './routes/adminFixtureSafety.routes';
import { adminOfflineControlsRouter } from './routes/adminOfflineControls.routes';
import { adminResilientRouter } from './routes/adminResilient.routes';
import { adminRouter } from './routes/admin.routes';

let dbInitPromise: Promise<void> | null = null;
let syncWorkerStarted = false;

async function runReconciliationCycle(label: string): Promise<void> {
  try {
    const recovered = await attemptFirestoreRecoveryProbe();
    if (!recovered) return;
    await processPendingMatchdayMutations();
    await processPendingMutations();
  } catch (err: any) {
    console.warn(`[RECONCILIATION] ${label} cycle notice:`, err?.message || String(err));
  }
}

function startBackgroundReconciliation(): void {
  if (syncWorkerStarted) return;
  syncWorkerStarted = true;
  setTimeout(() => {
    void runReconciliationCycle('startup');
  }, 4000);
  const interval = setInterval(() => {
    void runReconciliationCycle('periodic');
  }, 60000);
  if (interval.unref) interval.unref();
}

export async function ensureDbReady(): Promise<void> {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        const fbStatus = getFirebaseStatus();
        await initDatabase();
        seedDatabase();
        repairSeason202627Roster();
        console.log(`[BOOT] SQLite baseline ready from: ${getDbFilePath()}`);
        loadSnapshotFromFile();

        if (fbStatus.isConfigured) {
          try {
            const db = getFirestoreDb();
            if (firestoreCircuitBreaker.canExecute()) {
              const clubsSnap = await db.collection(COLLECTIONS.CLUBS).limit(1).get();
              if (clubsSnap.empty) {
                console.log('[BOOT] Firestore is empty. Auto-seeding from SQLite baseline...');
                await migrateSqliteToFirestore();
                console.log('[BOOT] Firestore auto-seeding completed.');
              } else {
                console.log(`[BOOT] Connected to authoritative Firestore database: ${fbStatus.databaseId}`);
                getActiveOccupanciesForSeason('season-2026-27').catch(() => {});
              }
            } else {
              console.log('[BOOT] Firestore read gate is closed; starting in SQLite fallback mode.');
            }
          } catch (fbErr: any) {
            firestoreCircuitBreaker.recordFailure(fbErr);
            console.warn('[BOOT] Firestore connection warning, operating with resilient SQLite fallback:', fbErr.message);
          }
        }
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
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/seasons', seasonsRouter);
  app.use('/api/leagues', leaguesRouter);
  app.use('/api/clubs', clubsRouter);
  app.use('/api/competitions', competitionsRouter);
  app.use('/api/fixtures', fixturesResilientRouter);
  app.use('/api/fixtures', fixturesRouter);
  app.use('/api/me', meResilientRouter);
  app.use('/api/me', meRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/admin', adminFixtureSafetyRouter);
  app.use('/api/admin', adminOfflineControlsRouter);
  app.use('/api/admin', adminResilientRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found', path: req.originalUrl });
  });
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[SERVER] Unhandled error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error', status: err.status || 500 });
  });
  return app;
}

export const app = createApp();
export default app;