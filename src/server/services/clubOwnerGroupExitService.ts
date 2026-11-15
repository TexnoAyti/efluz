import {getFirestoreDb} from '../firebase/admin';
import {randomBytes} from 'node:crypto';
import {isPrimaryOwner} from './telegramAiConfigService';
import {sendTelegramMessage,verifyTelegramGroupMembership} from './telegramBotService';
import {PRIMARY_OWNER_TELEGRAM_ID} from './telegramAiConfigService';

type ExitState='left'|'kicked'|'returned';
type OwnerClub={seasonId:string;clubId:string;clubName:string};
type ExitEntry={
 id:string;telegramId:string;userId:string;name:string;username:string;
 state:ExitState;exitedAt:string;returnedAt?:string;group:string;
 clubs:OwnerClub[];lastUpdateId:number;notifiedAt?:string;personalNotifiedAt?:string;
 discoveredBy?:'membership_audit';verifiedAt?:string;
};
const COLLECTION='club_owner_group_exits';
const CONTROLS='club_owner_group_exit_release_controls';
const member=(m:any)=>Boolean(m&&(['creator','administrator','member'].includes(m.status)||(m.status==='restricted'&&m.is_member===true)));
const departing=(m:any)=>m?.status==='left'||m?.status==='kicked'||(m?.status==='restricted'&&m?.is_member===false);
const expectedGroup=()=>String(process.env.TELEGRAM_GROUP_USERNAME||'@efleagueuz').replace(/^@/,'').toLowerCase();
function eventData(update:any){
 const change=update?.chat_member;
 const service=update?.message?.left_chat_member||update?.message?.new_chat_members?.length ? update.message : null;
 const chat=change?.chat||service?.chat;
 if(!chat||String(chat.username||'').toLowerCase()!==expectedGroup() || !['group','supergroup'].includes(chat.type))return null;
 if(change){
  const user=change.new_chat_member?.user;
  if(!Number.isSafeInteger(user?.id)||user.is_bot)return null;
  const old=change.old_chat_member,next=change.new_chat_member;
  if(member(old)&&departing(next))return {user,state:next.status==='kicked'?'kicked' as const:'left' as const,at:change.date};
  if(!member(old)&&member(next))return {user,state:'returned' as const,at:change.date};
  return null;
 }
 const user=service?.left_chat_member||service?.new_chat_members?.[0];
 if(!Number.isSafeInteger(user?.id)||user.is_bot)return null;
 return {user,state:service?.left_chat_member?'left' as const:'returned' as const,at:service.date};
}

