import { SEED_COMPETITIONS } from '../db/seed';
import { filterRetiredFixtures } from './retiredFixtureService';
import { getFirestoreDb } from '../firebase/admin';
import type { DisciplineCard, DisciplinaryHold } from '../../types/discipline';
import { assertNoDisciplinaryHold, disciplineReasons } from '../../types/discipline';

const states = 'discipline_states';
const competitionName=(id:string)=>SEED_COMPETITIONS.find(item=>item.id===id)?.name||'Musobaqa';
const stateId = (season: string, user: string) => `${season}_${user}`;
const fail = (message: string, code = 'DISCIPLINE_CONFLICT', statusCode = 409): never => { throw Object.assign(new Error(message), { code, statusCode }); };
const nextStatuses = new Set(['SCHEDULED', 'READY', 'POSTPONED', 'OVERDUE']);
const eligible=(f:any)=>nextStatuses.has(f.status)&&f.homeClubId&&f.awayClubId&&f.homeClubId!=='TBD'&&f.awayClubId!=='TBD'&&!f.disciplinaryHolds?.length;
async function candidateFixtures(userId: string, seasonId: string) {
  const db = getFirestoreDb();
  const membership = (await db.collection('user_memberships').doc(stateId(seasonId,userId)).get()).data();
  const clubs = membership?.status === 'active' ? [membership.clubId,membership.secondaryClubId].filter(Boolean) : [];
  if (!clubs.length) return [];
  const docs = await db.collection('fixtures').where('seasonId','==',seasonId).get();
  return filterRetiredFixtures(docs.docs.map(doc => ({...doc.data(),id:doc.id} as any)),seasonId).filter(f => clubs.includes(f.homeClubId) || clubs.includes(f.awayClubId))
    .sort((a,b) => (Date.parse(a.scheduledAt)||Number.MAX_SAFE_INTEGER)-(Date.parse(b.scheduledAt)||Number.MAX_SAFE_INTEGER) || Number(a.matchday)-Number(b.matchday) || a.id.localeCompare(b.id));
}
async function assertGlobalAdmin(transaction: any, adminId: string) {
  const admin = (await transaction.get(getFirestoreDb().collection('users').doc(adminId))).data();
  if (!admin?.isAdmin || admin.isSuspended || admin.adminPermissions?.scope === 'LEAGUES') fail('Bu amal faqat katta admin uchun.','ADMIN_SCOPE_FORBIDDEN',403);
}
export async function getDiscipline(userId: string, seasonId: string, privateView = false) {
  const db=getFirestoreDb();
  const doc=await db.collection(states).doc(stateId(seasonId,userId)).get();
  const cards:DisciplineCard[]=doc.data()?.cards || [];
  const ids=[...new Set(cards.filter(c=>c.color==='RED'&&c.status==='ACTIVE'&&c.suspensionFixtureId).map(c=>c.suspensionFixtureId!))];
  const matches=new Map(await Promise.all(ids.map(async id=>[id,(await db.collection('fixtures').doc(id).get()).data()] as const)));
  return cards.map(c=>{const match=c.suspensionFixtureId?matches.get(c.suspensionFixtureId):null;return ({...c,suspensionMatch:match?{homeClubId:match.homeClubId,awayClubId:match.awayClubId,matchday:match.matchday,scheduledAt:match.scheduledAt,competitionName:match.competitionName||competitionName(match.competitionId),roundName:match.roundName||''}:undefined,note:privateView?c.note:'',createdBy:privateView?c.createdBy:'',revokedBy:privateView?c.revokedBy:undefined,revokeReason:privateView?c.revokeReason:undefined,
    suspensionStatus:c.color==='RED'&&c.status==='ACTIVE' ? !c.suspensionFixtureId||!match||match.status==='CANCELLED'?'PENDING':match?.status==='CONFIRMED'?'SERVED':'ASSIGNED':undefined});});
}
export async function getDisciplineFixtures(userId:string,seasonId:string) {
  return (await candidateFixtures(userId,seasonId)).map(f=>({id:f.id,status:f.status,competitionId:f.competitionId,competitionName:f.competitionName||competitionName(f.competitionId),roundName:f.roundName||'',matchday:f.matchday,homeClubId:f.homeClubId,awayClubId:f.awayClubId,scheduledAt:f.scheduledAt,
    eligible:eligible(f)}));
}
export async function issueDisciplineCard(adminId:string,userId:string,seasonId:string,input:Pick<DisciplineCard,'color'|'reason'|'note'|'incidentFixtureId'> & {requestId:string;expectedSuspensionFixtureId?:string|null}) {
  const db=getFirestoreDb();
  const candidates=await candidateFixtures(userId,seasonId);
  if(input.incidentFixtureId&&!candidates.some(f=>f.id===input.incidentFixtureId)) fail('Bu o‘yin ishtirokchiga tegishli emas.','INVALID_INCIDENT_FIXTURE',400);
  const next=input.color==='RED'?candidates.find(f=>f.id!==input.incidentFixtureId&&eligible(f)):undefined;
  const ref=db.collection(states).doc(stateId(seasonId,userId));
  const id=`card-${input.requestId}`;
  const card:DisciplineCard={id,userId,seasonId,color:input.color,reason:input.reason,note:input.note.trim(),incidentFixtureId:input.incidentFixtureId,suspensionFixtureId:next?.id||null,status:'ACTIVE',createdAt:new Date().toISOString(),createdBy:adminId};
  return db.runTransaction(async tx=>{
    await assertGlobalAdmin(tx,adminId);
    const [current,target,member]=await Promise.all([tx.get(ref),tx.get(db.collection('users').doc(userId)),tx.get(db.collection('user_memberships').doc(stateId(seasonId,userId)))]);
    if(!target.exists)fail('O‘yinchi topilmadi.','USER_NOT_FOUND',404);
    const cards:DisciplineCard[]=current.data()?.cards||[];
    const old=cards.find(c=>c.id===id);
    if(old)return old;
  if(Object.hasOwn(input,'expectedSuspensionFixtureId')&&(next?.id||null)!==input.expectedSuspensionFixtureId)fail('Chetlatish o‘yini reja tuzilgandan beri o‘zgardi. Yangi reja tuzing.','DISCIPLINE_PREVIEW_CHANGED');
    if(cards.length>=500)fail('Mavsumdagi kartochkalar chegarasiga yetildi.');
    if(next){
      const fixtureRef=db.collection('fixtures').doc(next.id),fixture=(await tx.get(fixtureRef)).data();
      const owned=member.data()?.status==='active'?[member.data()?.clubId,member.data()?.secondaryClubId]:[];
      if(!fixture||!nextStatuses.has(fixture.status)||fixture.disciplinaryHolds?.length||![fixture.homeClubId,fixture.awayClubId].some(club=>owned.includes(club)))fail('Keyingi o‘yin o‘zgardi. Yangilab qayta urinib ko‘ring.');
      tx.update(fixtureRef,{disciplinaryHolds:[{cardId:id,userId}],updatedAt:card.createdAt});
    }
    tx.set(ref,{userId,seasonId,cards:[card,...cards],updatedAt:card.createdAt});
    const notificationId=`discipline_${id}`;
    tx.set(db.collection('notifications').doc(notificationId),{id:notificationId,userId,type:'SYSTEM',title:input.color==='RED'?'Qizil kartochka — bir o‘yinga chetlatish':'Sariq kartochka — ogohlantirish',message:`${disciplineReasons[input.reason]}. Tafsilotlar klub profilingizning Intizom bo‘limida.`,entityType:'user',entityId:userId,isRead:false,createdAt:card.createdAt});
    tx.set(db.collection('audit_logs').doc(`discipline_issue_${id}`),{actorUserId:adminId,action:'ISSUE_DISCIPLINE_CARD',entityType:'discipline_card',entityId:id,newValueJson:JSON.stringify(card),createdAt:card.createdAt});
    return card;
  });
}
export async function revokeDisciplineCard(adminId:string,userId:string,seasonId:string,cardId:string,reason:string) {
  const db=getFirestoreDb(),ref=db.collection(states).doc(stateId(seasonId,userId));
  await db.runTransaction(async tx=>{
    await assertGlobalAdmin(tx,adminId);
    const doc=await tx.get(ref),cards:DisciplineCard[]=doc.data()?.cards||[],card=cards.find(c=>c.id===cardId);
    if(!card)fail('Kartochka topilmadi.','CARD_NOT_FOUND',404);
    if(card.status==='REVOKED')return;
    const matchRef=db.collection('fixtures').doc(card.suspensionFixtureId||'__unused__');
    const fixture=card.suspensionFixtureId?(await tx.get(matchRef)).data():null;
    const now=new Date().toISOString();
    if(fixture)tx.update(matchRef,{disciplinaryHolds:(fixture.disciplinaryHolds||[]).filter((h:DisciplinaryHold)=>h.cardId!==cardId),updatedAt:now});
    tx.update(ref,{cards:cards.map(c=>c.id===cardId?{...c,status:'REVOKED',revokedAt:now,revokedBy:adminId,revokeReason:reason}:c),updatedAt:now});
    tx.set(db.collection('audit_logs').doc(`discipline_revoke_${cardId}`),{actorUserId:adminId,action:'REVOKE_DISCIPLINE_CARD',entityType:'discipline_card',entityId:cardId,oldValueJson:JSON.stringify(card),newValueJson:JSON.stringify({status:'REVOKED',reason}),createdAt:now});
    const notificationId=`discipline_${cardId}_revoked`;
    tx.set(db.collection('notifications').doc(notificationId),{id:notificationId,userId,type:'SYSTEM',title:'Kartochka bekor qilindi',message:reason,entityType:'user',entityId:userId,isRead:false,createdAt:now});
  });
}
/** Bind a red issued before schedules existed, then block both participants.
 * The hold is also checked inside the result transaction to close issuance races. */
