import express from 'express';
import { initDatabase, queryGet, getDbFilePath } from './db';
import { seedDatabase, repairSeason202627Roster } from './db/seed';
import { cleanupLegacyTestData } from './db/legacyTestDataCleanup';
import { authMiddleware } from './middleware/authMiddleware';
import { getFirebaseStatus } from './firebase/admin';
import { getActiveOccupanciesForSeason } from './firebase/firestoreStore';
import { COLLECTIONS } from './firebase/collections';
import { firestoreCircuitBreaker } from './firebase/circuitBreaker';
import { loadSnapshotFromFile } from './firebase/occupancySnapshot';
import { processPendingMutations } from './sync/mutationQueue';
import { processPendingMatchdayMutations } from './sync/matchdayMutationSync';
import { attemptFirestoreRecoveryProbe } from './firebase/recoveryProbe';
import { hydrateSqliteFromFirestoreSafely } from './firebase/sqliteHydration';
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { seasonsRouter } from './routes/seasons.routes';
import { readOptimizedRouter } from './routes/readOptimized.routes';
import { notificationsReadResilientRouter } from './routes/notificationsReadResilient.routes';
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
  setTimeout(() => { void runReconciliationCycle('startup'); }, 4000);
  const interval = setInterval(() => { void runReconciliationCycle('periodic'); }, 60000);
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

        try {
          const cleanup = cleanupLegacyTestData();
          const removed = cleanup.removedUsers + cleanup.removedResultSubmissions + cleanup.removedTestFixtures + cleanup.resetOfficialFixtures;
          if (removed > 0) console.log('[BOOT] Legacy test data cleanup:', cleanup);
        } catch (cleanupErr: any) {
          console.warn('[BOOT] Legacy test data cleanup warning:', cleanupErr?.message || String(cleanupErr));
        }

        console.log(`[BOOT] SQLite baseline ready from: ${getDbFilePath()}`);
        loadSnapshotFromFile();

        if (fbStatus.isConfigured && firestoreCircuitBreaker.canExecute()) {
          try {
            const hydrated = await hydrateSqliteFromFirestoreSafely();
            if (hydrated) {
              console.log('[BOOT] SQLite cache hydrated from authoritative Firestore.');
              // Firestore may still contain legacy test artifacts created by old verification suites.
              // Purge them again AFTER hydration so they can never reappear in runtime/UI.
              try {
                const cleanup = cleanupLegacyTestData();
                const removed = cleanup.removedUsers + cleanup.removedResultSubmissions + cleanup.removedTestFixtures + cleanup.resetOfficialFixtures;
                if (removed > 0) console.log('[BOOT] Post-hydration legacy test data cleanup:', cleanup);
              } catch (cleanupErr: any) {
                console.warn('[BOOT] Post-hydration legacy test data cleanup warning:', cleanupErr?.message || String(cleanupErr));
              }
            } else {
              console.log('[BOOT] Firestore hydration skipped/aborted; preserving safe local baseline.');
            }
          } catch (fbErr: any) {
            firestoreCircuitBreaker.recordFailure(fbErr);
            console.warn('[BOOT] Firestore hydration warning, operating with resilient SQLite fallback:', fbErr.message);
          }
        } else if (fbStatus.isConfigured) {
          console.log('[BOOT] Firestore read gate is closed; starting in SQLite fallback mode.');
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
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.use(express.json());
  app.use(async (req, res, next) => {
    try { await ensureDbReady(); next(); }
    catch (err: any) { next(err); }
  });
  app.use(authMiddleware);
  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', seasonsRouter);
  app.use('/api', readOptimizedRouter);
  app.use('/api', notificationsReadResilientRouter);
  app.use('/api', leaguesRouter);
  app.use('/api', clubsRouter);
  app.use('/api', competitionsRouter);
  app.use('/api', fixturesResilientRouter);
  app.use('/api', fixturesRouter);
  app.use('/api', meResilientRouter);
  app.use('/api', meRouter);
  app.use('/api', usersRouter);
  app.use('/api', adminFixtureSafetyRouter);
  app.use('/api', adminOfflineControlsRouter);
  app.use('/api', adminResilientRouter);
  app.use('/api', adminRouter);

  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[API ERROR]', err);
    if (res.headersSent) return;
    res.status(err?.status || err?.statusCode || 500).json({ error: err?.message || 'Internal server error' });
  });
  return app;
}

const app = createApp();
export default app;