export async function handleClubOwnerGroupExit(update:any):Promise<'ignored'|'recorded'|'returned'|'not_owner'>{
 const evt=eventData(update);
 if(!evt)return 'ignored';
 const db=getFirestoreDb(),telegramId=String(evt.user.id),userId='user-'+telegramId;
 const ref=db.collection(COLLECTION).doc(telegramId);
 const previous=await ref.get(),existing=previous.data() as ExitEntry|undefined;
 if(existing&&existing.lastUpdateId>=update.update_id&&!update.membership_audit)return 'ignored';
 if(evt.state==='returned'){
  if(existing){
   await ref.set({...existing,state:'returned',returnedAt:new Date(evt.at*1000).toISOString(),lastUpdateId:update.update_id});
  }
  return 'returned';
 }
 // The group has many members; only current EFLUZ club owners belong in this report.
 const occupied=await db.collection('club_occupancies').where('userId','==',userId).get();
 const active=occupied.docs.map(x=>x.data() as any).filter(x=>x.clubId&&x.seasonId&&(!x.status||x.status==='active'));
 if(!active.length)return 'not_owner';
 const clubs:OwnerClub[]=await Promise.all(active.slice(0,12).map(async x=>{
  const club=await db.collection('clubs').doc(String(x.clubId)).get();
  return {seasonId:String(x.seasonId),clubId:String(x.clubId),clubName:String(club.data()?.name||x.clubId).slice(0,90)};
 }));
 const name=String([evt.user.first_name,evt.user.last_name].filter(Boolean).join(' ')||evt.user.username||telegramId).slice(0,90);
 const now=new Date((Number.isFinite(evt.at)?evt.at:Date.now()/1000)*1000).toISOString();
 const record:ExitEntry={id:telegramId,telegramId,userId,name,username:String(evt.user.username||'').slice(0,70),
  group:expectedGroup(),state:evt.state,exitedAt:now,clubs,lastUpdateId:update.membership_audit?(existing?.lastUpdateId||0):update.update_id,
  ...(update.membership_audit?{discoveredBy:'membership_audit' as const,verifiedAt:now}:{})};
 // Avoid duplicate alerts when Telegram repeats a service message and a member update.
 if(existing?.state===evt.state&&(update.membership_audit || Date.parse(now)-Date.parse(existing.exitedAt)<60_000))return 'ignored';
 await ref.set(record);
 const detail=clubs.map(x=>x.clubName+' ('+x.seasonId.replace('season-','')+')').join(', ');
 const label=update.membership_audit?'tekshiruvda guruhda topilmadi':evt.state==='kicked'?'guruhdan chiqarildi':'guruhdan chiqdi';
 const message='EFLUZ · Klub egasi '+label+'\n\n'+name+
  (record.username?' (@'+record.username+')':'')+'\nKlub: '+detail+
  '\n'+(update.membership_audit?'Tekshirilgan vaqt: ':'Vaqt: ')+now+'\nGuruh: @'+expectedGroup()+
  '\n\nKlub egaligi avtomatik bekor qilinmadi.';
 // Buttons are bound to a specific departure and a specific club.
 const buttons=clubs.map(club=>({club,token:randomBytes(16).toString('hex')}));
 for(const {club,token} of buttons){
  await db.collection(CONTROLS).doc(token).set({
   telegramId,userId,seasonId:club.seasonId,clubId:club.clubId,
   exitedAt:now,expiresAt:Date.now()+7*86400000,
   consumed:false,deliveredMessageId:null,
  });
 }
 const inlineKeyboard=buttons.map(({club,token})=>[{
  text:'Bo‘shatish · '+club.clubName.slice(0,38),
  callback_data:'grouprelease:ask:'+token,
 }]);
 // Record first. If delivery fails, it remains available in the admin endpoint.
 if(PRIMARY_OWNER_TELEGRAM_ID&&process.env.FIREBASE_FORCE_LOCAL_FALLBACK!=='true'){
  const sent=await sendTelegramMessage(PRIMARY_OWNER_TELEGRAM_ID,message,{parse_mode:null,reply_markup:{inline_keyboard:inlineKeyboard}});
  if(sent.ok){
   await ref.set({notifiedAt:new Date().toISOString()},{merge:true});
   if(Number.isSafeInteger(sent.result?.message_id))
    await Promise.all(buttons.map(({token})=>db.collection(CONTROLS).doc(token).set({deliveredMessageId:sent.result.message_id},{merge:true})));
  }
  else console.warn('[CLUB_OWNER_EXIT_ALERT_UNDELIVERED]',{userId});
 }
 // Direct messages are initiated only for known club owners. Telegram may
 // reject users who have not started the bot or have blocked it.
 const personalText='EFLUZ · Guruhga qaytish eslatmasi\n\n'+
  'Siz EFLUZ klub egasi sifatida @'+expectedGroup()+' guruhida hozir a’zo emassiz.\n'+
  'Klubingiz: '+detail+'\n\n'+
  'Uchrashuvlar, joriy tur va muhim e’lonlarni o‘tkazib yubormaslik uchun guruhga qayting.\n'+
  'Klubingiz avtomatik olib qo‘yilmadi.';
 const personal=await sendTelegramMessage(telegramId,personalText,{
  parse_mode:null,
  reply_markup:{inline_keyboard:[[{text:'Guruhga qaytish',url:'https://t.me/'+expectedGroup()}]]},
 });
 if(personal.ok)await ref.set({personalNotifiedAt:new Date().toISOString()},{merge:true});
 else console.warn('[CLUB_OWNER_EXIT_DM_UNDELIVERED]',{userId,errorCode:personal.error_code||null});
 return 'recorded';
}

