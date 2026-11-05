import {seasonClubs,seasonLeagues} from '../services/seasonCatalog';
import {buildClubsSnapshot,getLeagueClubsFromReadModel,generateZeroValueStandings} from '../readModel/readModelStore';
import {admissionStatus,setLeagueClubSelection} from '../services/clubAdmission';
import {isLeagueSelectionOpen} from '../../lib/clubAdmission';
import {SEED_CLUBS} from '../db/seed';
import assert from 'node:assert/strict';
import {generatePreparedEuropeanDraw,validatePreparedEuropeanDraw,type EuropeanCode} from '../tournament/preparedEuropeanDraw';
import {buildPreparedTournamentPackage,previewPreparedSuperCup,previewPreparedEuropeanCompetition} from '../services/preparedTournamentPackage';
import {stageSeasonPreparationPackage,saveSeasonPreparationDraft,readSeasonPreparationWorkflow,preparationReadiness} from '../services/seasonPreparationWorkflow';
import {EFL_SECOND_SEASON} from '../../lib/seasonPreparation';
import {previewPreparedLeagueSchedule} from '../services/seasonPreparationService';
import {getFirestoreDb} from '../firebase/admin';

for(const code of ['UCL','UEL','UECL'] as EuropeanCode[]){
  const pots=code==='UECL'?6:4;
  const clubs=Array.from({length:36},(_,i)=>({id:'test-'+i,association:'A'+i,pot:Math.floor(i/(36/pots))+1}));
  const before=JSON.stringify(clubs),draw=generatePreparedEuropeanDraw(code,clubs,'regression-'+code);
  validatePreparedEuropeanDraw(code,clubs,draw);
  assert.equal(draw.length,code==='UECL'?108:144);
  assert.equal(JSON.stringify(clubs),before);
  assert.deepEqual(generatePreparedEuropeanDraw(code,clubs,'regression-'+code),draw,'A seed reproduces the same valid draw');
  assert.throws(()=>validatePreparedEuropeanDraw(code,clubs,[...draw.slice(1),draw[1]]),/INVALID/);
  assert.throws(()=>generatePreparedEuropeanDraw(code,[...clubs.slice(1),clubs[1]],'x'),/INVALID_DRAW_CLUBS/);
  assert.throws(()=>generatePreparedEuropeanDraw(code,clubs.map(c=>({...c,association:'ALL'})),'x'),/UNSATISFIABLE/);
  assert.throws(()=>generatePreparedEuropeanDraw(code,clubs.map(c=>({...c,pot:1})),'x'),/INVALID_POT_COUNTS/);
}
for(const code of ['UCL','UEL','UECL'] as EuropeanCode[]){
  const pots=code==='UECL'?6:4;
  const distribution=Array.from({length:36},(_,i)=>({id:'distribution-'+i,association:'ASSOC'+(i%12),pot:Math.floor(i/(36/pots))+1}));
  for(let seed=0;seed<3;seed++)validatePreparedEuropeanDraw(code,distribution,generatePreparedEuropeanDraw(code,distribution,'distribution-'+seed));
}
const realistic=Array.from({length:36},(_,i)=>({id:'club-'+i,association:'ASSOC'+(i%12),pot:Math.floor(i/9)+1}));
validatePreparedEuropeanDraw('UCL',realistic,generatePreparedEuropeanDraw('UCL',realistic,'associations-12'));
assert.throws(()=>previewPreparedEuropeanCompetition('UCL',realistic.map(c=>({...c,name:c.id,qualification:{route:'DOMESTIC' as const,source:'https://uefa.com.evil.example/proof'}})),'x'),/PROVENANCE/);

const pack=buildPreparedTournamentPackage();
assert.equal(pack.summary.clubs,168);assert.equal(pack.summary.leagueFixtures,2984);assert.equal(pack.summary.cupFixtures,159);assert.equal(pack.summary.superCups,9);
assert.equal(pack.active,false);assert.equal(pack.registrationOpen,false);
assert.equal(pack.fingerprint,buildPreparedTournamentPackage().fingerprint);
assert.ok(Buffer.byteLength(JSON.stringify(pack),'utf8')<900000);
assert.ok(preparationReadiness().blockers.some(b=>b.code==='RUNTIME_TRANSITION_REQUIRED'));
for(const league of EFL_SECOND_SEASON.leagues){
  const preview=previewPreparedSuperCup(league.id)!;
  assert.equal(preview.status,'AWAITING_RESULTS');assert.equal(preview.participantClubIds.length,0);assert.equal(preview.totalFixtures,3);
}
const league=EFL_SECOND_SEASON.leagues[0],ids=league.roster.clubs.map(c=>c.id),cup=EFL_SECOND_SEASON.domesticCups.find(c=>c.leagueId===league.id)!;
const full=previewPreparedLeagueSchedule(league.id)!.fixtures.map((f,index)=>{
  const h=ids.indexOf(f.homeClubId),a=ids.indexOf(f.awayClubId);
  return {...f,id:'result-'+index,seasonId:EFL_SECOND_SEASON.id,status:'CONFIRMED' as const,homeScore:h<a?1:0,awayScore:a<h?1:0};
});
const cupFinal={seasonId:EFL_SECOND_SEASON.id,competitionId:cup.id,status:'CONFIRMED',homeClubId:ids[0],awayClubId:ids[1],winnerClubId:ids[0]};
const superCup=previewPreparedSuperCup(league.id,{fixtures:full,cupFinal})!;
assert.equal(superCup.status,'QUALIFIED');assert.deepEqual(superCup.participantClubIds,ids.slice(0,4),'Duplicate champions are filled by the next league positions');
assert.equal(superCup.fixtures.length,3);
assert.throws(()=>previewPreparedSuperCup(league.id,{fixtures:[],cupFinal}),/INCOMPLETE|FINAL_STANDINGS/);
assert.throws(()=>previewPreparedSuperCup(league.id,{fixtures:full,cupFinal:{...cupFinal,seasonId:'season-2026-27'}}),/INVALID_SUPER_CUP/);

