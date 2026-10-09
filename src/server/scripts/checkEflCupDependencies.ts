import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

async function checkEflCupDependencies() {
  console.log('--- CHECKING EFL CUP IN PRODUCTION FIRESTORE ---');
  const db = getFirestoreDb();
  if (!db) {
    console.error('Firestore not available');
    return;
  }

  const eflCompDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc('comp-efl-cup-2026').get();
  console.log('comp-efl-cup-2026 doc exists:', eflCompDoc.exists);
  if (eflCompDoc.exists) {
    console.log('Data:', JSON.stringify(eflCompDoc.data(), null, 2));
  }

  // Also query competitions collection for any other efl-cup docs
  const allCompsSnap = await db.collection(COLLECTIONS.COMPETITIONS).get();
  const eflComps = allCompsSnap.docs.filter((d) => d.id.includes('efl') || (d.data().name && d.data().name.includes('EFL')));
  console.log('Found EFL-related competitions:', eflComps.map((d) => ({ id: d.id, name: d.data().name })));

  const eflCompIds = ['comp-efl-cup-2026', ...eflComps.map((d) => d.id)];
  const uniqueCompIds = Array.from(new Set(eflCompIds));

  for (const compId of uniqueCompIds) {
    console.log(`\nChecking dependencies for ${compId}:`);

    // 1. Fixtures
    const fixSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', compId).get();
    console.log(`  Fixtures count: ${fixSnap.size}`);

    // 2. Standings
    const stdSnap = await db.collection(COLLECTIONS.STANDINGS).where('competitionId', '==', compId).get();
    console.log(`  Standings count: ${stdSnap.size}`);

    // 3. Competition participants
    const partSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId', '==', compId).get();
    console.log(`  Participants count: ${partSnap.size}`);

    // 4. Result submissions
    let subCount = 0;
    if (fixSnap.size > 0) {
      const fixIds = fixSnap.docs.map((d) => d.id);
      for (const fId of fixIds) {
        const subSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', fId).get();
        subCount += subSnap.size;
      }
    }
    console.log(`  Result submissions count: ${subCount}`);

    // 5. Qualification references
    const qualPartSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('sourceCompetitionId', '==', compId).get();
    console.log(`  Qualification references count: ${qualPartSnap.size}`);
  }
}

checkEflCupDependencies().catch(console.error);