export async function listClubOwnerGroupExits(){
 const snap=await getFirestoreDb().collection(COLLECTION).get();
 return (snap.docs.map(d=>d.data() as ExitEntry)
  .filter(x=>x.state==='left'||x.state==='kicked')
  .sort((a,b)=>b.exitedAt.localeCompare(a.exitedAt))
  .slice(0,150).map(x=>({name:x.name,username:x.username,telegramId:x.telegramId,
   userId:x.userId,clubs:x.clubs,state:x.state,exitedAt:x.exitedAt,group:x.group,notified:!!x.notifiedAt,
   discoveredBy:x.discoveredBy,verifiedAt:x.verifiedAt})));
}

/**
 * Read-only owner report. Current and former seasons are grouped from the
 * club snapshots taken when a Telegram member left. These snapshots are
 * historic associations, not claims that a club is still assigned today.
 * We only report actual signed Web App identity visits; profile.updatedAt
 * is never a valid substitute for the last login.
 */
export async function listSeasonGroupedClubOwnerExits(){
 const owners=await listClubOwnerGroupExits();
 const db=getFirestoreDb();
 // A bounded admin-only request; no query over all users or match history.
 const enriched=await Promise.all(owners.map(async owner=>{
   let lastWebAppOpenedAt:string|null=null;
   try{
     const user=(await db.collection('users').doc(owner.userId).get()).data() as any;
     const raw=user?.lastWebAppOpenedAt;
     if(typeof raw==='string'&&Number.isFinite(Date.parse(raw)))
       lastWebAppOpenedAt=new Date(raw).toISOString();
   }catch(error){
     console.warn('[GROUP_LEAVER_LAST_OPEN_UNAVAILABLE]',{userId:owner.userId});
   }
   return {...owner,lastWebAppOpenedAt};
 }));
 const bySeason:{
  seasonId:string;label:string;total:number;owners:typeof enriched
 }[]=[
   {seasonId:'season-2027-28',label:'2-mavsum',total:0,owners:[]},
   {seasonId:'season-2026-27',label:'1-mavsum',total:0,owners:[]},
 ];
 for(const bucket of bySeason){
   bucket.owners=enriched.filter(x=>x.clubs.some(club=>club.seasonId===bucket.seasonId))
     .map(x=>({...x,clubs:x.clubs.filter(club=>club.seasonId===bucket.seasonId)}));
   bucket.total=bucket.owners.length;
 }
 const other=enriched.filter(x=>!x.clubs.some(club=>bySeason.some(s=>s.seasonId===club.seasonId)));
 if(other.length)bySeason.push({seasonId:'other',label:'Boshqa mavsumlar',owners:other,total:other.length});
 return {total:enriched.length,bySeason,owners:enriched,activityNote:'lastWebAppOpenedAt = oxirgi tasdiqlangan Telegram Web App autentifikatsiyasi; 30 daqiqada bir yangilanadi. Oldingi sessiyalar uchun vaqt noma’lum.'};
}

