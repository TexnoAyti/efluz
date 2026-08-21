import { Router, Request, Response } from 'express';
import { getFirebaseStatus, isFirebaseConfigured, getFirestoreDb } from '../firebase/admin';

export const healthRouter = Router();

healthRouter.get('/', async (req: Request, res: Response) => {
  const status = getFirebaseStatus();

  let isConnected = false;
  let connectionWarning: string | null = null;

  try {
    const db = getFirestoreDb();
    if (db) {
      // Execute an actual Firestore operation to verify connectivity
      await db.collection('seasons').limit(1).get();
      isConnected = true;
    }
  } catch (err: any) {
    connectionWarning = err.message;
    isConnected = false;
  }

  res.json({
    status: 'ok',
    database: 'firestore',
    connected: isConnected,
    firebaseConfigured: status.isConfigured,
    projectId: status.projectId,
    databaseId: status.databaseId,
    authMode: status.authMode,
    warning: connectionWarning || undefined,
    timestamp: new Date().toISOString(),
    version: '2.0.0-firestore-production',
  });
});
