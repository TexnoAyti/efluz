import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {handleClubOwnerGroupExit,listClubOwnerGroupExits,handleGroupLeaverRelease,markGroupLeaverReleaseConfirmation} from '../services/clubOwnerGroupExitService';
await initDatabase();
const db=getFirestoreDb(),tg=919112233,who='user-'+tg;
await db.collection('users').doc(who).set({id:who,telegramId:String(tg),username:'owner',firstName:'Owner'});
await db.collection('clubs').doc('exit-test-club').set({id:'exit-test-club',name:'Exit Test FC'});
await db.collection('club_occupancies').doc('season-2027-28_exit-test-club').set({userId:who,clubId:'exit-test-club',seasonId:'season-2027-28',status:'active'});
const group={id:-100919199,type:'supergroup',username:'efleagueuz'};
const leave={update_id:101,chat_member:{chat:group,date:1794744000,old_chat_member:{status:'member',user:{id:tg}},new_chat_member:{status:'left',user:{id:tg,first_name:'Owner',username:'owner'}}}};
assert.equal(await handleClubOwnerGroupExit(leave),'recorded');
assert.equal(await handleClubOwnerGroupExit(leave),'ignored','Duplicate webhook update must not alert again');
let list=await listClubOwnerGroupExits();
assert.equal(list.length,1);
assert.equal(list[0].clubs[0].clubName,'Exit Test FC');
assert.equal(list[0].state,'left');
assert.equal((await db.collection('club_occupancies').doc('season-2027-28_exit-test-club').get()).data()?.userId,who,'No owner revocation');
// Admin-only release is tied to one delivered notification and confirmed separately.
const ownerId='5209126900',releaseToken='a'.repeat(32);
await db.collection('users').doc('user-'+ownerId).set({id:'user-'+ownerId,telegramId:ownerId,isAdmin:true,isSuspended:false});
await db.collection('club_owner_group_exit_release_controls').doc(releaseToken).set({
 telegramId:String(tg),userId:who,seasonId:'season-2027-28',clubId:'exit-test-club',
 exitedAt:list[0].exitedAt,expiresAt:Date.now()+3600000,consumed:false,deliveredMessageId:1010,
});
const makeCallback=(action:string,messageId:number,fromId=Number(ownerId))=>({
 from:{id:fromId,is_bot:false},
 message:{message_id:messageId,chat:{type:'private',id:fromId}},
 data:'grouprelease:'+action+':'+releaseToken,
});
assert.equal((await handleGroupLeaverRelease(makeCallback('ask',1010))).status,'confirm');
await markGroupLeaverReleaseConfirmation(releaseToken,1011);
await assert.rejects(()=>handleGroupLeaverRelease(makeCallback('confirm',1011,12345)),'Only primary owner may release');
assert.equal((await db.collection('club_occupancies').doc('season-2027-28_exit-test-club').get()).data()?.userId,who);
const release=await handleGroupLeaverRelease(makeCallback('confirm',1011));
assert.equal(release.status,'released');
assert.equal((await db.collection('club_occupancies').doc('season-2027-28_exit-test-club').get()).data()?.status,'released');
assert.equal((await db.collection('club_occupancies').doc('season-2027-28_exit-test-club').get()).data()?.userId,null);
assert.equal((await db.collection('club_selection_bans').doc(who).get()).exists,false,'Releasing cannot ban player');
await assert.rejects(()=>handleGroupLeaverRelease(makeCallback('confirm',1011)),'Cannot release twice');
const rejoin={update_id:102,message:{date:1794744100,chat:group,new_chat_members:[{id:tg,username:'owner'}]}};
assert.equal(await handleClubOwnerGroupExit(rejoin),'returned');
list=await listClubOwnerGroupExits();
assert.equal(list.length,0,'Rejoined owners disappear from the leavers list');
assert.equal(await handleClubOwnerGroupExit({update_id:103,chat_member:{...leave.chat_member,chat:{...group,username:'another_group'}}}),'ignored','Ignore unrelated groups');
assert.equal(await handleClubOwnerGroupExit({update_id:104,message:{date:1794744200,chat:group,left_chat_member:{id:818100000,first_name:'Not owner'}}}),'not_owner','Ignore non-owners');
console.log('PASS group owners leaving: signed webhook update handling, owner-only report, dedupe, rejoin and ownership preservation');
