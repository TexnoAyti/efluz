import assert from 'node:assert/strict';
import fs from 'node:fs';
import {backlogResultAllowed} from '../services/backlogResultEntry';
import {checkFixturePlayability} from '../firebase/firestoreStore';
import {isDomesticCupResult,resolveCupResult} from '../../lib/cupResult';

const euroCompetition = {
  seasonId:'season-2026-27',status:'active',type:'EUROPEAN_LEAGUE_PHASE',
  currentMatchday:8,resultEntryThroughMatchday:8,adminOverrideStatus:'AUTO',
  europeanQualificationMode:'final',europeanQualificationToken:'qualified',
  europeanDrawQualificationToken:'qualified',europeanDrawId:'approved-draw',
};
const fixture = (competitionId:string,matchday:number,extra:Record<string,unknown>={})=>({
  seasonId:'season-2026-27',competitionId,matchday,status:'SCHEDULED',
  homeClubId:'club-a',awayClubId:'club-b',...extra,
});
for (const competitionId of ['comp-champions-league-2026','comp-europa-league-2026']) {
  for (let md=1;md<=8;md++) {
    const match=fixture(competitionId,md,{europeanDrawId:'approved-draw'});
    assert.equal(backlogResultAllowed(match,euroCompetition),true,`${competitionId} matchday ${md} score entry must remain open`);
  }
  assert.equal(backlogResultAllowed(fixture(competitionId,9,{europeanDrawId:'approved-draw'}),euroCompetition),false);
  assert.equal(backlogResultAllowed(fixture(competitionId,2,{europeanDrawId:'old-draw'}),euroCompetition),false);
  assert.equal(backlogResultAllowed(fixture(competitionId,2,{europeanDrawId:'approved-draw'}),euroCompetition,{overrideStatus:'PAUSED'}),false);
  assert.equal(backlogResultAllowed(fixture(competitionId,2,{europeanDrawId:'approved-draw',status:'CONFIRMED'}),euroCompetition),false);
}
// Regression: the legacy checkFixturePlayability used to discard the
// European draw ID when forwarding a fixture to backlogResultAllowed. This
// made all reached rounds except round 8 appear Qulflangan in production.
for (const id of ['comp-champions-league-2026','comp-europa-league-2026']) {
  for (let round=1;round<=8;round++) {
    const state=checkFixturePlayability(id,'season-2026-27',round,'SCHEDULED','club-a','club-b',
      euroCompetition as any,null,true,'approved-draw');
    assert.equal(state.isPlayable,true,`${id}: historical round ${round} is open with the matching published draw`);
  }
  assert.equal(checkFixturePlayability(id,'season-2026-27',1,'SCHEDULED','club-a','club-b',
    euroCompetition as any,null,true,'replaced-draw').isPlayable,false,
    'Old draw must not reopen a superseded fixture');
  assert.equal(checkFixturePlayability(id,'season-2026-27',1,'CONFIRMED','club-a','club-b',
    euroCompetition as any,null,true,'approved-draw').isPlayable,false,
    'Confirmed match may not be modified');
}

const superCup = {
  seasonId:'season-2026-27',status:'active',type:'SUPER_CUP',
  currentMatchday:1,isMatchdayOpen:false,adminOverrideStatus:'AUTO',
};
const superFixture = fixture('comp-community-shield-2026',1);
assert.equal(backlogResultAllowed(superFixture,superCup),true,'Active Super Cup must accept unfinished fixture even if old timer expired');
assert.equal(backlogResultAllowed(fixture('comp-community-shield-2026',2),superCup),false,'Future final rounds may not open');
assert.equal(backlogResultAllowed(superFixture,{...superCup,status:'upcoming'}),false);
assert.equal(backlogResultAllowed(superFixture,{...superCup,adminOverrideStatus:'PAUSED'}),false);
assert.equal(backlogResultAllowed(superFixture,superCup,{isLocked:true}),false);
assert.equal(isDomesticCupResult('comp-community-shield-2026'),true);
assert.equal(isDomesticCupResult('comp-dfl-supercup-2026'),true);
assert.equal(isDomesticCupResult('comp-europa-league-2026'),false);
assert.throws(()=>resolveCupResult({homeScore:1,awayScore:1},{homeClubId:'club-a',awayClubId:'club-b'},true),/g‘olib/);
assert.equal(resolveCupResult({homeScore:1,awayScore:1,homePenaltyScore:5,awayPenaltyScore:4},{homeClubId:'club-a',awayClubId:'club-b'},true).winnerClubId,'club-a');

const clubs = fs.readFileSync('src/components/ClubsView.tsx','utf8');
const chat = fs.readFileSync('src/components/MatchChatHost.tsx','utf8');
const european = fs.readFileSync('src/components/ChampionsLeagueView.tsx','utf8');
const fixtures = fs.readFileSync('src/components/FixturesView.tsx','utf8');
assert.equal(clubs.includes('1-mavsumga qaytish'),false,'Removed Season 1 back-navigation must not return');
assert.ok(chat.includes('src="/games/efl-penalty.html"'),'Chat penalty entry must target the bundled game');
assert.ok(fs.existsSync('public/games/efl-penalty.html'),'Penalty game HTML must ship with production');
assert.ok(chat.includes('onClick={openGame}'),'The chat game must remain directly launchable');
assert.ok(european.includes("const europeanSeasonId = 'season-2026-27'"),'European matches stay in their original season');
assert.ok(fixtures.includes('resultEntryThroughMatchday'),'Reached UEFA matchdays must not be locked by selecting Season 2');
console.log('SEASON_ONE_EURO_SUPERCUP_PASS: UEFA rounds 1–8, safe Super Cup score entry, no Season 1 button, chat penalty asset present');
