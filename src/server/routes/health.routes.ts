import { Router, Request, Response } from 'express';
import { getFirebaseStatus, getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

export const healthRouter = Router();

healthRouter.get('/', async (req: Request, res: Response) => {
  const status = getFirebaseStatus();

  let isConnected = false;
  let connectionWarning: string | null = null;
  let usersCount = 0;
  let occupanciesCount = 0;
  let membershipsCount = 0;
  let fixturesCount = 0;

  try {
    const db = getFirestoreDb();
    if (db) {
      // Execute actual Firestore operations to verify live production connectivity & counts
      const [usersSnap, occSnap, memSnap, fixSnap] = await Promise.all([
        db.collection(COLLECTIONS.USERS).get(),
        db.collection(COLLECTIONS.CLUB_OCCUPANCIES).get(),
        db.collection(COLLECTIONS.USER_MEMBERSHIPS).get(),
        db.collection(COLLECTIONS.FIXTURES).get(),
      ]);

      usersCount = usersSnap.size;
      occupanciesCount = occSnap.size;
      membershipsCount = memSnap.size;
      fixturesCount = fixSnap.size;
      isConnected = true;
    }
  } catch (err: any) {
    connectionWarning = err.message;
    isConnected = false;
  }

  res.json({
    status: isConnected ? 'ok' : 'degraded',
    database: 'firestore',
    connected: isConnected,
    firebaseConfigured: status.isConfigured,
    projectId: status.projectId,
    firestoreDatabaseId: status.databaseId,
    databaseId: status.databaseId,
    authMode: status.authMode,
    usersCollectionCount: usersCount,
    clubOccupanciesCollectionCount: occupanciesCount,
    userMembershipsCollectionCount: membershipsCount,
    fixturesCollectionCount: fixturesCount,
    warning: connectionWarning || undefined,
    timestamp: new Date().toISOString(),
    version: '2.0.0-firestore-production',
  });
});
