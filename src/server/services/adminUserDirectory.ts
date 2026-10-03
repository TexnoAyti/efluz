import type { User } from '../../types';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { FieldPath } from 'firebase-admin/firestore';
import { redisGetFresh, redisSetRaw } from '../readModel/readModelStore';
import { normalizeUserSearch } from '../../lib/userSearch';

export async function getAdminUserDirectory(skipCache = false): Promise<User[]> {
  const key = 'efluz:v1:admin:user-directory';
  const cached = skipCache ? null : await redisGetFresh<User[]>(key);
  if (cached && Array.isArray(cached.data)) return cached.data;
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore unavailable');
  const collection = db.collection(COLLECTIONS.USERS);
  const users: User[] = [];
  let previous: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (let page = 0; page < 50; page++) {
    let query = collection.orderBy(FieldPath.documentId());
    if (previous) query = query.startAfter(previous);
    const snapshot = await query.limit(100).get();
    users.push(...snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as User)));
    if (snapshot.docs.length < 100) {
      await redisSetRaw(key, { data: users, sourceVersion: 'admin-user-directory' }, 30).catch(() => {});
      return users;
    }
    previous = snapshot.docs.at(-1)!;
  }
  throw new Error('ADMIN_USER_DIRECTORY_TOO_LARGE');
}

export async function resolveAdminUserReference(reference: string): Promise<string> {
  const users = await getAdminUserDirectory(true);
  const raw = reference.trim();
  if (!raw.startsWith('@')) {
    const byId = users.find(user => user.id === raw);
    if (byId) return byId.id;
  }
  const query = normalizeUserSearch(raw);
  if (!query) throw new Error('USER_NOT_FOUND');
  const matches = users.filter(user => normalizeUserSearch(user.username || '') === query || (!raw.startsWith('@') && String(user.telegramId) === raw));
  if (matches.length !== 1) throw new Error(matches.length ? 'AMBIGUOUS_USER_REFERENCE' : 'USER_NOT_FOUND');
  return matches[0].id;
}