export async function assertDisciplineFixtureAllowed(fixtureId:string,userId:string) {
  const db=getFirestoreDb(),fixRef=db.collection('fixtures').doc(fixtureId),fix=(await fixRef.get()).data();
  if(!fix)return;
  const season=fix.seasonId||'season-2026-27';
  const member=(await db.collection('user_memberships').doc(stateId(season,userId)).get()).data();
  if(member?.status!=='active'||![fix.homeClubId,fix.awayClubId].some(id=>id&&[member.clubId,member.secondaryClubId].includes(id)))return;
  const owners=await Promise.all([fix.homeClubId,fix.awayClubId].filter(Boolean).map(async club=>(await db.collection('club_occupancies').doc(`${season}_${club}`).get()).data()?.userId));
  const heldOwners=(fix.disciplinaryHolds||[]).map((hold:DisciplinaryHold)=>hold.userId);
  for(const owner of new Set([userId,...owners,...heldOwners].filter(Boolean) as string[])) {
    const ref=db.collection(states).doc(stateId(season,owner));
    const cards:DisciplineCard[]=(await ref.get()).data()?.cards||[];
    for(const card of cards.filter(c=>c.color==='RED'&&c.status==='ACTIVE')) {
      const previous=card.suspensionFixtureId?(await db.collection('fixtures').doc(card.suspensionFixtureId).get()).data():null;
      if(previous?.status==='CONFIRMED')continue;
      const ownership=(await db.collection('user_memberships').doc(stateId(season,owner)).get()).data();
      const owned=ownership?.status==='active'?[ownership.clubId,ownership.secondaryClubId].filter(Boolean):[];
      const stillParticipates=previous&&[previous.homeClubId,previous.awayClubId].some(club=>owned.includes(club));
      if(previous&&previous.status!=='CANCELLED'&&stillParticipates)continue;
      const next=(await candidateFixtures(owner,season)).find(f=>f.id!==card.incidentFixtureId&&eligible(f));
      if(!next&&!card.suspensionFixtureId)continue;
      await db.runTransaction(async tx=>{
        const state=await tx.get(ref),latest:DisciplineCard[]=state.data()?.cards||[],active=latest.find(c=>c.id===card.id);
        const memberDoc=await tx.get(db.collection('user_memberships').doc(stateId(season,owner)));
        const membership=memberDoc.data();
        const currentOwned=membership?.status==='active'?[membership.clubId,membership.secondaryClubId].filter(Boolean):[];
        const matchRef=next?db.collection('fixtures').doc(next.id):null;
        const current=matchRef?(await tx.get(matchRef)).data():null;
        const oldRef=card.suspensionFixtureId?db.collection('fixtures').doc(card.suspensionFixtureId):null;
        const before=oldRef?(await tx.get(oldRef)).data():null;
        if(!active||active.status!=='ACTIVE'||active.suspensionFixtureId!==card.suspensionFixtureId)return;
        if(before?.status==='CONFIRMED'||before&&before.status!=='CANCELLED'&&[before.homeClubId,before.awayClubId].some(club=>currentOwned.includes(club)))return;
        if(next&&(!current||!eligible(current)||![current.homeClubId,current.awayClubId].some(club=>currentOwned.includes(club))))return;
        if(before&&oldRef)tx.update(oldRef,{disciplinaryHolds:(before.disciplinaryHolds||[]).filter((h:DisciplinaryHold)=>h.cardId!==card.id)});
        tx.update(ref,{cards:latest.map(c=>c.id===card.id?{...c,suspensionFixtureId:next?.id||null}:c)});
        if(matchRef)tx.update(matchRef,{disciplinaryHolds:[{cardId:card.id,userId:owner}]});
      });
    }
  }
  assertNoDisciplinaryHold((await fixRef.get()).data()||{});
}

/** Resolve pending one-game assignments before an admin settles a match. */
export async function prepareFixtureDiscipline(fixtureId:string) {
  const db=getFirestoreDb(),fixture=(await db.collection('fixtures').doc(fixtureId).get()).data();
  if(!fixture||fixture.status==='CONFIRMED')return;
  for(const clubId of [fixture.homeClubId,fixture.awayClubId].filter(Boolean)) {
    const owner=(await db.collection('club_occupancies').doc(`${fixture.seasonId}_${clubId}`).get()).data()?.userId;
    if(!owner)continue;
    try { await assertDisciplineFixtureAllowed(fixtureId,owner); }
    catch(error:any) { if(error.code!=='DISCIPLINARY_SUSPENSION')throw error; }
  }
}
