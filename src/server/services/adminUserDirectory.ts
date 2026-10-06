import type { User } from '../../types';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { FieldPath } from 'firebase-admin/firestore';
import { redisGetFresh, redisSetRaw } from '../readModel/readModelStore';
import { trackFirestoreRead } from '../firebase/firestoreStore';
import { readSharedAdminData } from './adminReviewCache';
import { normalizeUserSearch } from '../../lib/userSearch';

export async function getAdminUserDirectory(skipCache = false): Promise<User[]> {
  const key = 'efluz:v1:admin:user-directory';
  const cached = skipCache ? null : await redisGetFresh<User[]>(key);
  if (cached && Array.isArray(cached.data)) return cached.data;
  return (await readSharedAdminData('efluz:v1:admin:directory-load' + (skipCache ? ':refresh' : ''), async () => {
    const db = getFirestoreDb();
    if (!db) throw new Error('Firestore unavailable');
    const collection = db.collection(COLLECTIONS.USERS);
    const users: User[] = [];
    let previous: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (let page = 0; page < 50; page++) {
      let query = collection.orderBy(FieldPath.documentId());
      if (previous) query = query.startAfter(previous);
      const snapshot = await query.limit(100).get();
      trackFirestoreRead(COLLECTIONS.USERS, Math.max(1, snapshot.docs.length), 'getAdminUserDirectory');
      users.push(...snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id, telegramId: String(data.telegramId || ''), username: data.username || '',
          firstName: data.firstName || '', lastName: data.lastName || '', photoUrl: data.photoUrl || '',
          isAdmin: Boolean(data.isAdmin), adminPermissions: data.adminPermissions, isSuspended: Boolean(data.isSuspended),
          createdAt: data.createdAt || '', updatedAt: data.updatedAt,
        } as User;
      }));
      if (snapshot.docs.length < 100) {
        await redisSetRaw(key, { data: users, sourceVersion: 'admin-user-directory' }, 300).catch(() => {});
        return { users, stale: false, degraded: false, source: 'firestore' };
      }
      previous = snapshot.docs.at(-1)!;
    }
    throw new Error('ADMIN_USER_DIRECTORY_TOO_LARGE');
  }, skipCache ? 1 : 300, 300, skipCache)).users;
}

export async function resolveAdminUserReference(reference: string): Promise<string> {
  const raw = reference.trim();
  const db = getFirestoreDb();
  if (!raw.startsWith('@') && raw && !raw.includes('/')) {
    const direct = await db.collection(COLLECTIONS.USERS).doc(raw).get();
    trackFirestoreRead(COLLECTIONS.USERS, 1, 'resolveAdminUserReference:direct');
    if (direct.exists) return direct.id;
  }
  const query = normalizeUserSearch(raw);
  if (!query) throw new Error('USER_NOT_FOUND');
  const users = await getAdminUserDirectory();
  const matches = users.filter(user => normalizeUserSearch(user.username || '') === query || (!raw.startsWith('@') && String(user.telegramId) === raw));
  // Revalidate cached identity in Firestore. A renamed/deleted account must not
  // receive a club, and exact canonical variants detect duplicate legacy rows.
  const found = new Map<string, any>();
  for (const username of new Set([raw.replace(/^@/, ''), query, ...matches.map(user => user.username || '').filter(Boolean)])) {
    const snap = await db.collection(COLLECTIONS.USERS).where('username', '==', username).limit(2).get();
    trackFirestoreRead(COLLECTIONS.USERS, Math.max(1, snap.docs.length), 'resolveAdminUserReference:username');
    for (const doc of snap.docs) if (normalizeUserSearch(doc.data().username || '') === query) found.set(doc.id, doc.data());
  }
  if (!raw.startsWith('@') && /^\d+$/.test(raw)) {
    const snap = await db.collection(COLLECTIONS.USERS).where('telegramId', '==', raw).limit(2).get();
    trackFirestoreRead(COLLECTIONS.USERS, Math.max(1, snap.docs.length), 'resolveAdminUserReference:telegramId');
    for (const doc of snap.docs) found.set(doc.id, doc.data());
  }
  if (!found.size) {
    // A user who joined/renamed after the shared snapshot may have different
    // letter case. Refresh only this miss, not every assignment request.
    const refreshed = await getAdminUserDirectory(true);
    const canonical = refreshed.filter(user => normalizeUserSearch(user.username || '') === query || (!raw.startsWith('@') && String(user.telegramId) === raw));
    for (const user of canonical) {
      const doc = await db.collection(COLLECTIONS.USERS).doc(user.id).get();
      trackFirestoreRead(COLLECTIONS.USERS, 1, 'resolveAdminUserReference:refresh');
      if (doc.exists && (normalizeUserSearch(doc.data()!.username || '') === query || (!raw.startsWith('@') && String(doc.data()!.telegramId) === raw))) found.set(doc.id, doc.data());
    }
  }
  if (found.size !== 1) throw new Error(found.size ? 'AMBIGUOUS_USER_REFERENCE' : 'USER_NOT_FOUND');
  return [...found.keys()][0];
}
