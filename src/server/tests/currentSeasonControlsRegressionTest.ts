import {resolveAiClubs} from '../services/telegramAiEntities';
import assert from 'node:assert/strict';
import {TOP5_CLUBS} from '../../constants/top5Clubs';
import {CURRENT_CLUB_CORRECTIONS,correctCurrentPayload} from '../../content/currentClubCorrections';
import {isSeasonCompetitionEnabled,assertSeasonCompetitionEnabled} from '../../lib/seasonParticipationPolicy';
import {EFL_SECOND_SEASON} from '../../lib/seasonPreparation';
import {admissionStatus,prepareAutomaticAdmissionAdvance} from '../services/clubAdmission';
import {seasonClubs} from '../services/seasonCatalog';
import {getFirestoreDb} from '../firebase/admin';
for(const [legacyId,c] of Object.entries(CURRENT_CLUB_CORRECTIONS)){
  const club=TOP5_CLUBS.find(row=>row.id===legacyId)!;
  assert.ok(club);assert.equal(club.name,c.name);assert.equal(club.id,legacyId);
  const original={seasonId:'season-2026-27',fixture:{id:'fixture-preserve',homeClubId:legacyId,homeScore:4,awayScore:2,homeClub:{id:legacyId,name:'old',ownerUserId:'preserve-user'}},standings:[{clubId:legacyId,clubName:'old',points:39}]};
  const changed=correctCurrentPayload(original);
  assert.equal(changed.fixture.homeClub.name,c.name);assert.equal(changed.fixture.homeClubId,legacyId);
  assert.equal(changed.fixture.homeClub.ownerUserId,'preserve-user');assert.equal(changed.fixture.homeScore,4);assert.equal(changed.standings[0].points,39);
  assert.equal(original.fixture.homeClub.name,'old','Cached source objects remain immutable');
  assert.equal(correctCurrentPayload({...original,seasonId:'season-2025-26'}).fixture.homeClub.name,'old');
}
assert.equal(resolveAiClubs('1. FC Köln',[{id:'club-heidenheim',name:'1. FC Heidenheim'}] as any).clubs[0]?.id,'club-heidenheim');
assert.equal(resolveAiClubs('Heidenheim',[{id:'club-heidenheim',name:'1. FC Köln'}] as any).clubs[0]?.id,'club-heidenheim');
assert.ok(resolveAiClubs('Arsenal',[{id:'club-arsenal',name:'Different club'}] as any).clarification,'Only approved correction IDs permit renamed legacy aliases');
assert.equal(TOP5_CLUBS.length,96);assert.equal(new Set(TOP5_CLUBS.map(c=>c.id)).size,96);
for(const id of ['comp-conference-league-2027','comp-uecl-2026']){
  assert.equal(isSeasonCompetitionEnabled(id,'season-2027-28'),false);
  assert.throws(()=>assertSeasonCompetitionEnabled(id),/olib tashlangan/);
}
assert.ok(!EFL_SECOND_SEASON.europeanCompetitions.some(c=>c.id.includes('conference')));
const seasonId=EFL_SECOND_SEASON.id,db=getFirestoreDb(),leagues=EFL_SECOND_SEASON.leagues;
for(let stage=0;stage<leagues.length;stage++){
  const data={enabled:true,automatic:true,stage};
  const clubs=seasonClubs(seasonId).filter(c=>c.leagueId===leagues[stage].id);
  const next=await db.runTransaction(async tx=>{
    for(const club of clubs.slice(0,-1))await db.collection('club_occupancies').doc(seasonId+'_'+club.id).set({seasonId,clubId:club.id,userId:'owner-'+club.id,status:'active'});
    return prepareAutomaticAdmissionAdvance(tx,db,seasonId,data,clubs.at(-1)!.id);
  });
  assert.equal(next?.stage,stage+1);
  assert.equal(admissionStatus(seasonId,next).activeLeagueId,leagues[stage+1]?.id||null);
}
console.log('CURRENT_SEASON_CONTROLS_PASS: stable club IDs/results/owners, Conference disabled, automatic nine-league order');