const db=getFirestoreDb(),actor={id:'user-5209126900',telegramId:'5209126900',isAdmin:true,isSuspended:false} as any;
await db.collection('seasons').doc(EFL_SECOND_SEASON.sourceSeasonId).set({status:'active',sentinel:'preserved'});
await db.collection('fixtures').doc('live-sentinel').set({seasonId:EFL_SECOND_SEASON.sourceSeasonId,status:'CONFIRMED',homeScore:4});
await assert.rejects(stageSeasonPreparationPackage({...actor,isAdmin:false},{expectedRevision:0,expectedDraftRevision:1}),/MAIN_ADMIN/);
await assert.rejects(stageSeasonPreparationPackage(actor,{expectedRevision:0,expectedDraftRevision:1}),/DRAFT_NOT_SAVED/);
await saveSeasonPreparationDraft(actor,{expectedRevision:0,startDate:null});
const saved=await stageSeasonPreparationPackage(actor,{expectedRevision:0,expectedDraftRevision:1});
assert.equal(saved.package?.revision,1);assert.equal(saved.package?.current,true);
assert.equal((await stageSeasonPreparationPackage(actor,{expectedRevision:0,expectedDraftRevision:1})).package?.revision,1,'Retry is idempotent');
await saveSeasonPreparationDraft(actor,{expectedRevision:1,startDate:'2027-01-10'});
await assert.rejects(stageSeasonPreparationPackage(actor,{expectedRevision:1,expectedDraftRevision:1}),/OUTDATED/);
assert.equal((await readSeasonPreparationWorkflow(actor)).package?.current,false,'A changed draft makes the staged package stale');
assert.equal((await stageSeasonPreparationPackage(actor,{expectedRevision:1,expectedDraftRevision:2})).package?.revision,2);
assert.equal((await db.collection('season_preparation_packages').doc(EFL_SECOND_SEASON.id).get()).data()?.startDate,'2027-01-10');
assert.equal((await db.collection('seasons').doc(EFL_SECOND_SEASON.id).get()).exists,false);
assert.equal((await db.collection('fixtures').doc('live-sentinel').get()).data()?.homeScore,4);
assert.equal((await db.collection('seasons').doc(EFL_SECOND_SEASON.sourceSeasonId).get()).data()?.sentinel,'preserved');
assert.equal((await readSeasonPreparationWorkflow(actor)).readiness.canActivate,false);
assert.equal(seasonClubs(EFL_SECOND_SEASON.sourceSeasonId),SEED_CLUBS,'Current-season metadata remains the same canonical seed');
assert.equal(seasonClubs(EFL_SECOND_SEASON.id).length,168);
assert.equal(seasonLeagues(EFL_SECOND_SEASON.id).length,9);
const pendingAdmission=admissionStatus(EFL_SECOND_SEASON.id);
assert.equal(pendingAdmission.leagues.length,9);
assert.ok(pendingAdmission.leagues.every(l=>!isLeagueSelectionOpen(pendingAdmission,l.id)),'Future admission is closed by default');
await assert.rejects(setLeagueClubSelection(EFL_SECOND_SEASON.id,'league-j1',true,null,actor.id),/SEASON_NOT_OPEN/);
await db.collection('club_occupancies').doc('source-only-occupancy').set({seasonId:EFL_SECOND_SEASON.sourceSeasonId,clubId:ids[0],userId:actor.id,status:'active'});
const clubs=await buildClubsSnapshot(EFL_SECOND_SEASON.id);
assert.equal(clubs.expectedCount,168);assert.equal(clubs.actualCount,168);
assert.ok(clubs.data.every(c=>!c.ownerUserId),'Future owners are never copied from season one');
for(const l of EFL_SECOND_SEASON.leagues){
  const data=await getLeagueClubsFromReadModel(l.id,EFL_SECOND_SEASON.id);
  assert.equal(data.clubs.length,l.roster.clubs.length);
  const zero=generateZeroValueStandings(l.competitionId,EFL_SECOND_SEASON.id);
  assert.equal(zero.length,l.roster.clubs.length);
  assert.ok(zero.every(row=>row.points===0&&row.played===0));
}
console.log('PREPARED_TOURNAMENT_PACKAGE_PASS: 36-team UEFA draw constraints, 9 super cups, reproducible staging, owner isolation, source preservation');
