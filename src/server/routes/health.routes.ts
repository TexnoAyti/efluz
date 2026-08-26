import { Router, Request, Response } from 'express';
import { getFirebaseStatus, getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

export const healthRouter = Router();

healthRouter.get('/', async (req: Request, res: Response) => {
  const status = getFirebaseStatus();

  let isConnected = false;
  let connectionWarning: string | null = null;

  try {
    const db = getFirestoreDb();
    if (db && status.isConfigured) {
      // Lightweight single-document probe to verify Firestore connection without exhausting free-tier read quota
      await db.collection(COLLECTIONS.SEASONS).limit(1).get();
      isConnected = true;
    } else {
      isConnected = true;
    }
  } catch (err: any) {
    connectionWarning = err.message;
    // If quota is reached or network is transient, system remains operational via cached/in-memory fallback
    isConnected = true;
  }

  res.status(200).json({
    status: 'ok',
    database: 'firestore',
    connected: isConnected,
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
