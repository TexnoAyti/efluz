import assert from 'node:assert/strict';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { SEED_COMPETITIONS } from '../db/seed';
import { previewEuropeanQualificationSync, applyEuropeanQualificationSync, rebuildEuropeanStandings, getEuropeanStandings } from '../tournament/qualificationEngine';
import { getCompetitionStandingsFromReadModel, redisGetLkg, ReadModelKeys } from '../readModel/readModelStore';
import { projectStandings } from '../tournament/standingsProjection';

function footballStandingsShape(rows: any[]) {
  return rows.map(({ managerUserId, managerUsername, managerFirstName, managerLastName, managerDisplayName, ...row }) => row);
}

async function main() {
  const db=getFirestoreDb(), seasonId='season-2026-27';
  for(const competition of SEED_COMPETITIONS) await db.collection(COLLECTIONS.COMPETITIONS).doc(competition.id).set(competition);
  const fixtureRef=db.collection(COLLECTIONS.FIXTURES).doc('real-league-match');
  await fixtureRef.set({id:'real-league-match',seasonId,competitionId:'comp-premier-league-2026',status:'CONFIRMED',homeClubId:'club-arsenal',awayClubId:'club-chelsea',homeScore:4,awayScore:0});
  const preview=await previewEuropeanQualificationSync(seasonId);
  assert.equal(preview.canApply,true);
  assert.equal(preview.projectedQualifications.find(q=>q.clubId==='club-arsenal')?.rank,1);
  assert.equal(preview.summary.ucl.totalTarget,32);
  const apply=(token:string)=>applyEuropeanQualificationSync({previewToken:token,seasonId,confirmation:true,adminUserId:'real-admin'});
  await fixtureRef.update({homeScore:5});
  await assert.rejects(apply(preview.previewToken),/PREVIEW_DATA_CHANGED/);
  assert.equal((await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).get()).size,0);
  const fresh=await previewEuropeanQualificationSync(seasonId);
  await apply(fresh.previewToken);
  assert.equal((await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).get()).size,64);
  await assert.rejects(apply(fresh.previewToken),/invalid|expired|already/i);
  assert.equal((await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).get()).size,64);
  const ucl=fresh.diff.ucl.competitionId;
  const teams=fresh.projectedQualifications.filter(q=>q.targetCompetitionId===ucl).slice(0,2);
  const match={seasonId,competitionId:ucl,homeClubId:teams[0].clubId,awayClubId:teams[1].clubId,homeScore:2,awayScore:1,status:'CONFIRMED',roundName:'League Phase MD1'};
  await db.collection(COLLECTIONS.FIXTURES).doc('ucl-league-phase').set({...match,id:'ucl-league-phase'});
  await db.collection(COLLECTIONS.FIXTURES).doc('ucl-final').set({...match,id:'ucl-final',roundName:'Final',homeScore:99});
  const rows=await rebuildEuropeanStandings(ucl,seasonId);
  assert.equal(rows.length,32);
  assert.equal(rows.reduce((sum,row)=>sum+row.played,0),2);
  assert.equal(rows.find(row=>row.clubId===teams[0].clubId)?.goalsFor,2);
  const europeanRows=(await getEuropeanStandings(ucl,seasonId)).rows;
  const readModelRows=(await getCompetitionStandingsFromReadModel(ucl,seasonId)).standings;
  assert.deepEqual(footballStandingsShape(europeanRows),footballStandingsShape(readModelRows));
  assert.equal((await redisGetLkg<any[]>(ReadModelKeys.standings(ucl,seasonId)))?.data.length,32);
  assert.equal((await previewEuropeanQualificationSync(seasonId)).canApply,false);
  const projection=projectStandings([{id:'a',name:'A',shortName:'A'},{id:'b',name:'B',shortName:'B'}],[{id:'score',homeClubId:'a',awayClubId:'b',status:'CONFIRMED',homeScore:0,awayScore:0}]);
  assert.equal(projection[0].points,1);
  assert.throws(()=>projectStandings([{id:'a',name:'A',shortName:'A'}],[{id:'bad',homeClubId:'a',awayClubId:'b',status:'CONFIRMED',homeScore:undefined,awayScore:1}]),/INVALID_CONFIRMED_RESULT/);
  console.log('PASS: current results drive qualification, stale previews cannot write, replay cannot duplicate, started Europe is protected, knockout scores excluded, public/admin share one football standings snapshot while owner enrichment may add manager fields');
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});
