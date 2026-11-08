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
 ownerships:[{clubId:'unverified-club',ownerUserId:'staging-user'}],
});
assert.equal(session.user?.telegramId,'1234');
assert.equal(session.user?.isAdmin,false);
assert.equal(session.season?.id,'season-2026-27');
assert.deepEqual(session.ownedClubs,[]);
assert.equal(session.currentClub,null);
assert.equal(session.currentClubStatus,'unavailable');
assert.equal(decodeNativeEflBootstrap({ok:true,user:{id:'admin',telegramId:123,isAdmin:true}}).user?.isAdmin,true);
assert.equal(decodeNativeEflBootstrap({ok:true,user:{id:'x',telegramId:'3'},activeSeason:{id:'invalid'}}).season,null);
console.log('PASS_NATIVE_SERVERLESS_BOOTSTRAP: signed backend identity shape and unverified ownership fail closed');
