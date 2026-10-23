import crypto from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import type {PreviewTeam,TeamLeague,TeamLineup} from '../../types/teamLeaguePreview';
import {makeTeamSchedule,teamFixtureScore,teamStandings,makeTeamPlayoffRound,teamFixtureWinner,teamFormatPreview} from '../../lib/teamLeagueEngine';
export const TEAM_COLLECTION='team_league_preview_teams',LEAGUE_COLLECTION='team_league_preview_leagues';
const error=(message:string,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const text=(v:unknown,max=60)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw error('Nom yoki matn noto‘g‘ri.');return v.trim();};
const identifier=(v:unknown)=>{if(typeof v!=='string'||!/^tp_[a-zA-Z0-9_-]{8,80}$/.test(v))throw error('Obyekt identifikatori noto‘g‘ri.');return v;};
const owned=<T extends {ownerId:string}>(v:T|undefined,ownerId:string):T=>{if(!v||v.ownerId!==ownerId)throw error('Team yoki turnir topilmadi.',404);return v;};
const now=()=>new Date().toISOString();
async function logo(v:unknown){
 if(v==='')return '';if(typeof v!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v))throw error('Logo PNG rasm bo‘lishi kerak.');
 const bytes=Buffer.from(v.split(',')[1],'base64');
 if(bytes.length<24||bytes.length>60000||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)>512||bytes.readUInt32BE(20)>512)throw error('Logo 512×512 va 60 KB dan oshmasin.');
 try{const {loadImage}=await import('@napi-rs/canvas');await loadImage(bytes);}catch{throw error('Logo rasmini o‘qib bo‘lmadi.');}return v;
}
export async function getTeamPreview(ownerId:string){
 const db=getFirestoreDb();const [ts,ls]=await Promise.all([db.collection(TEAM_COLLECTION).where('ownerId','==',ownerId).limit(32).get(),db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId).limit(8).get()]);
 return {teams:ts.docs.map(d=>d.data() as PreviewTeam),leagues:ls.docs.map(d=>({...d.data() as TeamLeague,fixtures:[],teams:{},audit:[]}))};
}
export async function getPreviewLeague(ownerId:string,id:string){identifier(id);return owned((await getFirestoreDb().collection(LEAGUE_COLLECTION).doc(id).get()).data() as TeamLeague|undefined,ownerId);}
export async function getPreviewTeamProfile(ownerId:string,id:string){
 identifier(id);const db=getFirestoreDb();
 const team=owned((await db.collection(TEAM_COLLECTION).doc(id).get()).data() as PreviewTeam|undefined,ownerId);
 const [ls,ts]=await Promise.all([db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId).limit(8).get(),db.collection(TEAM_COLLECTION).where('ownerId','==',ownerId).limit(32).get()]);
 return {team,leagues:ls.docs.map(d=>d.data() as TeamLeague).filter(l=>l.teamIds.includes(id)),teams:ts.docs.map(d=>d.data() as PreviewTeam)};
}
export async function savePreviewTeam(ownerId:string,input:any){
 const id=identifier(input.id),name=text(input.name),image=await logo(input.logo??'');
 if(!Array.isArray(input.members)||input.members.length<1||input.members.length>30)throw error('Tarkibda 1–30 o‘yinchi bo‘lsin.');
 const members=input.members.map((p:any)=>({id:identifier(p?.id),name:text(p?.name,50)}));
 if(new Set(members.map(p=>p.id)).size!==members.length||new Set(members.map(p=>p.name.toLowerCase())).size!==members.length)throw error('Tarkibda takrorlangan o‘yinchi bor.');
 if(!members.some(p=>p.id===input.captainMemberId))throw error('Sardorni tarkibdan tanlang.');
 const db=getFirestoreDb(),ref=db.collection(TEAM_COLLECTION).doc(id);
 return db.runTransaction(async tx=>{
  const old=(await tx.get(ref)).data() as PreviewTeam|undefined;
  if(old)owned(old,ownerId);
  const leagues=await tx.get(db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId));
  if(leagues.docs.some(d=>{const l=d.data() as TeamLeague;return l.status==='ACTIVE'&&l.teamIds.includes(id);}))throw error('Team faol turnirda qatnashyapti. Tarkib va logoni turnir tugagach tahrirlang.',409);
  const teams=await tx.get(db.collection(TEAM_COLLECTION).where('ownerId','==',ownerId));
  if(!old&&teams.size>=32)throw error('Testda ko‘pi bilan 32 team yarating.');
  const payload={name,logo:image,members,captainMemberId:input.captainMemberId};
  if(old&&JSON.stringify({name:old.name,logo:old.logo,members:old.members,captainMemberId:old.captainMemberId})===JSON.stringify(payload))return old;
  if((old?.version??0)!==input.version)throw error('Team yangilangan. Yangilab qayta urining.',409);
  const team:PreviewTeam={id,ownerId,...payload,version:(old?.version??0)+1,updatedAt:now()};tx.set(ref,team);return team;
 });
}
export async function savePreviewLeague(ownerId:string,input:any){
 const id=identifier(input.id),name=text(input.name),ids=input.teamIds;
 const format=input.format??'LEAGUE',description=typeof input.description==='string'?input.description.trim():'';
 if(!['LEAGUE','PLAYOFF','LEAGUE_AND_PLAYOFF'].includes(format)||description.length>1000)throw error('Format yoki tavsif noto‘g‘ri.');
 const qualifiers=format==='LEAGUE_AND_PLAYOFF'?input.qualifiers:2;
 if(!Array.isArray(ids)||ids.length<2||ids.length>16||new Set(ids).size!==ids.length)throw error('2–16 ta turli team tanlang.');
 ids.forEach(identifier);
 if(format==='PLAYOFF'&&![2,4,8,16].includes(ids.length))throw error('Pley-off uchun 2, 4, 8 yoki 16 team tanlang.');
 if(format==='LEAGUE_AND_PLAYOFF'&&(![2,4,8,16].includes(qualifiers)||qualifiers>ids.length))throw error('Pley-offga chiqadigan teamlar sonini to‘g‘ri tanlang.');
 if(!Number.isInteger(input.starterCount)||input.starterCount<1||input.starterCount>16||![1,2].includes(input.rounds))throw error('Asosiy tarkib 1–16 o‘yinchi, davra 1 yoki 2 bo‘lsin.');
 const db=getFirestoreDb(),ref=db.collection(LEAGUE_COLLECTION).doc(id);
 return db.runTransaction(async tx=>{
  const old=(await tx.get(ref)).data() as TeamLeague|undefined;if(old)owned(old,ownerId);
  const all=await tx.get(db.collection(LEAGUE_COLLECTION).where('ownerId','==',ownerId));
  if(!old&&all.size>=8)throw error('Testda ko‘pi bilan 8 ta turnir yarating.');
  if(old&&old.status!=='DRAFT')throw error('Boshlangan turnir reglamenti yopiq.',409);
  const snapshots=await Promise.all(ids.map((tid:string)=>tx.get(db.collection(TEAM_COLLECTION).doc(tid))));
  for(const doc of snapshots){const t=owned(doc.data() as PreviewTeam|undefined,ownerId);if(t.members.length<input.starterCount)throw error(`${t.name}: asosiy tarkib uchun o‘yinchi yetmaydi.`);}
  if(old&&(old.format??'LEAGUE')===format&&(old.description??'')===description&&(old.qualifiers??2)===qualifiers&&old.name===name&&old.starterCount===input.starterCount&&old.rounds===input.rounds&&JSON.stringify(old.teamIds)===JSON.stringify(ids))return old;
  if((old?.version??0)!==input.version)throw error('Turnir yangilangan. Qayta yuklang.',409);
  const l:TeamLeague={id,ownerId,name,format,description,qualifiers,teamIds:ids,starterCount:input.starterCount,rounds:input.rounds,status:'DRAFT',currentRound:0,totalRounds:0,fixtures:[],teams:{},version:(old?.version??0)+1,updatedAt:now(),audit:old?.audit??[]};tx.set(ref,l);return l;
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
 return db.runTransaction(async tx=>{
  const l=owned((await tx.get(ref)).data() as TeamLeague|undefined,ownerId);
  if(!['START','LINEUP','PAIR','RESET','SUBSTITUTE','SCORE','NEXT','CANCEL','TIEBREAK'].includes(input.action))throw error('Noma’lum amal.');
  if(l.version!==input.version)throw error('Turnir holati o‘zgargan. Yangilab qayta urining.',409);
  if(input.action==='START'){
   if(l.status!=='DRAFT')throw error('Turnir allaqachon boshlangan.',409);
   const docs=await Promise.all(l.teamIds.map(tid=>tx.get(db.collection(TEAM_COLLECTION).doc(tid))));
   for(const doc of docs){const t=owned(doc.data() as PreviewTeam|undefined,ownerId);if(t.members.length<l.starterCount)throw error(`${t.name}: o‘yinchi yetmaydi.`);l.teams[t.id]={id:t.id,name:t.name,members:t.members,captainMemberId:t.captainMemberId};}
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
