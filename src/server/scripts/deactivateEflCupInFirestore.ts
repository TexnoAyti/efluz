import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

async function deactivateEflCupInFirestore() {
  console.log('--- SAFELY MARKING EFL CUP AS HIDDEN / INACTIVE IN PRODUCTION FIRESTORE ---');
  const db = getFirestoreDb();
  if (!db) {
    throw new Error('Firestore not available');
  }

  const eflCompRef = db.collection(COLLECTIONS.COMPETITIONS).doc('comp-efl-cup-2026');
  const snap = await eflCompRef.get();
  if (snap.exists) {
    const currentData = snap.data();
    console.log('Current status:', currentData?.status);
    await eflCompRef.update({
      status: 'inactive',
      hidden: true,
      hiddenAt: new Date().toISOString(),
      deactivatedReason: 'EFL Cup removed from official calendar; preserved for historical integrity',
      updatedAt: new Date().toISOString(),
    });
    console.log('Successfully marked comp-efl-cup-2026 as hidden and inactive.');
  } else {
    console.log('comp-efl-cup-2026 does not exist in Firestore.');
  }
}

deactivateEflCupInFirestore().catch(console.error);