/** Two-step, admin-only callback: releasing is irreversible, but never issues a ban. */
export async function handleGroupLeaverRelease(callback:any){
 const fail=(message:string)=>{throw Object.assign(new Error(message),{statusCode:403});};
 if(!isPrimaryOwner(callback.from?.id)||callback.from?.is_bot||
  callback.message?.chat?.type!=='private'||callback.message?.chat?.id!==callback.from?.id)
  fail('Bu tugma faqat asosiy admin uchun.');
 const match=/^grouprelease:(ask|confirm|cancel):([a-f0-9]{32})$/.exec(String(callback.data||''));
 if(!match)fail('Tugma noto‘g‘ri.');
 const [,action,token]=match,db=getFirestoreDb(),controlRef=db.collection(CONTROLS).doc(token);
 const control=(await controlRef.get()).data() as any;
 if(!control||(action==='ask'?control.deliveredMessageId:control.confirmationMessageId)!==callback.message.message_id||
   control.expiresAt<Date.now()||control.consumed)fail('Bu tugma eskirgan yoki ishlatilgan.');
 if(action==='cancel')return {status:'cancelled' as const};
 const exitRef=db.collection(COLLECTION).doc(control.telegramId);
 const exit=(await exitRef.get()).data() as ExitEntry|undefined;
 if(!exit||exit.exitedAt!==control.exitedAt||exit.state==='returned')
  fail('Klub egasi guruhga qaytgan yoki xabar eskirgan.');
 const club=exit.clubs.find(c=>c.seasonId===control.seasonId&&c.clubId===control.clubId);
 if(!club)fail('Klub xabari mos kelmadi.');
 if(action==='ask')return {status:'confirm' as const,token,clubName:club.clubName};
 // Recheck membership at the point of the destructive admin action.
 // On transient Telegram failures, refuse rather than removing a possible
 // returning owner's club.
 if(process.env.FIREBASE_FORCE_LOCAL_FALLBACK!=='true'){
  const membership=await verifyTelegramGroupMembership(control.telegramId,true);
  if(membership.isMember || !['left','kicked','restricted'].includes(membership.status))
   fail('A’zolik hozir aniq tasdiqlanmadi yoki egasi guruhga qaytgan. Klub bo‘shatilmadi.');
 }
 const actorId='user-'+String(callback.from.id),at=new Date().toISOString();
 const released=await db.runTransaction(async tx=>{
  const controlDoc=(await tx.get(controlRef)).data() as any;
  const exitDoc=(await tx.get(exitRef)).data() as ExitEntry|undefined;
  const user=(await tx.get(db.collection('users').doc(actorId))).data() as any;
  if(!user||!isPrimaryOwner(user.telegramId)||!user.isAdmin||user.isSuspended)
   fail('Asosiy admin tekshiruvi bajarilmadi.');
  if(!controlDoc||controlDoc.consumed||controlDoc.expiresAt<Date.now()||
    controlDoc.confirmationMessageId!==callback.message.message_id||
    !exitDoc||exitDoc.state==='returned'||exitDoc.exitedAt!==controlDoc.exitedAt)
   fail('Holat o‘zgargan, qayta tekshiring.');
  const occRef=db.collection('club_occupancies').doc(control.seasonId+'_'+control.clubId);
  const occupancy=(await tx.get(occRef)).data() as any;
  if(!occupancy||occupancy.userId!==control.userId||occupancy.status!=='active')
   fail('Klub egasi o‘zgargan yoki klub allaqachon bo‘sh.');
  const clubRef=db.collection('clubs').doc(control.clubId),clubData=(await tx.get(clubRef)).data() as any;
  const memberRef=db.collection('club_memberships').doc(control.seasonId+'_'+control.clubId);
  const member=(await tx.get(memberRef)).data() as any;
  const userMemberRef=db.collection('user_memberships').doc(control.seasonId+'_'+control.userId);
  const userMember=(await tx.get(userMemberRef)).data() as any;
  if((clubData?.claimedByUserId&&clubData.claimedByUserId!==control.userId)||
    (member?.status==='active'&&member.userId&&member.userId!==control.userId))
   fail('Klubning amaldagi egasi mos kelmadi.');
  // A member with other active clubs must not lose their entire season membership.
  const others=await tx.get(db.collection('club_occupancies')
   .where('userId','==',control.userId).where('status','==','active'));
  const hasOther=others.docs.some((x:any)=>x.id!==occRef.id&&x.data().seasonId===control.seasonId);
  tx.set(occRef,{userId:null,status:'released',releasedAt:at,releasedByUserId:actorId,updatedAt:at},{merge:true});
  if(member)tx.set(memberRef,{status:'released',releasedAt:at,updatedAt:at},{merge:true});
  if(clubData)tx.update(clubRef,{isTaken:false,claimedByUserId:null,updatedAt:at});
  if(userMember?.status==='active'&&!hasOther)
   tx.set(userMemberRef,{status:'released',secondaryClubId:null,secondaryLeagueId:null,releasedAt:at,updatedAt:at},{merge:true});
  tx.set(controlRef,{consumed:true,consumedAt:at},{merge:true});
  tx.set(db.collection('club_owner_group_exit_release_audit').doc(token),
   {actorId,targetId:control.userId,clubId:control.clubId,seasonId:control.seasonId,at,reason:'group_exit_admin_confirmation'});
  return {clubId:control.clubId,seasonId:control.seasonId,userId:control.userId,clubName:club.clubName};
 });
 // Do not roll back the committed release when cache invalidation fails.
 try{
  const [{invalidateClubReadModels,invalidateUserMembershipReadModel},{invalidateFirestoreCache},
   {removeOccupancyRecord,getClubOccupantUserIdLocally}]=await Promise.all([
    import('../readModel/readModelStore'),import('../firebase/firestoreStore'),
    import('../firebase/occupancySnapshot'),
   ]);
  invalidateFirestoreCache();
  if(getClubOccupantUserIdLocally(released.seasonId,released.clubId)===released.userId)
   removeOccupancyRecord(released.seasonId,released.clubId);
  await Promise.allSettled([invalidateClubReadModels(released.seasonId),
    invalidateUserMembershipReadModel(released.userId,released.seasonId)]);
 }catch(error){console.warn('[GROUP_RELEASE_CACHE_INVALIDATION_FAILED]',error);}
 return {status:'released' as const,clubName:released.clubName};
}

