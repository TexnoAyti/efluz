import assert from 'node:assert/strict';
import { getFirestoreDb } from '../firebase/admin';
import { previewBulkLeagueResults, applyBulkLeagueResults } from '../services/bulkLeagueResults';
import type { User } from '../../types';

export async function verifyBulkLeagueResultsSql(failNextCommit: () => void) {
  const db=getFirestoreDb(), seasonId='season-2099-00', competitionId='comp-bulk-sql';
  const user={id:'user-bulk-sql',isAdmin:true,isSuspended:false,username:'bulk-audit'} as User;
  await db.collection('users').doc(user.id).set(user);
  await db.collection('seasons').doc(seasonId).set({id:seasonId,status:'ACTIVE'});
  await db.collection('competitions').doc(competitionId).set({id:competitionId,seasonId,type:'LEAGUE',name:'Bulk SQL audit'});
  const batch=db.batch();
  for(let i=0;i<90;i++) batch.set(db.collection('fixtures').doc('bulk-native-'+i),{id:'bulk-native-'+i,seasonId,competitionId,matchday:1+Math.floor(i/10),homeClubId:'club-arsenal',awayClubId:'club-chelsea',status:'SCHEDULED',updatedAt:'2026-10-22T00:00:00Z'});
  await batch.commit();
  const input={seasonId,fromMatchday:1,toMatchday:9,homeScore:0,awayScore:0};
  const preview=await previewBulkLeagueResults(user,competitionId,input);assert.equal(preview.count,90);
  const body={...input,expectedCount:preview.count,previewHash:preview.previewHash};
  failNextCommit();
  await assert.rejects(applyBulkLeagueResults(user,competitionId,body,'bulk-native-atomic'));
  assert.equal((await db.collection('fixtures').where('competitionId','==',competitionId).where('status','==','CONFIRMED').get()).size,0,'Native SQL rolls back every score');
  assert.equal((await db.collection('audit_logs').where('actorUserId','==',user.id).get()).size,0,'Audit rolls back with fixtures');
  const result=await Promise.all([applyBulkLeagueResults(user,competitionId,body,'bulk-native-atomic'),applyBulkLeagueResults(user,competitionId,body,'bulk-native-atomic')]);
  assert.equal(result.filter(r=>r.replayed).length,1);
  assert.equal((await db.collection('fixtures').where('competitionId','==',competitionId).where('status','==','CONFIRMED').get()).size,90);
  assert.equal((await db.collection('audit_logs').where('actorUserId','==',user.id).get()).size,90);
  assert.equal((await db.collection('result_refresh_jobs').where('competitionId','==',competitionId).get()).size,90);
  await assert.rejects(applyBulkLeagueResults(user,competitionId,body,'bulk-native-other-approval'),/o‘zgargan/);
  console.log('PASS native PostgreSQL 90-match bulk: complete SQL rollback of scores/audits/receipt, successful retry, simultaneous idempotent approval and stale different-key refusal');
}
