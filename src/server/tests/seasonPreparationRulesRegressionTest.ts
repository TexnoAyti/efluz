import assert from 'node:assert/strict';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { PREPARED_TIE_RULES } from '../../content/season2Rules';
import { rankPreparedLeagueResults, type PreparedResult } from '../services/preparedStandingsService';
import { readSeasonPreparationWorkflow,saveSeasonPreparationDraft,preparationReadiness } from '../services/seasonPreparationWorkflow';
import { previewPreparedLeagueSchedule, previewPreparedCupBracket } from '../services/seasonPreparationService';
import { getFirestoreDb } from '../firebase/admin';
import { adminSeasonOperationsRouter } from '../routes/seasonOperations.routes';
const seasonId=EFL_SECOND_SEASON.id;
const ids=(leagueId:string)=>EFL_SECOND_SEASON.leagues.find(l=>l.id===leagueId)!.roster.clubs.map(c=>c.id);
const result=(clubs:string[],h:number,a:number,hs:number,as:number):PreparedResult=>({id:`${h}-${a}`,seasonId,homeClubId:clubs[h],awayClubId:clubs[a],homeScore:hs,awayScore:as,status:'CONFIRMED'});
for(const league of EFL_SECOND_SEASON.leagues){
  const empty=rankPreparedLeagueResults(league.id,[]);
  assert.ok(empty.standings.every(row=>row.position===1&&row.tied));
  assert.equal(empty.canFinalize,false);
  assert.equal(empty.persisted,false);
  assert.throws(()=>rankPreparedLeagueResults(league.id,[],{final:true}),/INCOMPLETE/);
}
const scenario=(leagueId:string)=>{
  const c=ids(leagueId);const fixtures=[result(c,0,1,1,0),result(c,1,0,2,0),result(c,0,2,4,0),result(c,1,2,2,0)];
  return rankPreparedLeagueResults(leagueId,fixtures).standings.slice(0,2).map(row=>row.id);
};
assert.deepEqual(scenario('league-ligue-1'),[ids('league-ligue-1')[1],ids('league-ligue-1')[0]],'Updated Ligue 1 prefers complete head-to-head after overall goal difference');
assert.deepEqual(scenario('league-j1'),[ids('league-j1')[0],ids('league-j1')[1]],'Japan prefers overall goals before head-to-head');
assert.deepEqual(scenario('league-la-liga'),[ids('league-la-liga')[1],ids('league-la-liga')[0]],'Spanish two-team head-to-head goal difference wins');
assert.ok(!PREPARED_TIE_RULES['league-ligue-1'].criteria.includes('h2hAwayGoals'));
const saudi=ids('league-saudi-pro-league');
const saudiFixtures=[result(saudi,0,1,1,0),result(saudi,1,0,0,0),result(saudi,0,2,10,0),result(saudi,2,0,0,0),result(saudi,1,2,1,0),result(saudi,2,1,2,0),result(saudi,0,3,0,0),result(saudi,1,3,1,0),result(saudi,2,3,1,0),result(saudi,1,4,0,0),result(saudi,2,4,0,0),result(saudi,1,5,0,0),result(saudi,2,5,0,0)];
saudiFixtures.push(result(saudi,1,6,1,0),result(saudi,2,6,1,0));
const saudiOverrides=new Map(saudiFixtures.map(f=>[f.homeClubId+'|'+f.awayClubId,f]));
const fullSaudi=previewPreparedLeagueSchedule('league-saudi-pro-league')!.fixtures.map((f,index)=>({
  ...f,id:'saudi-full-'+index,seasonId,status:'CONFIRMED' as const,
  homeScore:saudiOverrides.get(f.homeClubId+'|'+f.awayClubId)?.homeScore||0,
  awayScore:saudiOverrides.get(f.homeClubId+'|'+f.awayClubId)?.awayScore||0,
}));
assert.deepEqual(rankPreparedLeagueResults('league-saudi-pro-league',fullSaudi,{final:true}).standings.slice(0,3).map(row=>row.id),saudi.slice(0,3),'Saudi mini-table criteria must finish before reapplying to a reduced tie');
const pl=ids('league-premier-league');
const first=result(pl,0,1,1,0);
assert.throws(()=>rankPreparedLeagueResults('league-premier-league',[first,{...first,id:'duplicate'}]),/DUPLICATE/);
assert.throws(()=>rankPreparedLeagueResults('league-premier-league',[{...first,seasonId:'season-2026-27'}]),/INVALID/);
assert.throws(()=>rankPreparedLeagueResults('league-premier-league',[{...first,homeScore:-1}]),/INVALID/);
assert.throws(()=>rankPreparedLeagueResults('league-premier-league',[{...first,awayClubId:'club-fake'}]),/INVALID/);
const full=previewPreparedLeagueSchedule('league-premier-league')!.fixtures.map((f,index)=>{
  const h=pl.indexOf(f.homeClubId),a=pl.indexOf(f.awayClubId);
  return {...f,id:'full-'+index,seasonId,status:'CONFIRMED' as const,homeScore:h>a?h-a:0,awayScore:a>h?a-h:0};
});
assert.equal(rankPreparedLeagueResults('league-premier-league',full,{final:true}).canFinalize,true);
assert.equal(rankPreparedLeagueResults('league-premier-league',full,{final:true}).standings[0].id,pl.at(-1));
for(const comp of EFL_SECOND_SEASON.europeanCompetitions){assert.equal(comp.totalTeams,36);assert.equal(comp.totalFixtures,comp.code==='UECL'?108:144);assert.equal(comp.qualificationSlots,null);assert.equal(comp.participantClubIds.length,0);}
assert.equal(EFL_SECOND_SEASON.domesticCups.length,9);
for(const cup of EFL_SECOND_SEASON.domesticCups){
  assert.equal(cup.format,'EFL_CUSTOM');
  assert.equal(cup.participantStatus,'READY');
  assert.deepEqual(cup.participantClubIds,ids(cup.leagueId),'Only the verified clubs of this league participate');
  assert.equal(cup.expectedEntrants,cup.participantClubIds.length);
  assert.equal(cup.preliminaryMatches,cup.expectedEntrants-16);
  assert.equal(cup.playInTeams+cup.byeTeams,cup.expectedEntrants);
  assert.equal(cup.legsPerTie,1);
  const preview=previewPreparedCupBracket(cup.id)!;
  assert.equal(preview.persisted,false);
  assert.equal(preview.drawPending,true);
  assert.equal(preview.totalFixtures,cup.expectedEntrants-1);
  assert.equal(new Set(preview.fixtures.map(f=>f.round)).size,cup.totalRounds);
  const ranks:number[]=[],consumed:string[]=[];
  const winners=new Map<string,number>();
  for(const fixture of preview.fixtures){
    const entrants=[fixture.home,fixture.away].map(slot=>{
      if(slot.leaguePosition!==null){ranks.push(slot.leaguePosition);return slot.leaguePosition;}
      assert.ok(slot.winnerOfFixtureId&&winners.has(slot.winnerOfFixtureId),'Sources must be earlier fixtures');
      consumed.push(slot.winnerOfFixtureId!);
      return winners.get(slot.winnerOfFixtureId!)!;
    });
    assert.notEqual(entrants[0],entrants[1]);
    winners.set(fixture.id,Math.min(...entrants));
  }
  assert.deepEqual(ranks.sort((a,b)=>a-b),Array.from({length:cup.expectedEntrants},(_,i)=>i+1),'Every club enters exactly once');
  assert.equal(new Set(consumed).size,consumed.length,'A winner advances only once');
  assert.equal(consumed.length,preview.fixtures.length-1,'Every non-final winner advances');
  assert.equal(winners.get(preview.fixtures.at(-1)!.id),1,'A complete valid path reaches the final');
}
assert.equal(previewPreparedCupBracket('comp-fa-cup-2026'),null,'Season-one cups cannot enter the preparation path');
assert.ok(!preparationReadiness().blockers.some(b=>b.code.startsWith('CUP_')),'No invented lower-division requirements');
assert.ok(preparationReadiness().blockers.some(b=>b.code==='SUPER_CUP_PLANS_REQUIRED'),'Other incomplete work stays visible');
assert.equal(preparationReadiness().counts.verifiedRankingRules,9);
const uz=ids('league-uzbekistan-superliga');
const uzFixtures=[result(uz,0,1,3,0),result(uz,1,0,4,0),result(uz,0,2,4,0),result(uz,1,2,2,0)].map(f=>({...f,technicalLossClubId:null as string|null}));
assert.ok(rankPreparedLeagueResults('league-uzbekistan-superliga',uzFixtures.map(({technicalLossClubId,...f})=>f)).blockers.includes('MISSING_H2HFORFEITS'));
uzFixtures[0].technicalLossClubId=uz[1];
assert.deepEqual(rankPreparedLeagueResults('league-uzbekistan-superliga',uzFixtures).standings.slice(0,2).map(row=>row.id),uz.slice(0,2),'Uzbek technical-loss exception takes precedence over head-to-head goal difference');
const it=ids('league-serie-a');
const fullItaly=previewPreparedLeagueSchedule('league-serie-a')!.fixtures.map((f,index)=>{
  const h=it.indexOf(f.homeClubId),a=it.indexOf(f.awayClubId),titlePair=h>=18&&a>=18;
  return {...f,id:'italy-full-'+index,seasonId,status:'CONFIRMED' as const,homeScore:titlePair?2:h>a?h-a:0,awayScore:titlePair?0:a>h?a-h:0};
});
assert.ok(rankPreparedLeagueResults('league-serie-a',fullItaly,{final:true}).blockers.includes('SERIE_A_FINALIST_STATUS_REQUIRED'));
const italianPlayoff=rankPreparedLeagueResults('league-serie-a',fullItaly,{final:true,europeanFinalistClubIds:[]});
assert.ok(italianPlayoff.blockers.includes('SERIE_A_TITLE_PLAYOFF_REQUIRED'));
assert.equal(italianPlayoff.specialCases[0].legs,1);
assert.equal(italianPlayoff.specialCases[0].extraTime,false);
assert.equal(rankPreparedLeagueResults('league-serie-a',fullItaly,{final:true,europeanFinalistClubIds:[it[19]]}).canFinalize,true,'Verified FIGC 244/A exception applies if a playoff participant is a UEFA finalist');
const actor={id:'user-5209126900',telegramId:'5209126900',isAdmin:true,isSuspended:false} as any;
const db=getFirestoreDb();
const source={id:EFL_SECOND_SEASON.sourceSeasonId,status:'active'};
await db.collection('seasons').doc(source.id).set(source);
await db.collection('fixtures').doc('preserved-source-result').set({seasonId:source.id,homeScore:3,awayScore:2,status:'CONFIRMED'});
await assert.rejects(readSeasonPreparationWorkflow({...actor,isAdmin:false}),/MAIN_ADMIN_REQUIRED/);
await assert.rejects(saveSeasonPreparationDraft({...actor,telegramId:'other'},{startDate:null,expectedRevision:0}),/MAIN_ADMIN_REQUIRED/);
await assert.rejects(saveSeasonPreparationDraft(actor,{startDate:'2027-02-30',expectedRevision:0}),/INVALID_START_DATE/);
await assert.rejects(saveSeasonPreparationDraft(actor,{startDate:'2027-13-01',expectedRevision:0}),/INVALID_START_DATE/);
const firstSave=await saveSeasonPreparationDraft(actor,{startDate:'2027-01-10',expectedRevision:0});
assert.equal(firstSave.draft?.revision,1);
assert.equal(firstSave.readiness.canActivate,false);
assert.ok(firstSave.readiness.blockers.some(b=>b.code==='SOURCE_SEASON_ONGOING'));
assert.ok(firstSave.readiness.blockers.some(b=>b.code==='RUNTIME_TRANSITION_REQUIRED'));
const retry=await saveSeasonPreparationDraft(actor,{startDate:'2027-01-10',expectedRevision:0});assert.equal(retry.draft?.revision,1,'Identical retry is idempotent');
await assert.rejects(saveSeasonPreparationDraft(actor,{startDate:'2027-01-11',expectedRevision:0}),/REVISION_CONFLICT/);
const races=await Promise.allSettled([saveSeasonPreparationDraft(actor,{startDate:'2027-01-12',expectedRevision:1}),saveSeasonPreparationDraft(actor,{startDate:'2027-01-13',expectedRevision:1})]);
assert.equal(races.filter(item=>item.status==='fulfilled').length,1);
assert.equal(races.filter(item=>item.status==='rejected').length,1);
const saved=(await db.collection('season_preparation_drafts').doc(seasonId).get()).data()!;
assert.equal(saved.status,'PREPARATION');assert.equal(saved.registrationOpen,false);assert.deepEqual(saved.plan,EFL_SECOND_SEASON);
assert.deepEqual((await db.collection('seasons').doc(source.id).get()).data(),source);
assert.equal((await db.collection('seasons').doc(seasonId).get()).exists,false);
assert.equal((await db.collection('fixtures').doc('preserved-source-result').get()).data()?.homeScore,3);
assert.ok(preparationReadiness({sourceArchived:true,startDate:'2027-01-01',draftFingerprint:saved.fingerprint}).blockers.some(b=>b.code==='UEFA_ACCESS_LIST_REQUIRED'));
const post=(adminSeasonOperationsRouter as any).stack.find((layer:any)=>layer.route?.path==='/preparation/standings-preview');
let code=200;const response={status(n:number){code=n;return this;},json(){}};
post.route.stack[0].handle({user:{isAdmin:false},body:{}},response);assert.equal(code,403);
const draftPost=(adminSeasonOperationsRouter as any).stack.find((layer:any)=>layer.route?.path==='/preparation/draft');
await draftPost.route.stack[0].handle({user:actor,body:{startDate:null,expectedRevision:2,status:'active'}},response);assert.equal(code,400,'A client cannot inject activation into a draft');
console.log('SEASON_PREPARATION_RULES_PASS: actual ranking differences, no fake tie winner, 36-team UEFA plans, owner-only versioned drafts and live-season preservation');