export async function markGroupLeaverReleaseConfirmation(token:string,messageId:number){
 if(!/^[a-f0-9]{32}$/.test(token)||!Number.isSafeInteger(messageId))throw new Error('INVALID_GROUP_RELEASE_CONFIRMATION');
 await getFirestoreDb().collection(CONTROLS).doc(token).set({confirmationMessageId:messageId},{merge:true});
}

/**
 * A bounded, admin-invoked audit for club owners who left before Telegram
 * chat_member updates were enabled. Telegram cannot provide historic exit dates.
 * Persist only explicit Telegram 'left'/'kicked' (or restricted/non-member).
 * Transient API errors never count as departures.
 */
export async function reconcileExistingClubOwnerLeavers(options?:{start?:number;batchSize?:number}){
 const db=getFirestoreDb(),start=Math.max(0,Math.floor(options?.start||0));
 const batchSize=Math.max(1,Math.min(15,Math.floor(options?.batchSize||10)));
 // The season occupancy collection is small relative to generic Telegram users.
 // Sort stable IDs before scanning and deduplicate users with several clubs.
 const snapshot=await db.collection('club_occupancies').where('status','==','active').get();
 const users=[...new Set(snapshot.docs.map(d=>String(d.data()?.userId||''))
  .filter(id=>/^user-\d{1,20}$/.test(id)))].sort((a,b)=>a.localeCompare(b));
 const ids=users.slice(start,start+batchSize);
 let found=0,already=0,returned=0,unknown=0;
 for(const id of ids){
  const telegramId=Number(id.slice(5));
  if(!Number.isSafeInteger(telegramId))continue;
  const result=await verifyTelegramGroupMembership(telegramId,true);
  if(['left','kicked','restricted','left_or_not_found'].includes(result.status)&&!result.isMember){
   // 'left_or_not_found' is not definitive: Telegram can return that status
   // for inaccessible users. Do not report them as verified leavers.
   if(result.status==='left_or_not_found'){unknown++;continue;}
   const existing=(await db.collection(COLLECTION).doc(String(telegramId)).get()).data() as ExitEntry|undefined;
   if(existing&&(existing.state==='left'||existing.state==='kicked')){already++;continue;}
   const owner=(await db.collection('users').doc(id).get()).data() as any;
   const now=Math.floor(Date.now()/1000);
   const event={update_id:0,membership_audit:true,chat_member:{
    chat:{type:'supergroup',username:expectedGroup()},
    date:now,old_chat_member:{status:'member',user:{id:telegramId}},
    new_chat_member:{status:result.status,user:{
     id:telegramId,first_name:String(owner?.firstName||owner?.displayName||owner?.username||id),
     username:String(owner?.username||'').replace(/^@/,''),
    }},
   }};
   const outcome=await handleClubOwnerGroupExit(event);
   if(outcome==='recorded')found++;
   else unknown++;
  }else if(result.isMember&&!result.status.startsWith('fail_open')&&
   !['dev_mock_allowed','empty_user_id'].includes(result.status)){
   const ref=db.collection(COLLECTION).doc(String(telegramId));
   const previous=(await ref.get()).data() as ExitEntry|undefined;
   if(previous&&(previous.state==='left'||previous.state==='kicked')){
    await ref.set({...previous,state:'returned',returnedAt:new Date().toISOString()});
    returned++;
   }
  }else unknown++;
 }
 return {total:users.length,checked:ids.length,found,already,returned,unknown,
  next: start+ids.length<users.length?start+ids.length:null};
}
