import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { SEED_CLUBS } from '../db/seed';
import { clubMemberTag,clubMemberTagsEnabled,clubMemberTagsStatus,reconcileClubMemberTags } from '../services/telegramClubMemberTags';

await initDatabase();
process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='production';process.env.VERCEL_ENV='production';process.env.TELEGRAM_BOT_TOKEN='777:tag-isolated';process.env.TELEGRAM_GROUP_USERNAME='@efleagueuz';
const db=getFirestoreDb(),seasonId='season-2026-27',originalFetch=global.fetch;
await db.collection('seasons').doc(seasonId).set({id:seasonId,status:'active'});
const members=new Map<number,any>(),writes:any[]=[];let canManage=true,rateLimited=false,calls=0;
const clearCooldown=async()=>{const docs=await db.collection('telegram_member_tag_state').get();for(const d of docs.docs)await d.ref.delete();};
async function owner(id:number,clubId:string,extra:any={}) {
 await db.collection('users').doc('user-'+id).set({id:'user-'+id,telegramId:String(id),...extra});
 await db.collection('club_occupancies').doc(`${seasonId}_${clubId}`).set({seasonId,clubId,userId:'user-'+id,status:'active'});
 members.set(id,{status:'member',user:{id,is_bot:false}});
}
await owner(101,'club-arsenal');await owner(102,'club-man-city');members.get(102).status='administrator';
await owner(103,'club-chelsea');members.set(103,{status:'restricted',is_member:true,user:{id:103}});
await owner(104,'club-inter');await owner(104,'club-milan');
await db.collection('user_memberships').doc(`${seasonId}_user-104`).set({status:'active',clubId:'club-milan'});
await owner(105,'club-liverpool');members.get(105).status='left';
await owner(106,'club-tottenham');members.set(106,{badRequest:true});
await owner(107,'club-everton',{isSuspended:true});
await db.collection('club_occupancies').doc('season-2025-26_club-bayern').set({seasonId:'season-2025-26',clubId:'club-bayern',userId:'user-999',status:'active'});
global.fetch=async(input:any,init?:any)=>{
 calls++;const method=String(input).split('/').at(-1),body=JSON.parse(init.body);assert.equal(body.chat_id,'@efleagueuz');
 if(method==='getChatMember') {
  if(body.user_id===777)return Response.json({ok:true,result:{status:'administrator',can_manage_tags:canManage}});
  const member=members.get(body.user_id);assert.ok(member,'No foreign or old-season user is inspected');
  if(member.badRequest)return Response.json({ok:false,error_code:400,description:'user not found'},{status:400});
  return Response.json({ok:true,result:member});
 }
 assert.equal(method,'setChatMemberTag','Never promote users or change admin titles');
 if(rateLimited)return Response.json({ok:false,error_code:429,parameters:{retry_after:120}},{status:429});
 writes.push(body);members.get(body.user_id).tag=body.tag;return Response.json({ok:true,result:true});
};
try {
 assert.ok(clubMemberTagsEnabled());
 for(const c of SEED_CLUBS){const tag=clubMemberTag(c);assert.ok(tag.length>0&&tag.length<=16,c.name);assert.ok(!/\p{Extended_Pictographic}/u.test(tag));}
 assert.equal(clubMemberTag({id:'x',name:'😀 Very Very Long Football Club',shortName:'TEST'}),'TEST');
 const concurrent=await Promise.all([reconcileClubMemberTags(),reconcileClubMemberTags()]);assert.equal(concurrent.filter(Boolean).length,1,'Distributed lease serializes tag workers');
 const first=concurrent.find(Boolean);assert.equal(first?.updated,3);assert.equal(first?.skipped,4);assert.equal(first?.remaining,0);
 assert.deepEqual(writes.map(w=>w.user_id).sort(),[101,103,104]);
 assert.equal(writes.find(w=>w.user_id===101).tag,'Arsenal');
 assert.equal(writes.find(w=>w.user_id===104).tag,clubMemberTag(SEED_CLUBS.find(c=>c.id==='club-milan')!),'Premium member uses the verified primary club');
 assert.equal((await clubMemberTagsStatus()).lastRun?.updated,3);
 assert.deepEqual((await clubMemberTagsStatus()).skippedReasons,{GROUP_ADMIN:1,NOT_IN_GROUP:1,TELEGRAM_USER_NOT_FOUND:1,ACCOUNT_SUSPENDED:1});
 assert.equal((await clubMemberTagsStatus()).pendingDiagnostics,0);
 const publicStatus=JSON.stringify(await clubMemberTagsStatus());assert.ok(!publicStatus.includes('user-102')&&!publicStatus.includes('club-man-city'),'Public diagnostics contain counts only, no account or club identities');
 // Legacy grouped reasons must be rechecked even before their retry timer.
 const legacy=(await db.collection('telegram_member_tags').where('userId','==','user-102').get()).docs[0];
 await legacy.ref.update({reason:'NOT_REGULAR_MEMBER',diagnosticVersion:1,nextCheckAt:Date.now()+86400000});
 assert.equal((await clubMemberTagsStatus()).pendingDiagnostics,1);
 await clearCooldown();await reconcileClubMemberTags();assert.equal((await legacy.ref.get()).data()!.reason,'GROUP_ADMIN');
 assert.equal((await clubMemberTagsStatus()).pendingDiagnostics,0);
 await clearCooldown();const count=writes.length;await reconcileClubMemberTags();assert.equal(writes.length,count,'Unchanged owners do not cause repeated Telegram writes');
 // Transfer triggers changes before the six-hour check interval.
 await db.collection('club_occupancies').doc(`${seasonId}_club-arsenal`).update({userId:'user-108'});
 await db.collection('users').doc('user-108').set({id:'user-108',telegramId:'108'});members.set(108,{status:'member',user:{id:108}});
 await clearCooldown();await reconcileClubMemberTags();assert.equal(members.get(101).tag,'');assert.equal(members.get(108).tag,'Arsenal');
 // An unrelated manual tag is preserved when the club is released.
 members.get(108).tag='Moderator';await db.collection('club_occupancies').doc(`${seasonId}_club-arsenal`).update({status:'released'});
 await clearCooldown();await reconcileClubMemberTags();assert.equal(members.get(108).tag,'Moderator');
 await owner(109,'club-real-madrid');await clearCooldown();canManage=false;const before=writes.length;
 assert.equal((await reconcileClubMemberTags())?.reason,'MANAGE_TAGS_REQUIRED');assert.equal(writes.length,before);
 const beforePause=calls;await reconcileClubMemberTags();assert.equal(calls,beforePause,'Blocked permission checks are backed off');
 await clearCooldown();canManage=true;rateLimited=true;
 assert.equal((await reconcileClubMemberTags())?.reason,'RATE_LIMITED');assert.equal(writes.length,before);
 rateLimited=false;await clearCooldown();await reconcileClubMemberTags();assert.equal(members.get(109).tag,'Real Madrid');
 process.env.SUPABASE_DATA_NAMESPACE='preview';const beforePreview=calls;assert.equal(await reconcileClubMemberTags(),null);assert.equal(calls,beforePreview);
 process.env.SUPABASE_DATA_NAMESPACE='production';process.env.MIGRATION_WRITE_FREEZE='true';assert.equal(await reconcileClubMemberTags(),null);
 delete process.env.MIGRATION_WRITE_FREEZE;process.env.VERCEL_ENV='preview';assert.equal(await reconcileClubMemberTags(),null);
 console.log('PASS official-group regular club-owner tags: 16-character names, current occupancy, primary premium club, transfer/release, manual-tag preservation, admin/nonmember/suspended skips, missing rights and 429 backoff, member lookup isolation, preview/freeze denial; Telegram fully mocked');
} finally {global.fetch=originalFetch;}
