import assert from 'node:assert/strict';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { getUserByIdFirestore } from '../firebase/firestoreStore';
import { requireAdmin } from '../middleware/authMiddleware';

const db = getFirestoreDb();
const ref = db.collection(COLLECTIONS.USERS).doc('authorization-test-user');
await ref.set({ telegramId: '123', username: 'admin', isAdmin: true, isSuspended: false });
const cached = await getUserByIdFirestore(ref.id);
let documentReads = 0;
const originalCollection = db.collection.bind(db);
(db as any).collection = (name: string) => {
  const collection = originalCollection(name);
  if (name !== COLLECTIONS.USERS) throw new Error('Unexpected authorization collection');
  return { doc: (id: string) => {
    assert.equal(id, ref.id);
    return { get: async () => { documentReads++; return collection.doc(id).get(); } };
  }, get: () => { throw new Error('Full users collection read forbidden'); } };
};
async function authorize(expected: boolean) {
  let allowed = false;
  const res: any = { status() { return this; }, json() {} };
  await requireAdmin({ user: cached } as any, res, () => { allowed = true; });
  assert.equal(allowed, expected);
}
await authorize(true);
await ref.update({ isAdmin: false });
await authorize(false);
await ref.update({ isAdmin: true });
await authorize(true);
await ref.update({ isSuspended: true });
await authorize(false);
await ref.delete();
await authorize(false);
assert.equal(documentReads, 5, 'Exactly one document read per authorization');
assert.equal((await getUserByIdFirestore(ref.id))?.isAdmin, true, 'Profile cache remains independent');
assert.equal(documentReads, 5, 'Cached profile adds no read');
(db as any).collection = () => { throw new Error('quota unavailable'); };
await authorize(false);
console.log('PASS admin revoke, restore, suspend, delete and outage fail closed; profile cache preserved; no collection reads');
