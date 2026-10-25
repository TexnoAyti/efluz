import {createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {TEAM_PREVIEW_OWNER,TEAM_DIRECTORY_LIMIT,TEAM_LEAGUE_MAX_TEAMS,canSeeTeamPreview,type PreviewTeam,type TeamInvitation,type TeamTicketAccount} from '../../types/teamLeaguePreview';
import {TEAM_COLLECTION,LEAGUE_COLLECTION,teamError,teamId,teamText,readTeamActor,teamActor,assertTeamManager,requireTeamGroup,teamGroupInfo,validateTeamLogo,assertSingleTeamMembership,prepareSingleTeamMembership} from './teamAccess';
import {resolveAdminUserReference} from './adminUserDirectory';
const TICKETS='team_creation_tickets',LEDGER='team_ticket_transactions',INVITES='team_membership_invitations',RECEIPTS='team_membership_receipts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const requestKey=(value:unknown)=>{if(typeof value!=='string'||! /^[A-Za-z0-9_-]{8,100}$/.test(value))throw teamError('So‘rov kodi noto‘g‘ri. Sahifani yangilang.');return value;};
const inviteId=(value:unknown)=>{if(typeof value!=='string'||!/^ti_[a-f0-9]{32}$/.test(value))throw teamError('Taklif kodi noto‘g‘ri.');return value;};
const account=(id:string,value?:TeamTicketAccount):TeamTicketAccount=>value||{userId:id,balance:0,totalGranted:0,totalSpent:0,totalRevoked:0,updatedAt:''};
const html=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const display=(user:any)=>[user.firstName,user.lastName].filter(Boolean).join(' ').trim().slice(0,50)||String(user.username||'O‘yinchi').slice(0,50);
export async function platformTeamOwner(){const rows=await getFirestoreDb().collection('users').where('telegramId','==',TEAM_PREVIEW_OWNER).limit(2).get();if(rows.docs.length!==1)throw teamError('Loyiha egasi akkauntini aniqlab bo‘lmadi.',503);return teamActor(rows.docs[0].id);}
export async function resolveTeamUser(reference:unknown){
 const raw=teamText(reference,80);if(raw.includes('/'))throw teamError('Bitta aniq @username, Telegram ID yoki EFLUZ ID kiriting.');
 try{if(/^\d{1,20}$/.test(raw)){const rows=await getFirestoreDb().collection('users').where('telegramId','==',raw).limit(2).get();if(rows.docs.length!==1)throw new Error(rows.empty?'USER_NOT_FOUND':'AMBIGUOUS_USER_REFERENCE');return teamActor(rows.docs[0].id);}return await teamActor(await resolveAdminUserReference(raw));}catch(e:any){if(e.message==='AMBIGUOUS_USER_REFERENCE')throw teamError('Bir nechta akkaunt topildi. Aniq EFLUZ ID kiriting.',409);if(e.statusCode)throw e;throw teamError('Foydalanuvchi topilmadi. Avval botga kirgan akkauntni tanlang.',404);}
}
export async function getTeamTicketBalance(actorId:string,targetId=actorId){
 const actor=await teamActor(actorId);if(actorId!==targetId&&!canSeeTeamPreview(actor.telegramId))throw teamError('Ticket hisobini ko‘rishga ruxsat yo‘q.',403);
 if(targetId!==actorId)await teamActor(targetId);const db=getFirestoreDb();return account(targetId,(await db.collection(TICKETS).doc(targetId).get()).data() as TeamTicketAccount|undefined);
}
export async function changeTeamTickets(actorId:string,body:any,kind:'GRANT'|'REVOKE'){
 const actor=await teamActor(actorId);if(!canSeeTeamPreview(actor.telegramId))throw teamError('Team ticketini faqat loyiha egasi boshqaradi.',403);
 const target=await resolveTeamUser(body.targetUserId||body.reference),amount=body.amount,key=requestKey(body.idempotencyKey||body.requestId);
 if(!Number.isInteger(amount)||amount<1||amount>100)throw teamError('Ticket soni 1–100 oralig‘idagi butun son bo‘lsin.');
 if(body.expectedUsername&&String(target.username||'').replace(/^@/,'').toLowerCase()!==String(body.expectedUsername).replace(/^@/,'').toLowerCase())throw teamError('Foydalanuvchi username’i o‘zgargan. Qayta tanlang.',409);
 const db=getFirestoreDb(),receipt=db.collection(RECEIPTS).doc(hash(actorId+':tickets:'+key)),ref=db.collection(TICKETS).doc(target.id),digest=hash(JSON.stringify([kind,target.id,amount]));
 return db.runTransaction(async tx=>{
  const issuer=await readTeamActor(tx,actorId);if(!canSeeTeamPreview(issuer.telegramId))throw teamError('Ticket boshqaruvi yopiq.',403);
  const verifiedTarget=await readTeamActor(tx,target.id);if(body.expectedUsername&&String(verifiedTarget.username||'').replace(/^@/,'').toLowerCase()!==String(body.expectedUsername).replace(/^@/,'').toLowerCase())throw teamError('Username o‘zgargan. Qayta tanlang.',409);const old=(await tx.get(receipt)).data(),current=account(target.id,(await tx.get(ref)).data() as TeamTicketAccount|undefined);
  if(old){if(old.digest!==digest)throw teamError('Bu so‘rov kodi boshqa amal uchun ishlatilgan.',409);return {account:current,transactionId:old.transactionId};}
  if(kind==='REVOKE'&&current.balance<amount)throw teamError('Faqat sarflanmagan ticketlarni qaytarib olish mumkin.',409);
  const updated={...current,balance:current.balance+(kind==='GRANT'?amount:-amount),totalGranted:current.totalGranted+(kind==='GRANT'?amount:0),totalRevoked:current.totalRevoked+(kind==='REVOKE'?amount:0),updatedAt:new Date().toISOString()},transactionId='tt_'+hash(actorId+':'+key).slice(0,40);
  tx.set(ref,updated);tx.set(db.collection(LEDGER).doc(transactionId),{id:transactionId,userId:target.id,actorId,kind,amount,note:typeof body.note==='string'?body.note.slice(0,200):'',createdAt:updated.updatedAt});tx.set(receipt,{digest,transactionId});return {account:updated,transactionId};
 });
}
export async function createMembershipTeam(actorId:string,body:any){
 const actor=await teamActor(actorId),owner=await platformTeamOwner(),key=requestKey(body.requestId||body.idempotencyKey),name=teamText(body.name),logo=await validateTeamLogo(body.logo||'');
 await requireTeamGroup(actor.telegramId);
 const db=getFirestoreDb(),id='tp_'+hash(actorId+':create:'+key).slice(0,40),ref=db.collection(TEAM_COLLECTION).doc(id),ticketRef=db.collection(TICKETS).doc(actorId),digest=hash(JSON.stringify([name,logo])),receipt=db.collection(RECEIPTS).doc(hash(actorId+':create:'+key));
 return db.runTransaction(async tx=>{
  const creator=await readTeamActor(tx,actorId),platform=await readTeamActor(tx,owner.id);if(!canSeeTeamPreview(platform.telegramId))throw teamError('Loyiha egasi akkaunti o‘zgargan.',409);
  const old=(await tx.get(receipt)).data(),existing=(await tx.get(ref)).data() as PreviewTeam|undefined;
  const current=account(actorId,(await tx.get(ticketRef)).data() as TeamTicketAccount|undefined);
  if(old){if(old.digest!==digest||!existing)throw teamError('Bu so‘rov kodi boshqa team uchun ishlatilgan.',409);return existing;}
  const claimMembership=await prepareSingleTeamMembership(tx,actorId,id);
  const teams=await tx.get(db.collection(TEAM_COLLECTION).where('ownerId','==',owner.id).limit(TEAM_DIRECTORY_LIMIT+1));
  if(teams.size>=TEAM_DIRECTORY_LIMIT)throw teamError('Jamoalar bo‘limi to‘lgan. Loyiha egasiga murojaat qiling.',409);
  const free=canSeeTeamPreview(creator.telegramId);if(!free&&current.balance<1)throw teamError('Team yaratish uchun 1 ta team ticketi kerak. Loyiha egasidan ticket oling.',402,'TEAM_TICKET_REQUIRED');
  const member={id:'tp_'+hash(actorId).slice(0,32),name:display(creator),userId:actorId,verified:true};
  const team:PreviewTeam={id,ownerId:owner.id,adminUserId:actorId,memberUserIds:[actorId],membershipRequired:true,name,logo,members:[member],captainMemberId:member.id,version:1,updatedAt:new Date().toISOString()};
  if(!free){tx.set(ticketRef,{...current,balance:current.balance-1,totalSpent:current.totalSpent+1,updatedAt:team.updatedAt});tx.set(db.collection(LEDGER).doc('tt_'+hash(actorId+':create:'+key).slice(0,40)),{userId:actorId,actorId,kind:'SPEND',amount:1,teamId:id,createdAt:team.updatedAt});}
  claimMembership();tx.set(ref,team);tx.set(receipt,{digest,teamId:id});return team;
 });
}
export async function getTeamMembershipWorkspace(actorId:string){
 const actor=await teamActor(actorId),db=getFirestoreDb();
 const [teams,memberTeams,invitations,tickets]=await Promise.all([db.collection(TEAM_COLLECTION).where('adminUserId','==',actorId).limit(TEAM_DIRECTORY_LIMIT).get(),db.collection(TEAM_COLLECTION).where('memberUserIds','array-contains',actorId).limit(TEAM_DIRECTORY_LIMIT).get(),db.collection(INVITES).where('inviteeId','==',actorId).where('status','==','PENDING').orderBy('expiresAt','desc').limit(TEAM_DIRECTORY_LIMIT).get(),db.collection(TICKETS).doc(actorId).get()]);
 return {teams:[...new Map([...teams.docs,...memberTeams.docs].map(d=>[d.id,d.data() as PreviewTeam])).values()],invitations:invitations.docs.map(d=>d.data() as TeamInvitation).map(i=>Date.parse(i.expiresAt)<=Date.now()?{...i,status:'EXPIRED' as const}:i),tickets:account(actorId,tickets.data() as TeamTicketAccount|undefined),isOwner:canSeeTeamPreview(actor.telegramId),...teamGroupInfo(),maxLeagueTeams:TEAM_LEAGUE_MAX_TEAMS};
}
async function activeRosterLock(tx:any,team:PreviewTeam){const leagues=await tx.get(getFirestoreDb().collection(LEAGUE_COLLECTION).where('ownerId','==',team.ownerId));if(leagues.docs.some((d:any)=>d.data().status==='ACTIVE'&&d.data().teamIds.includes(team.id)))throw teamError('Team faol turnirda. Tarkib o‘zgarishlari turnir tugagach tasdiqlanadi.',409,'TEAM_ROSTER_LOCKED');}
export async function getManagedTeam(actorId:string,id:string){
 teamId(id);const user=await teamActor(actorId),db=getFirestoreDb(),team=(await db.collection(TEAM_COLLECTION).doc(id).get()).data() as PreviewTeam|undefined;assertTeamManager(team,user);
 const [pending,recent]=await Promise.all([db.collection(INVITES).where('teamId','==',id).where('status','==','PENDING').limit(200).get(),db.collection(INVITES).where('teamId','==',id).orderBy('createdAt','desc').limit(100).get()]);const invites=[...new Map([...pending.docs,...recent.docs].map(d=>[d.id,d.data() as TeamInvitation])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return {team,invitations:invites.map(i=>i.status==='PENDING'&&Date.parse(i.expiresAt)<=Date.now()?{...i,status:'EXPIRED' as const}:i)};
}
export async function updateMembershipTeam(actorId:string,id:string,body:any){
 teamId(id);const image=body.logo===undefined?undefined:await validateTeamLogo(body.logo),db=getFirestoreDb(),ref=db.collection(TEAM_COLLECTION).doc(id);
 return db.runTransaction(async tx=>{const actor=await readTeamActor(tx,actorId),team=(await tx.get(ref)).data() as PreviewTeam|undefined;assertTeamManager(team,actor);const onlyRole=canSeeTeamPreview(actor.telegramId)&&body.adminUserId!==undefined&&!body.removeMemberId&&(body.name===undefined||body.name===team.name)&&(image===undefined||image===team.logo)&&(body.captainMemberId===undefined||body.captainMemberId===team.captainMemberId);if(!onlyRole)await activeRosterLock(tx,team);if(team.version!==body.version)throw teamError('Team yangilangan. Qayta yuklang.',409);
  if(body.adminUserId!==undefined){if(!canSeeTeamPreview(actor.telegramId))throw teamError('Team administratorini faqat loyiha egasi tayinlaydi.',403);if(body.adminUserId!==team.ownerId&&!team.members.some(m=>m.userId===body.adminUserId&&m.verified))throw teamError('Administrator tasdiqlangan team a’zosi bo‘lsin.');await readTeamActor(tx,body.adminUserId);team.adminUserId=body.adminUserId;}
  if(body.removeMemberId){const removed=team.members.find(m=>m.id===body.removeMemberId);if(!removed)throw teamError('O‘yinchi topilmadi.',404);if(removed.userId===team.adminUserId||removed.id===team.captainMemberId)throw teamError('Avval yangi sardor tayinlang. Team administratorini tarkibdan chiqarib bo‘lmaydi.',409);team.members=team.members.filter(m=>m.id!==removed.id);}
  if(body.captainMemberId){if(!team.members.some(m=>m.id===body.captainMemberId&&m.verified&&m.userId))throw teamError('Sardor taklifni tasdiqlagan o‘yinchi bo‘lsin.');team.captainMemberId=body.captainMemberId;}
  if(body.name!==undefined)team.name=teamText(body.name);if(image!==undefined)team.logo=image;team.memberUserIds=[...new Set(team.members.filter(m=>m.verified&&m.userId).map(m=>m.userId!))];team.version++;team.updatedAt=new Date().toISOString();tx.set(ref,team);return team;
 });
}
export async function inviteTeamMember(actorId:string,id:string,body:any){
 teamId(id);const key=requestKey(body.requestId),target=await resolveTeamUser(body.reference||body.targetUserId),db=getFirestoreDb(),ref=db.collection(TEAM_COLLECTION).doc(id),invId='ti_'+hash(actorId+':'+id+':'+key).slice(0,32),invRef=db.collection(INVITES).doc(invId);
 const result=await db.runTransaction(async tx=>{
  const actor=await readTeamActor(tx,actorId),invitee=await readTeamActor(tx,target.id),team=(await tx.get(ref)).data() as PreviewTeam|undefined;assertTeamManager(team,actor);
  const prior=(await tx.get(invRef)).data() as TeamInvitation|undefined;
  if(prior){if(prior.inviteeId!==target.id||prior.legacyMemberId!==(body.legacyMemberId||undefined))throw teamError('Bu so‘rov kodi boshqa taklif uchun ishlatilgan.',409);return prior;}
  if(team.members.some(m=>m.userId===target.id&&m.verified))throw teamError('Bu o‘yinchi team tarkibida bor.',409);
  await assertSingleTeamMembership(tx,target.id,id);
  const legacy=body.legacyMemberId?team.members.find(m=>m.id===body.legacyMemberId&&!m.verified&&!m.userId):undefined;
  if(body.legacyMemberId&&!legacy)throw teamError('Eski tarkib joyi band yoki o‘zgargan.',409);
  if(!legacy&&team.members.length>=30)throw teamError('Tarkibda ko‘pi bilan 30 o‘yinchi bo‘lsin.',409);
  const pending=await tx.get(db.collection(INVITES).where('teamId','==',id).where('status','==','PENDING').limit(200));
  const duplicate=pending.docs.map((d:any)=>d.data() as TeamInvitation).find((i:TeamInvitation)=>i.inviteeId===target.id&&Date.parse(i.expiresAt)>Date.now());
  if(duplicate){if(duplicate.legacyMemberId!==(body.legacyMemberId||undefined))throw teamError('Avval shu foydalanuvchining oldingi taklifini bekor qiling.',409);return duplicate;}
  const expired=pending.docs.filter((d:any)=>Date.parse(d.data().expiresAt)<=Date.now());if(pending.size-expired.length>=200)throw teamError('Kutilayotgan takliflarni avval ko‘rib chiqing.',409);for(const row of expired)tx.update(row.ref,{status:'EXPIRED',noticePending:false});
  const createdAt=new Date().toISOString(),invitation:TeamInvitation={id:invId,teamId:id,teamName:team.name,inviterId:actor.id,inviterName:display(actor),inviteeId:invitee.id,inviteeName:display(invitee),...(legacy?{legacyMemberId:legacy.id}:{}),status:'PENDING',createdAt,expiresAt:new Date(Date.now()+7*86400000).toISOString(),noticePending:true};
  tx.set(invRef,invitation);return invitation;
 });
 return result;
}
export async function respondTeamInvitation(actorId:string,id:string,accept:boolean){
 inviteId(id);if(typeof accept!=='boolean')throw teamError('Taklifga javob noto‘g‘ri.');
 const actor=await teamActor(actorId),db=getFirestoreDb(),ref=db.collection(INVITES).doc(id),preview=(await ref.get()).data() as TeamInvitation|undefined;
 if(!preview||preview.inviteeId!==actorId)throw teamError('Bu taklif sizga yuborilmagan.',403);
 // Never interpret a cancelled or expired invitation as a request to join.
 if(!['PENDING','ACCEPTED','REJECTED'].includes(preview.status)||preview.status==='PENDING'&&Date.parse(preview.expiresAt)<=Date.now())throw teamError('Taklif bekor qilingan yoki muddati tugagan.',409,'TEAM_INVITATION_CLOSED');
 if(accept&&preview.status==='PENDING')await requireTeamGroup(actor.telegramId);
 return db.runTransaction(async tx=>{
  const user=await readTeamActor(tx,actorId),inv=(await tx.get(ref)).data() as TeamInvitation|undefined;
  if(!inv||inv.inviteeId!==actorId)throw teamError('Bu taklif sizga yuborilmagan.',403);
  if(inv.status==='ACCEPTED'||inv.status==='REJECTED'){if((inv.status==='ACCEPTED')!==accept)throw teamError('Taklifga avval boshqa javob berilgan.',409);return inv;}
  if(inv.status!=='PENDING'||Date.parse(inv.expiresAt)<=Date.now())throw teamError('Taklif bekor qilingan yoki muddati tugagan.',409,'TEAM_INVITATION_CLOSED');
  const teamRef=db.collection(TEAM_COLLECTION).doc(inv.teamId),team=(await tx.get(teamRef)).data() as PreviewTeam|undefined;if(!team)throw teamError('Team topilmadi.',404);
  if(accept){await activeRosterLock(tx,team);const claimMembership=await prepareSingleTeamMembership(tx,actorId,team.id);
   if(!team.members.some(m=>m.userId===actorId&&m.verified)){
    const index=inv.legacyMemberId?team.members.findIndex(m=>m.id===inv.legacyMemberId&&!m.verified&&!m.userId):-1;
    if(inv.legacyMemberId&&index<0)throw teamError('Eski tarkib joyi endi mavjud emas. Yangi taklif so‘rang.',409);
    if(index<0&&team.members.length>=30)throw teamError('Team tarkibi to‘lgan.',409);
    const member={id:index>=0?team.members[index].id:'tp_'+hash(actorId).slice(0,32),name:display(user),userId:actorId,verified:true};if(index>=0)team.members[index]=member;else team.members.push(member);
    team.memberUserIds=[...new Set(team.members.filter(m=>m.verified&&m.userId).map(m=>m.userId!))];team.version++;team.updatedAt=new Date().toISOString();tx.set(teamRef,team);
   }
   claimMembership();
  }
  const updated={...inv,status:accept?'ACCEPTED' as const:'REJECTED' as const,respondedAt:new Date().toISOString(),noticePending:false};tx.set(ref,updated);return updated;
 });
}
export async function cancelTeamInvitation(actorId:string,id:string){
 inviteId(id);const db=getFirestoreDb(),ref=db.collection(INVITES).doc(id);return db.runTransaction(async tx=>{const actor=await readTeamActor(tx,actorId),inv=(await tx.get(ref)).data() as TeamInvitation|undefined;if(!inv)throw teamError('Taklif topilmadi.',404);const team=(await tx.get(db.collection(TEAM_COLLECTION).doc(inv.teamId))).data() as PreviewTeam|undefined;assertTeamManager(team,actor);if(inv.status==='CANCELLED')return inv;if(inv.status!=='PENDING')throw teamError('Taklifga javob berilgan.',409);const updated={...inv,status:'CANCELLED' as const,noticePending:false};tx.set(ref,updated);return updated;});
}
export async function respondTeamTelegramInvitation(telegramId:number,id:string,accept:boolean){
 const rows=await getFirestoreDb().collection('users').where('telegramId','==',String(telegramId)).limit(2).get();if(rows.docs.length!==1)throw teamError('Avval EFLUZ ilovasiga kiring.',403);return respondTeamInvitation(rows.docs[0].id,id,accept);
}
export async function processTeamInvitationNotices(limit=15,enqueue?: (params:any)=>Promise<any>,onlyId?:string){
 if(!enqueue&&(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE==='preview'))return;
 const db=getFirestoreDb(),pending=onlyId?{docs:[await db.collection(INVITES).doc(inviteId(onlyId)).get()]}:await db.collection(INVITES).where('noticePending','==',true).limit(limit).get();
 const queue=enqueue||(await import('./smartNotificationService')).enqueueSmartTelegramNotification;
 for(const row of pending.docs){const inv=row.data() as TeamInvitation;if(!inv?.noticePending)continue;
  if(inv.status!=='PENDING'||Date.parse(inv.expiresAt)<=Date.now()){await row.ref.update({noticePending:false});continue;}
  const target=await teamActor(inv.inviteeId).catch(()=>null);if(!target)continue;
  const url=new URL('/teams/'+inv.teamId,process.env.WEBAPP_URL||process.env.APP_URL||'https://efluz.vercel.app').toString();
  const queued=await queue({userId:inv.inviteeId,seasonId:'season-2026-27',eventId:'team-invite:'+inv.id,title:'Teamga taklif',body:`${html(inv.inviterName)} sizni ${html(inv.teamName)} jamoasiga taklif qilyapti.`,deferDrain:false,replyMarkup:{inline_keyboard:[[{text:'Qabul qilish',callback_data:'team_invite:accept:'+inv.id},{text:'Rad etish',callback_data:'team_invite:reject:'+inv.id}],[{text:'Team profilini ochish',url}]]}});
  if(queued!==false)await row.ref.update({noticePending:false});
 }
}
