import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { getFirebaseStatus, getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getQueueStats, processPendingMutations } from '../sync/mutationQueue';

export const healthRouter = Router();

let lastManualProbeTime = 0;
const MANUAL_PROBE_COOLDOWN_MS = 60000;

healthRouter.get('/', async (req: Request, res: Response) => {
  const status = getFirebaseStatus();
  const cbStatus = firestoreCircuitBreaker.getStatus();

  // Passive health checks must not reserve the circuit breaker's single
  // half-open probe. A real Firestore operation owns that probe instead.
  const isOffline = !status.isConfigured || cbStatus.state !== 'CLOSED' || cbStatus.softLimitExceeded;
  const isConnected = Boolean(status.isConfigured && !isOffline);
  const connectionWarning = !status.isConfigured
    ? 'Firebase credentials not configured'
    : isOffline
    ? 'Firestore circuit breaker is open (fallback mode active)'
    : null;

  res.status(200).json({
    status: 'ok',
    database: 'firestore',
    connected: isConnected,
    isOffline,
    circuitBreaker: {
      status: cbStatus.state,
      state: cbStatus.state,
    },
    firebaseConfigured: status.isConfigured,
    warning: connectionWarning || undefined,
    timestamp: new Date().toISOString(),
    version: '2.0.0-firestore-production',
  });
});

// Explicit diagnostic probe with cooldown (60s)
healthRouter.post('/probe', requireAdmin, async (req: Request, res: Response) => {
  const now = Date.now();
  if (now - lastManualProbeTime < MANUAL_PROBE_COOLDOWN_MS) {
    const waitSec = Math.ceil((MANUAL_PROBE_COOLDOWN_MS - (now - lastManualProbeTime)) / 1000);
    res.status(429).json({
      error: 'Probe in cooldown',
      message: `Please wait ${waitSec}s before probing Firestore again.`,
    });
    return;
  }

  lastManualProbeTime = now;
  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTIONS.SEASONS).limit(1).get();
    firestoreCircuitBreaker.recordSuccess();
    res.status(200).json({
      success: true,
      message: 'Firestore active probe succeeded',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    res.status(503).json({
      success: false,
      error: 'Firestore active probe failed',
      timestamp: new Date().toISOString(),
    });
  }
});

healthRouter.get('/resilience', requireAdmin, (req: Request, res: Response) => {
  const cbStatus = firestoreCircuitBreaker.getStatus();
  const queue = getQueueStats();
  res.status(200).json({
    status: 'ok',
    isOffline: cbStatus.state !== 'CLOSED' || cbStatus.softLimitExceeded,
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
