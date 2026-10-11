import {FieldPath} from 'firebase-admin/firestore';
import {getFirestoreDb} from '../firebase/admin';
import {normalizeFixtureSnapshot} from '../readModel/readModelStore';
import {filterRetiredFixtures} from './retiredFixtureService';

/** Authoritative cold-start fallback for season reports; bundled SQLite is a historical copy. */
export async function loadPostgresSeasonFixtures(seasonId: string) {
  const rows = await getFirestoreDb().collection('fixtures').where('seasonId', '==', seasonId).get();
  return filterRetiredFixtures(rows.docs.map(doc => normalizeFixtureSnapshot({...doc.data(), id: doc.id}, seasonId)), seasonId);
}

export async function loadPostgresSeasonOwners(seasonId: string) {
  const db = getFirestoreDb();
  const occupancies = (await db.collection('club_occupancies').where('seasonId', '==', seasonId).get()).docs.map(doc => doc.data()).filter(row => row.userId && row.clubId && !['released', 'inactive'].includes(row.status));
  const ids = [...new Set(occupancies.map(row => row.userId))];
  const users = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 30) {
    const rows = await db.collection('users').where(FieldPath.documentId(), 'in', ids.slice(i, i + 30)).get();
    rows.docs.forEach(doc => users.set(doc.id, doc.data()));
  }
  return occupancies.map(row => {
    const user = users.get(row.userId);
    return {id: row.clubId, ownerUserId: row.userId, ownerUsername: user?.username || null, ownerDisplayName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || row.userId};
  });
}
