import crypto from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {TEAM_PREVIEW_OWNER,TEAM_DIRECTORY_LIMIT,TEAM_LEAGUE_MAX_TEAMS,TEAM_PLAYOFF_SIZES,confirmedTeamMembers} from '../../types/teamLeaguePreview';
import type {PreviewTeam,TeamLeague,TeamLineup} from '../../types/teamLeaguePreview';
import {makeTeamSchedule,teamFixtureScore,teamStandings,makeTeamPlayoffRound,teamFixtureWinner,teamFormatPreview} from '../../lib/teamLeagueEngine';
import {TEAM_COLLECTION,LEAGUE_COLLECTION,validateTeamLogo as logo,verifyTeamPlayers,readTeamActor,teamActor,requireTeamGroup} from './teamAccess';
export {TEAM_COLLECTION,LEAGUE_COLLECTION} from './teamAccess';
const error=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const text=(v:unknown,max=60)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw error('Nom yoki matn noto‘g‘ri.');return v.trim();};
const identifier=(v:unknown)=>{if(typeof v!=='string'||!/^tp_[a-zA-Z0-9_-]{8,80}$/.test(v))throw error('Obyekt identifikatori noto‘g‘ri.');return v;};
const owned=<T extends {ownerId:string}>(v:T|undefined,ownerId:string):T=>{if(!v||v.ownerId!==ownerId)throw error('Team yoki turnir topilmadi.',404);return v;};
const now=()=>new Date().toISOString();
export async function getTeamPreview(ownerId:string){
 const db=getFirestoreDb();const [ts,ls]=await Promise.all([db.collection(TEAM_COLLECTION).where('ownerId','==',ownerId).limit(TEAM_DIRECTORY_LIMIT).get(),db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId).limit(8).get()]);
 return {teams:ts.docs.map(d=>d.data() as PreviewTeam),leagues:ls.docs.map(d=>({...d.data() as TeamLeague,fixtures:[],teams:{},audit:[]}))};
}
export async function getPreviewLeague(ownerId:string,id:string){identifier(id);return owned((await getFirestoreDb().collection(LEAGUE_COLLECTION).doc(id).get()).data() as TeamLeague|undefined,ownerId);}
export async function getPreviewTeamProfile(ownerId:string,id:string){
 identifier(id);const db=getFirestoreDb();
 const team=owned((await db.collection(TEAM_COLLECTION).doc(id).get()).data() as PreviewTeam|undefined,ownerId);
 const [ls,ts]=await Promise.all([db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId).limit(8).get(),db.collection(TEAM_COLLECTION).where('ownerId','==',ownerId).limit(TEAM_DIRECTORY_LIMIT).get()]);
 const leagues=ls.docs.map(d=>d.data() as TeamLeague).filter(l=>l.teamIds.includes(id));
 const relevant=new Set([id,...leagues.flatMap(l=>l.teamIds)]);
 return {canManageTeam:true,team,leagues:leagues.map(l=>({...l,audit:[],teams:Object.fromEntries(Object.entries(l.teams).map(([teamId,snapshot])=>[teamId,teamId===id?snapshot:{id:snapshot.id,name:snapshot.name,members:[],captainMemberId:''}]))})),teams:ts.docs.map(d=>d.data() as PreviewTeam).filter(t=>relevant.has(t.id)).map(({id,name,logo})=>({id,name,logo}))};
}
export async function savePreviewTeam(ownerId:string,input:any){
  const id=identifier(input.id),name=text(input.name),image=await logo(input.logo??'');
 if(!Array.isArray(input.members)||input.members.length<1||input.members.length>30)throw error('Tarkibda 1–30 o‘yinchi bo‘lsin.');
 const members=input.members.map((p:any)=>({id:identifier(p?.id),name:text(p?.name,50)}));
 if(new Set(members.map(p=>p.id)).size!==members.length)throw error('Tarkibda takrorlangan o‘yinchi bor.');
 if(!members.some(p=>p.id===input.captainMemberId))throw error('Sardorni tarkibdan tanlang.');
 if(input.version===0)await requireTeamGroup((await teamActor(ownerId)).telegramId);
 const db=getFirestoreDb(),ref=db.collection(TEAM_COLLECTION).doc(id);
 return db.runTransaction(async tx=>{
  const old=(await tx.get(ref)).data() as PreviewTeam|undefined;
  if(old)owned(old,ownerId);
  const leagues=await tx.get(db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId));
  if(leagues.docs.some(d=>{const l=d.data() as TeamLeague;return l.status==='ACTIVE'&&l.teamIds.includes(id);}))throw error('Team faol turnirda qatnashyapti. Tarkib va logoni turnir tugagach tahrirlang.',409);
  const teams=await tx.get(db.collection(TEAM_COLLECTION).where('ownerId','==',ownerId));
  if(!old&&teams.size>=TEAM_DIRECTORY_LIMIT)throw error(`Ko‘pi bilan ${TEAM_DIRECTORY_LIMIT} team yarating.`);
  const preserved=members.map((member:any)=>{const prior=old?.members.find(p=>p.id===member.id);if(prior?.verified&&prior.userId){if(prior.name!==member.name)throw error('Tasdiqlangan o‘yinchi nomi akkauntdan olinadi.');return {...member,userId:prior.userId,verified:true};}return member;});
  const manual=preserved.filter((m:any)=>!m.verified);if(new Set(manual.map((m:any)=>m.name.toLowerCase())).size!==manual.length)throw error('Tarkibda takrorlangan o‘yinchi bor.');
  const payload={name,logo:image,members:preserved,captainMemberId:input.captainMemberId};
  if(old&&JSON.stringify({name:old.name,logo:old.logo,members:old.members,captainMemberId:old.captainMemberId})===JSON.stringify(payload))return old;
  if((old?.version??0)!==input.version)throw error('Team yangilangan. Yangilab qayta urining.',409);
  const team:PreviewTeam={id,ownerId,...(old?.adminUserId?{adminUserId:old.adminUserId}:{}),membershipRequired:old?.membershipRequired??true,memberUserIds:preserved.filter((m:any)=>m.verified&&m.userId).map((m:any)=>m.userId),...payload,version:(old?.version??0)+1,updatedAt:now()};tx.set(ref,team);return team;
 });
}
export async function savePreviewLeague(ownerId:string,input:any){
 const id=identifier(input.id),name=text(input.name),ids=input.teamIds;
 const format=input.format??'LEAGUE',description=typeof input.description==='string'?input.description.trim():'';
 if(!['LEAGUE','PLAYOFF','LEAGUE_AND_PLAYOFF'].includes(format)||description.length>1000)throw error('Format yoki tavsif noto‘g‘ri.');
 const qualifiers=format==='LEAGUE_AND_PLAYOFF'?input.qualifiers:2;
 if(!Array.isArray(ids)||ids.length<2||ids.length>TEAM_LEAGUE_MAX_TEAMS||new Set(ids).size!==ids.length)throw error(`2–${TEAM_LEAGUE_MAX_TEAMS} ta turli team tanlang.`);
 ids.forEach(identifier);
 if(format==='PLAYOFF'&&!TEAM_PLAYOFF_SIZES.includes(ids.length))throw error('Pley-off uchun 2, 4, 8, 16, 32 yoki 64 team tanlang.');
 if(format==='LEAGUE_AND_PLAYOFF'&&(!TEAM_PLAYOFF_SIZES.includes(qualifiers)||qualifiers>ids.length))throw error('Pley-offga chiqadigan teamlar sonini to‘g‘ri tanlang.');
 if(!Number.isInteger(input.starterCount)||input.starterCount<1||input.starterCount>16||![1,2].includes(input.rounds))throw error('Asosiy tarkib 1–16 o‘yinchi, davra 1 yoki 2 bo‘lsin.');
 const db=getFirestoreDb(),ref=db.collection(LEAGUE_COLLECTION).doc(id);
 return db.runTransaction(async tx=>{
  const old=(await tx.get(ref)).data() as TeamLeague|undefined;if(old)owned(old,ownerId);
  const all=await tx.get(db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId));
  if(!old&&all.size>=8)throw error('Ko‘pi bilan 8 ta turnir yarating.');
  if(old&&old.status!=='DRAFT')throw error('Boshlangan turnir reglamenti yopiq.',409);
  const snapshots=await Promise.all(ids.map((tid:string)=>tx.get(db.collection(TEAM_COLLECTION).doc(tid))));
  for(const doc of snapshots){const t=owned(doc.data() as PreviewTeam|undefined,ownerId);if(t.members.length<input.starterCount)throw error(`${t.name}: asosiy tarkib uchun o‘yinchi yetmaydi.`);}
  if(old&&(old.format??'LEAGUE')===format&&(old.description??'')===description&&(old.qualifiers??2)===qualifiers&&old.name===name&&old.starterCount===input.starterCount&&old.rounds===input.rounds&&JSON.stringify(old.teamIds)===JSON.stringify(ids))return old;
  if((old?.version??0)!==input.version)throw error('Turnir yangilangan. Qayta yuklang.',409);
  const l:TeamLeague={id,ownerId,membershipRequired:old?.membershipRequired??true,name,format,description,qualifiers,teamIds:ids,starterCount:input.starterCount,rounds:input.rounds,status:'DRAFT',currentRound:0,totalRounds:0,fixtures:[],teams:{},version:(old?.version??0)+1,updatedAt:now(),audit:old?.audit??[]};tx.set(ref,l);return l;
 });
}
function lineup(value:any,members:string[],count:number):TeamLineup{
 if(!value||!Array.isArray(value.starters)||!Array.isArray(value.reserves)||value.starters.length!==count||value.reserves.length>30)throw error(`Aynan ${count} asosiy o‘yinchi tanlang.`);
 const all=[...value.starters,...value.reserves];if(all.some(id=>!members.includes(id))||new Set(all).size!==all.length)throw error('Asosiy tarkib va zaxira takrorlanmasin, faqat team a’zolari tanlansin.');
 return {starters:[...value.starters],reserves:[...value.reserves]};
}
function shuffled(ids:string[]){const result=[...ids];for(let i=result.length-1;i>0;i--){const j=crypto.randomInt(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;}
export async function actOnTeamLeague(ownerId:string,id:string,input:any){
 identifier(id);const db=getFirestoreDb(),ref=db.collection(LEAGUE_COLLECTION).doc(id);
 const before=owned((await ref.get()).data() as TeamLeague|undefined,ownerId);
 let preparedTeams:PreviewTeam[]=[];
 let checkedMembers:import('../../types/teamLeaguePreview').TeamMember[]=[];
 if(input.action==='START'&&before.membershipRequired){
  preparedTeams=await Promise.all(before.teamIds.map(async tid=>owned((await db.collection(TEAM_COLLECTION).doc(tid).get()).data() as PreviewTeam|undefined,ownerId)));
  for(const t of preparedTeams){const eligible=confirmedTeamMembers(t);if(eligible.length<before.starterCount||!eligible.some(m=>m.id===t.captainMemberId))throw error(`${t.name}: yetarli tasdiqlangan o‘yinchi va tasdiqlangan sardor kerak.`,409);checkedMembers.push(eligible.find(m=>m.id===t.captainMemberId)!);}
 }else if(['LINEUP','PAIR','SUBSTITUTE'].includes(input.action)){
  const f=before.fixtures.find(f=>f.id===input.fixtureId);
  if(f){const ids=input.action==='LINEUP'?[...(input.lineup?.starters||[]),...(input.lineup?.reserves||[])]:input.action==='SUBSTITUTE'?[input.memberId]:[...(f.homeLineup?.starters||[]),...(f.awayLineup?.starters||[])];
   const teams=input.action==='PAIR'?[f.homeTeamId,f.awayTeamId]:[input.side==='home'?f.homeTeamId:f.awayTeamId];checkedMembers=teams.flatMap(tid=>before.teams[tid]?.members.filter(m=>ids.includes(m.id))||[]);if(before.membershipRequired&&checkedMembers.length!==ids.length)throw error('O‘yinchilar tarkibda tasdiqlanmagan.',409);
  }
 }
 await verifyTeamPlayers(checkedMembers,!!before.membershipRequired);
 return db.runTransaction(async tx=>{
  const l=owned((await tx.get(ref)).data() as TeamLeague|undefined,ownerId);
  if(!['START','LINEUP','PAIR','RESET','SUBSTITUTE','SCORE','NEXT','CANCEL','TIEBREAK'].includes(input.action))throw error('Noma’lum amal.');
  if(l.version!==input.version||l.version!==before.version)throw error('Turnir holati o‘zgargan. Yangilab qayta urining.',409);
  for(let i=0;i<checkedMembers.length;i+=16)await Promise.all(checkedMembers.slice(i,i+16).filter(m=>m.userId).map(m=>readTeamActor(tx,m.userId!)));
  if(input.action==='START'){
   if(l.status!=='DRAFT')throw error('Turnir allaqachon boshlangan.',409);
   const docs=await Promise.all(l.teamIds.map(tid=>tx.get(db.collection(TEAM_COLLECTION).doc(tid))));
   for(const doc of docs){const t=owned(doc.data() as PreviewTeam|undefined,ownerId);if(l.membershipRequired&&preparedTeams.find(p=>p.id===t.id)?.version!==t.version)throw error('Team tarkibi yangilangan. Qayta boshlang.',409);const eligible=l.membershipRequired?confirmedTeamMembers(t):t.members;if(eligible.length<l.starterCount)throw error(`${t.name}: o‘yinchi yetmaydi.`);l.teams[t.id]={id:t.id,name:t.name,members:eligible,captainMemberId:t.captainMemberId};}
   l.fixtures=l.format==='PLAYOFF'?makeTeamPlayoffRound(l.id,shuffled(l.teamIds),1):makeTeamSchedule(l.id,l.teamIds,l.rounds);l.totalRounds=teamFormatPreview(l.teamIds.length,l.format,l.rounds,l.qualifiers??2).rounds;l.currentRound=1;l.status='ACTIVE';
  }else if(input.action==='CANCEL'){
   if(!['DRAFT','ACTIVE'].includes(l.status))throw error('Turnir yopilgan.',409);l.status='CANCELLED';
  }else if(input.action==='NEXT'){
   if(l.status!=='ACTIVE'||l.fixtures.filter(f=>f.round===l.currentRound).some(f=>!teamFixtureScore(f).complete))throw error('Joriy turdagi barcha o‘yinlarni yakunlang.',409);
   if(l.currentRound>=l.totalRounds)throw error('Oxirgi tur.',409);
   const current=l.fixtures.filter(f=>f.round===l.currentRound);
   if(current[0]?.stage==='PLAYOFF'){
    const winners=current.map(teamFixtureWinner);if(winners.some(w=>!w))throw error('Durang uchrashuvning hal qiluvchi g‘olibini tasdiqlang.',409);
    l.fixtures.push(...makeTeamPlayoffRound(l.id,winners as string[],l.currentRound+1));
   }else if(l.format==='LEAGUE_AND_PLAYOFF'&&l.currentRound===Math.max(...l.fixtures.filter(f=>f.stage!=='PLAYOFF').map(f=>f.round))){
    const seeds=teamStandings(l).slice(0,l.qualifiers??2).map(r=>r.teamId);l.fixtures.push(...makeTeamPlayoffRound(l.id,seeds,l.currentRound+1));
   }
   l.currentRound++;
  }else{
   const f=l.fixtures.find(f=>f.id===input.fixtureId);if(!f)throw error('Uchrashuv topilmadi.',404);
   if(l.status==='CANCELLED'||l.status==='DRAFT'||f.round>l.currentRound)throw error('Ushbu tur hali ochilmagan.',409);
   if(!['SCORE','TIEBREAK'].includes(input.action)&&(l.status!=='ACTIVE'||f.round!==l.currentRound))throw error('Tarkibni faqat joriy turda boshqaring.',409);
   if(input.action==='LINEUP'){
    if(f.bouts.length)throw error('Juftliklar tayyor. Avval tarkibni qayta oching yoki zaxiradan almashtiring.',409);
    if(!['home','away'].includes(input.side))throw error('Team tomoni noto‘g‘ri.');
    const team=l.teams[input.side==='home'?f.homeTeamId:f.awayTeamId];
    f[input.side==='home'?'homeLineup':'awayLineup']=lineup(input.lineup,team.members.map(p=>p.id),l.starterCount);
   }else if(input.action==='PAIR'){
    if(f.bouts.length||!f.homeLineup||!f.awayLineup)throw error('Ikki sardor ham tarkib tanlashi kerak. Juftliklar bir marta tuziladi.',409);
    const h=shuffled(f.homeLineup.starters),a=shuffled(f.awayLineup.starters);
    f.bouts=h.map((member,i)=>({id:`${f.id}_b${i}`,homeMemberId:member,awayMemberId:a[i],homeScore:null,awayScore:null}));
   }else if(input.action==='RESET'){
    if(f.bouts.some(b=>b.homeScore!=null))throw error('Natijalar bor. Tarkiblarni qayta ochib bo‘lmaydi.',409);f.bouts=[];f.homeLineup=null;f.awayLineup=null;
   }else if(input.action==='SUBSTITUTE'){
    if(!['home','away'].includes(input.side))throw error('Team tomoni noto‘g‘ri.');
    const b=f.bouts.find(b=>b.id===input.boutId),line=input.side==='home'?f.homeLineup:f.awayLineup;
    if(!b||!line||b.homeScore!=null||!line.reserves.includes(input.memberId))throw error('Faqat o‘ynalmagan juftlikda zaxiradan almashtirish mumkin.',409);
    const key=input.side==='home'?'homeMemberId':'awayMemberId',old=b[key];
    line.starters=line.starters.map(p=>p===old?input.memberId:p);line.reserves=line.reserves.map(p=>p===input.memberId?old:p);b[key]=input.memberId;
   }else if(input.action==='TIEBREAK'){
    if(f.stage!=='PLAYOFF'||f.round!==l.currentRound||l.status!=='ACTIVE')throw error('Hal qiluvchi natija faqat joriy pley-off turida kiritiladi.',409);
    const score=teamFixtureScore(f);if(!score.complete||score.home!==score.away||![f.homeTeamId,f.awayTeamId].includes(input.winnerTeamId))throw error('Avval durang uchrashuvning barcha hisoblarini kiriting.');
    f.tieBreakWinnerId=input.winnerTeamId;f.tieBreakReason=text(input.reason,200);
   }else if(input.action==='SCORE'){
    if(f.round<l.currentRound&&((f.stage==='PLAYOFF')||(l.format==='LEAGUE_AND_PLAYOFF'&&l.fixtures.some(g=>g.stage==='PLAYOFF'))))throw error('Keyingi bosqich tuzilgan. Oldingi bosqich natijalari yopilgan.',409);

    const b=f.bouts.find(b=>b.id===input.boutId);if(!b)throw error('Juftlik tuzilmagan.',409);
    if(![input.homeScore,input.awayScore].every(n=>Number.isInteger(n)&&n>=0&&n<=99))throw error('Hisob 0–99 oralig‘idagi butun son bo‘lsin.');
    b.homeScore=input.homeScore;b.awayScore=input.awayScore;if(f.stage==='PLAYOFF')l.status='ACTIVE';delete f.tieBreakWinnerId;delete f.tieBreakReason;
   }
  }
  if(['SCORE','TIEBREAK'].includes(input.action)&&l.currentRound===l.totalRounds&&l.fixtures.every(f=>teamFixtureScore(f).complete&&(f.stage!=='PLAYOFF'||!!teamFixtureWinner(f))))l.status='COMPLETED';
  l.version++;l.updatedAt=now();l.audit=[...l.audit,{at:l.updatedAt,action:input.action,detail:typeof input.fixtureId==='string'?input.fixtureId:l.name}].slice(-200);
  tx.set(ref,l);return l;
 });
}

// Public reads resolve the platform owner on the server; caller-supplied owner IDs
// never select another workspace. Drafts and administrative metadata stay private.
async function publishedTeams(){
 const db=getFirestoreDb(),accounts=await db.collection('users').where('telegramId','==',TEAM_PREVIEW_OWNER).limit(2).get();
 if(accounts.docs.length!==1||accounts.docs[0].data()?.isSuspended)return {teams:[] as PreviewTeam[],leagues:[] as TeamLeague[]};
 const ownerId=accounts.docs[0].id;
 const [ts,ls]=await Promise.all([db.collection(TEAM_COLLECTION).where('ownerId','==',ownerId).limit(TEAM_DIRECTORY_LIMIT).get(),db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId).limit(8).get()]);
 const leagues=ls.docs.map(d=>d.data() as TeamLeague).filter(l=>l.status!=='DRAFT'&&l.currentRound>0).map(l=>({id:l.id,membershipRequired:l.membershipRequired,ownerId:'',name:l.name,description:l.description,format:l.format,qualifiers:l.qualifiers,teamIds:l.teamIds,starterCount:l.starterCount,rounds:l.rounds,status:l.status,currentRound:l.currentRound,totalRounds:l.totalRounds,fixtures:l.fixtures,teams:l.teams,version:0,updatedAt:l.updatedAt,audit:[]}));
 const included=new Set(leagues.flatMap(l=>l.teamIds));
 const teams=ts.docs.map(d=>d.data() as PreviewTeam).filter(t=>included.has(t.id)).map(t=>({id:t.id,ownerId:'',name:t.name,logo:t.logo,members:t.members,captainMemberId:t.captainMemberId,version:0,updatedAt:t.updatedAt}));
 return {teams,leagues};
}
export async function getPublishedTeams(){const data=await publishedTeams();return {...data,leagues:data.leagues.map(l=>({...l,fixtures:[],teams:{}}))};}
export async function getPublishedTeamLeague(id:string){identifier(id);const data=await publishedTeams(),league=data.leagues.find(l=>l.id===id);if(!league)throw error('Turnir topilmadi.',404);return league;}
export async function getPublishedTeamProfile(id:string,viewerId?:string){
 identifier(id);const data=await publishedTeams(),db=getFirestoreDb();
 const actor=viewerId?await teamActor(viewerId):undefined,record=actor?(await db.collection(TEAM_COLLECTION).doc(id).get()).data() as PreviewTeam|undefined:undefined;
 let team:PreviewTeam|undefined=data.teams.find(t=>t.id===id);
 if(!team&&actor&&record){
  const invites=await db.collection('team_membership_invitations').where('teamId','==',id).where('inviteeId','==',actor.id).where('status','==','PENDING').limit(10).get();
  if((record.adminUserId||record.ownerId)===actor.id||record.members.some(m=>m.userId===actor.id&&m.verified)||invites.docs.some(d=>Date.parse(d.data().expiresAt)>Date.now()))team={id:record.id,ownerId:'',name:record.name,logo:record.logo,members:record.members,captainMemberId:record.captainMemberId,version:0,updatedAt:record.updatedAt};
 }
 if(!team)throw error('Team topilmadi.',404);
 const leagues=data.leagues.filter(l=>l.teamIds.includes(id)),ids=new Set([id,...leagues.flatMap(l=>l.teamIds)]);
 return {canManageTeam:!!actor&&!!record&&(actor.id===(record.adminUserId||record.ownerId)||actor.telegramId===TEAM_PREVIEW_OWNER),team,
  leagues:leagues.map(l=>({...l,teams:Object.fromEntries(Object.entries(l.teams).map(([teamId,snapshot])=>[teamId,teamId===id?snapshot:{id:snapshot.id,name:snapshot.name,members:[],captainMemberId:''}]))})),
  teams:data.teams.filter(t=>ids.has(t.id)).map(({id,name,logo})=>({id,name,logo}))};
}
export async function deletePreviewTeam(ownerId:string,id:string,version:number){
 identifier(id);const db=getFirestoreDb(),ref=db.collection(TEAM_COLLECTION).doc(id);
 return db.runTransaction(async tx=>{const team=owned((await tx.get(ref)).data() as PreviewTeam|undefined,ownerId);const leagues=await tx.get(db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId));
 if(team.version!==version)throw error('Team yangilangan. Qayta yuklang.',409);
 if(leagues.docs.some(d=>(d.data() as TeamLeague).teamIds.includes(id)))throw error('Team turnirga biriktirilgan. Tarixni saqlash uchun o‘chirish yopiq; tayyorlanayotgan turnirdan avval chiqarib oling.',409);
 const pending=await tx.get(db.collection('team_membership_invitations').where('teamId','==',id).where('status','==','PENDING').limit(200));for(const row of pending.docs)tx.update(row.ref,{status:'CANCELLED',noticePending:false});
 tx.delete(ref);return {id};});
}
