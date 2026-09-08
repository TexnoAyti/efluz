import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { getFirebaseStatus, getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getQueueStats, processPendingMutations } from '../sync/mutationQueue';

export const healthRouter = Router();

healthRouter.get('/', async (req: Request, res: Response) => {
  const status = getFirebaseStatus();
  const cbStatus = firestoreCircuitBreaker.getStatus();
  const queue = getQueueStats();

  let isConnected = false;
  let connectionWarning: string | null = null;

  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      if (db && status.isConfigured) {
        // Lightweight single-document probe to verify Firestore connection without exhausting free-tier read quota
        await db.collection(COLLECTIONS.SEASONS).limit(1).get();
        isConnected = true;
        firestoreCircuitBreaker.recordSuccess();
      } else {
        isConnected = true;
      }
    } catch (err: any) {
      connectionWarning = err.message;
      firestoreCircuitBreaker.recordFailure(err);
      isConnected = false;
    }
  } else {
    connectionWarning = 'Firestore circuit breaker is open (fallback mode active)';
    isConnected = false;
  }

  res.status(200).json({
    status: 'ok',
    database: 'firestore',
    connected: isConnected,
    isOffline: !firestoreCircuitBreaker.canExecute(),
    circuitBreaker: {
      status: cbStatus.state,
      state: cbStatus.state,
      failureCount: cbStatus.totalErrors,
      consecutiveFailures: cbStatus.consecutiveFailures,
      resourceExhaustedCount: cbStatus.resourceExhaustedCount,
      cooldownRemainingMs: cbStatus.cooldownRemainingMs,
    },
    queueStats: queue,
    firebaseConfigured: status.isConfigured,
    projectId: status.projectId,
    databaseId: status.databaseId,
    firestoreDatabaseId: status.databaseId,
    authMode: status.authMode,
    warning: connectionWarning || undefined,
    timestamp: new Date().toISOString(),
    version: '2.0.0-firestore-production',
  });
});

healthRouter.get('/resilience', (req: Request, res: Response) => {
  const cbStatus = firestoreCircuitBreaker.getStatus();
  const queue = getQueueStats();
  res.status(200).json({
    status: 'ok',
    isOffline: !firestoreCircuitBreaker.canExecute(),
    circuitBreaker: cbStatus,
    queueStats: queue,
    timestamp: new Date().toISOString(),
  });
});

healthRouter.post('/sync', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await processPendingMutations();
    res.status(200).json({
      success: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

