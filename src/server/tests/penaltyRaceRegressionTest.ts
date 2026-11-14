import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {getPenaltyRace,submitPenaltyShot} from '../services/penaltyRaceService';
import type {User} from '../../types';

await initDatabase();
const db=getFirestoreDb(),seasonId='season-penalty-regression',fixtureId='fixture-penalty-regression';
const makeUser=(id:string):User=>({
 id,telegramId:id.replace(/\D/g,'')||'1',username:id,firstName:id,
 isAdmin:false,isSuspended:false,createdAt:'',updatedAt:'',
});
const home=makeUser('user-61001'),away=makeUser('user-61002'),outsider=makeUser('user-61003');
for(const user of [home,away,outsider])await db.collection('users').doc(user.id).set(user);
for(const clubId of ['penalty-home','penalty-away'])
 await db.collection('clubs').doc(clubId).set({id:clubId,name:clubId,leagueId:'penalty',country:'UZ'});
await db.collection('club_occupancies').doc(seasonId+'_penalty-home').set({seasonId,clubId:'penalty-home',userId:home.id,status:'active'});
await db.collection('club_occupancies').doc(seasonId+'_penalty-away').set({seasonId,clubId:'penalty-away',userId:away.id,status:'active'});
await db.collection('fixtures').doc(fixtureId).set({
 id:fixtureId,seasonId,homeClubId:'penalty-home',awayClubId:'penalty-away',
 competitionId:'comp-penalty',matchday:1,status:'SCHEDULED',
});
const first=await getPenaltyRace(fixtureId,home);
assert.deepEqual(first.goals,{home:0,away:0});
assert.equal(first.official,false);
assert.equal((await getPenaltyRace(fixtureId,away)).side,'away');
await assert.rejects(getPenaltyRace(fixtureId,outsider),(e:any)=>e.statusCode===403);
const shot='shot_test_id_000001';
const scored=await submitPenaltyShot(fixtureId,home,shot,true);
assert.equal(scored.goals.home,1);
assert.equal(scored.shots.home,1);
const replay=await submitPenaltyShot(fixtureId,home,shot,true);
assert.equal(replay.goals.home,1,'Retries with the same shot ID never double-count');
await assert.rejects(submitPenaltyShot(fixtureId,home,'shot_test_id_000002',true),(e:any)=>e.statusCode===429);
const opponent=await submitPenaltyShot(fixtureId,away,'shot_test_id_000003',false);
assert.equal(opponent.goals.home,1);
assert.equal(opponent.goals.away,0);
assert.equal(opponent.shots.away,1);
assert.deepEqual((await getPenaltyRace(fixtureId,away)).goals,{home:1,away:0});
await assert.rejects(submitPenaltyShot(fixtureId,outsider,'shot_test_id_000004',true),(e:any)=>e.statusCode===403);
const fixture=(await db.collection('fixtures').doc(fixtureId).get()).data();
assert.equal(fixture?.status,'SCHEDULED','Exhibition never confirms a league match');
assert.equal(fixture?.homeScore,undefined,'Exhibition never modifies official goals');
console.log('PASS serverless penalty race: shared scoreboard, participant authentication, atomic retry dedupe, throttling, zero official match writes');
