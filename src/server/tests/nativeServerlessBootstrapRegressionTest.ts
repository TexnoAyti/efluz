import assert from 'node:assert/strict';
import {decodeNativeEflBootstrap} from '../../lib/nativeServerlessBootstrap';

assert.throws(()=>decodeNativeEflBootstrap(null),/SERVERLESS_BOOTSTRAP_UNVERIFIED/);
assert.throws(()=>decodeNativeEflBootstrap({ok:false}),/SERVERLESS_BOOTSTRAP_UNVERIFIED/);
assert.throws(()=>decodeNativeEflBootstrap({ok:true,user:{id:'x'}}),/SERVERLESS_USER_CONTRACT_MISMATCH/);
const guest=decodeNativeEflBootstrap({ok:true,user:null});
assert.equal(guest.user,null);
const session=decodeNativeEflBootstrap({
 ok:true,user:{id:'staging-user',telegramId:'1234',username:'reader',isAdmin:false},
 activeSeason:{id:'season-2026-27',name:'EFL 1-mavsum',status:'active'},
 ownerships:[{seasonId:'season-2026-27',clubId:'club-arsenal',
 leagueId:'league-epl',clubName:'Arsenal',clubShortName:'ARS',clubCountry:'England',
 clubLogoUrl:'https://example.org/arsenal.png',clubCreatedAt:1790000000}],
});
assert.equal(session.user?.telegramId,'1234');
assert.equal(session.user?.isAdmin,false);
assert.equal(session.season?.id,'season-2026-27');
assert.equal(session.ownedClubs.length,1);
assert.equal(session.currentClub?.id,'club-arsenal');
assert.equal(session.currentClub?.isCurrentUserClub,true);
assert.equal(session.currentClubStatus,'resolved');
const secondSeason=decodeNativeEflBootstrap({
 ok:true,user:{id:'staging-user',telegramId:'1234'},
 activeSeason:{id:'season-2026-27',status:'active'},
 ownerships:[{seasonId:'season-2026-27',clubId:'club-one',leagueId:'league-a',
   clubName:'One',clubShortName:'ONE',clubCountry:'Spain'}]
},'season-2027-28');
assert.deepEqual(secondSeason.ownedClubs,[]);
assert.equal(secondSeason.currentClubStatus,'unavailable');
assert.throws(()=>decodeNativeEflBootstrap({ok:true,user:{id:'x',telegramId:'1'}},'bad-season'),
 /SERVERLESS_INVALID_SEASON/);

assert.throws(()=>decodeNativeEflBootstrap({
 ok:true,user:{id:'x',telegramId:'3'},ownerships:[{clubId:'unverified-club'}]
}),/SERVERLESS_OWNERSHIP_CONTRACT_MISMATCH/);
const missing=decodeNativeEflBootstrap({ok:true,user:{id:'other',telegramId:'5'},ownerships:[]});
assert.equal(missing.currentClubStatus,'unavailable');
assert.equal(decodeNativeEflBootstrap({ok:true,user:{id:'admin',telegramId:123,isAdmin:true}}).user?.isAdmin,true);
assert.equal(decodeNativeEflBootstrap({ok:true,user:{id:'x',telegramId:'3'},activeSeason:{id:'invalid'}}).season,null);
console.log('PASS_NATIVE_SERVERLESS_BOOTSTRAP: signed backend identity shape and unverified ownership fail closed');
