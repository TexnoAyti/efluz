import {randomUUID} from 'node:crypto';
import {FieldPath} from 'firebase-admin/firestore';
import {z} from 'zod';
import type {User} from '../../types';
import type {AwardElection,AwardPlayer,SeasonAwardsView} from '../../types/seasonAwards';
import {awardPlayers,rankAwardPlayers,awardStandings,awardTiedWinners,awardWeek} from '../../lib/seasonAwards';
import {isSeasonLeagueEnabled} from '../../lib/seasonParticipationPolicy';
import {SEED_CLUBS} from '../db/seed';
import {getFirestoreDb} from '../firebase/admin';
import {loadPostgresSeasonFixtures} from './postgresSeasonRead';
const clubs=new Map(SEED_CLUBS.map(c=>[c.id,c]));
const active=(o:any,season:string)=>o.seasonId===season&&o.clubId&&o.userId&&['active','occupied','owned'].includes(o.status)&&isSeasonLeagueEnabled(clubs.get(o.clubId)?.leagueId,season);
const manage=(u:any)=>u&&!u.isSuspended&&u.isAdmin===true&&(!u.adminPermissions||u.adminPermissions.scope==='ALL');
const fail=(message:string,statusCode=400):never=>{throw Object.assign(Error(message),{statusCode});};
const empty=():AwardElection=>({id:'',version:0,status:'draft',minMatches:3,nominees:[],jury:[],ballots:{},closesAt:null,openedAt:null,publishedAt:null});
const seasonSchema=z.string().regex(/^season-\d{4}-\d{2}$/);
export const parseAwardSeason=(value:unknown)=>{const r=seasonSchema.safeParse(value);if(!r.success)fail('Mavsum noto‘g‘ri.');return r.data;};
async function dataFor(season:string){
 const db=getFirestoreDb();const [fixtures,occ,trophyRows]=await Promise.all([loadPostgresSeasonFixtures(season),db.collection('club_occupancies').where('seasonId','==',season).get(),db.collection('player_trophies').where('seasonId','==',season).get()]);
 const owners=occ.docs.map(d=>d.data()).filter(o=>active(o,season));
 const ids=[...new Set([...owners.map(o=>o.userId),...fixtures.flatMap(f=>[f.homeOwnerId,f.awayOwnerId,f.homeOwner?.userId,f.awayOwner?.userId])].filter((id):id is string=>!!id))];
 const batches=await Promise.all(Array.from({length:Math.ceil(ids.length/30)},(_,i)=>db.collection('users').where(FieldPath.documentId(),'in',ids.slice(i*30,(i+1)*30)).get()));
 const accounts:User[]=batches.flatMap(b=>b.docs.map(d=>({...d.data(),id:d.id} as User)));const counts=new Map<string,number>();for(const u of accounts)counts.set(u.telegramId,(counts.get(u.telegramId)||0)+1);
 const unique=accounts.filter(u=>counts.get(u.telegramId)===1&&!u.isSuspended&&/^\d+$/.test(u.telegramId||''));
 const titles=trophyRows.docs.map(d=>d.data()).filter(t=>t.active!==false);
 return{fixtures,owners,accounts:unique,titles};
}
const weekly=(rows:AwardPlayer[])=>[...rows].sort((a,b)=>b.points-a.points||(b.goals-b.conceded)-(a.goals-a.conceded)||b.goals-a.goals||a.id.localeCompare(b.id));
export async function readSeasonAwards(season:string,actor?:User):Promise<SeasonAwardsView>{
 const db=getFirestoreDb();const [data,snap,account]=await Promise.all([dataFor(season),db.collection('season_awards').doc(season).get(),actor?db.collection('users').doc(actor.id).get():null]);
 const u=account?.data(),e=(snap.data() as AwardElection|undefined)||empty(),now=Date.now(),period=awardWeek(now),previous={from:period.from-7*86400000,to:period.from};
 const all=awardPlayers(data.fixtures,data.owners as any,data.accounts as any,data.titles),currentWeek=weekly(awardPlayers(data.fixtures,data.owners as any,data.accounts as any,[],period).players),lastWeek=weekly(awardPlayers(data.fixtures,data.owners as any,data.accounts as any,[],previous).players);
 const hasClub=!!actor&&data.owners.some(o=>o.userId===actor.id),telegram=String(u?.telegramId||''),validActor=!!actor&&u&&!u.isSuspended&&telegram===String(actor.telegramId),canManage=!!validActor&&manage(u);
 const {jury,ballots,...publicElection}=e;
 if(!e.id)publicElection.nominees=rankAwardPlayers(all.players.filter(p=>p.played>=e.minMatches)).slice(0,10);const effectiveClosed=e.status!=='open'||Date.parse(e.closesAt||'')<=now;
 const results=e.status==='published'||canManage&&effectiveClosed?awardStandings(e):[];const tied=e.status==='published'?awardTiedWinners(results):[];
 return{seasonId:season,now:new Date(now).toISOString(),canManage,hasClub:!!validActor&&hasClub,canVote:!!validActor&&hasClub&&jury.includes(telegram)&&!effectiveClosed,myRanking:validActor?ballots[telegram]?.ranking||[]:[],election:publicElection,voterCount:jury.length,ballotCount:Object.keys(ballots).length,results,winners:e.status==='published'?(e.tieDecision?[e.tieDecision.winner]:tied):[],goldenBoot:all.players.filter(p=>p.goals>0).sort((a,b)=>b.goals-a.goals||a.id.localeCompare(b.id)),weekly:{from:new Date(period.from).toISOString(),to:new Date(period.to).toISOString(),leaders:currentWeek,previousLeaders:lastWeek.filter(p=>lastWeek[0]&&p.points===lastWeek[0].points&&p.goals-p.conceded===lastWeek[0].goals-lastWeek[0].conceded&&p.goals===lastWeek[0].goals)},unattributed:all.unattributed};
}
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('PREPARE'),version:z.number().int().nonnegative(),minMatches:z.number().int().min(1).max(50)}),
 z.object({action:z.literal('OPEN'),version:z.number().int().nonnegative(),closesAt:z.iso.datetime()}),
 z.object({action:z.literal('CLOSE'),version:z.number().int().nonnegative()}),
 z.object({action:z.literal('PUBLISH'),version:z.number().int().nonnegative(),tieWinner:z.string().optional(),reason:z.string().trim().max(1000).optional()}),
 z.object({action:z.literal('VOTE'),electionId:z.string().uuid(),ranking:z.array(z.string().min(1).max(100)).length(10)}),
]);
export async function mutateSeasonAwards(season:string,actor:User,body:unknown){
 const parsed=schema.safeParse(body);if(!parsed.success)fail('Mukofot ma’lumotlari noto‘g‘ri.');const d=parsed.data,db=getFirestoreDb(),ref=db.collection('season_awards').doc(season);
 // Expensive source reads happen only for administrator preparation/opening.
 let prepared:Awaited<ReturnType<typeof dataFor>>|undefined;
 if(d.action==='PREPARE'||d.action==='OPEN'){
  const u=(await db.collection('users').doc(actor.id).get()).data();if(!u||String(u.telegramId)!==String(actor.telegramId)||!manage(u))fail('Mukofotlarni faqat umumiy admin boshqaradi.',403);prepared=await dataFor(season);
 }
 await db.runTransaction(async tx=>{
  const [snap,account,occupancies]=await Promise.all([tx.get(ref),tx.get(db.collection('users').doc(actor.id)),d.action==='VOTE'||d.action==='OPEN'?tx.get(db.collection('club_occupancies').where('seasonId','==',season)):null]);
  const u=account.data(),e=(snap.data() as AwardElection|undefined)||empty(),now=Date.now();if(!u||u.isSuspended||!u.telegramId||String(u.telegramId)!==String(actor.telegramId))fail('Akkaunt vakolati o‘zgargan.',403);
  if(d.action==='VOTE'){
   const telegram=String(u.telegramId),duplicates=await tx.get(db.collection('users').where('telegramId','==',telegram).limit(2));
   if(duplicates.docs.length!==1||!occupancies?.docs.some(o=>active(o.data(),season)&&o.data().userId===actor.id)||!e.jury.includes(telegram))fail('Ovoz berish boshlanganda ro‘yxatga olingan klub egalarigina ovoz beradi.',403);
   if(e.id!==d.electionId||e.status!=='open'||Date.parse(e.closesAt||'')<=now)fail('Ovoz berish yopilgan yoki saylov o‘zgargan.',409);
   const ids=new Set(e.nominees.map(p=>p.id));if(new Set(d.ranking).size!==10||d.ranking.some(id=>!ids.has(id)))fail('10 nomzodni takrorlamasdan tartiblang.');
   e.ballots[telegram]={userId:actor.id,ranking:d.ranking,at:new Date(now).toISOString()};
  }else{
   if(!manage(u))fail('Mukofotlarni faqat umumiy admin boshqaradi.',403);if(d.version!==e.version)fail('Holat yangilangan. Qayta yuklang.',409);
   if(d.action==='PREPARE'){
    if(e.status!=='draft')fail('Ovoz berish boshlanganidan keyin nomzodlar o‘zgarmaydi.',409);
    const candidates=awardPlayers(prepared!.fixtures,prepared!.owners as any,prepared!.accounts as any,prepared!.titles).players.filter(p=>p.played>=d.minMatches);
    e.id=randomUUID();e.minMatches=d.minMatches;e.nominees=rankAwardPlayers(candidates).slice(0,10);
   }
   if(d.action==='OPEN'){
    if(e.status!=='draft'&&e.status!=='closed')fail('Bu ovoz berishni ochib bo‘lmaydi.',409);if(e.nominees.length!==10)fail('Kamida 10 ta yetarli natijaga ega o‘yinchi kerak.',409);
    const until=Date.parse(d.closesAt);if(until<=now||until>now+31*86400000)fail('Muddat kelajakdagi 31 kun ichida bo‘lsin.');
    if(!e.openedAt){const live=new Set(occupancies!.docs.filter(o=>active(o.data(),season)).map(o=>o.data().userId));e.jury=[...new Set(prepared!.accounts.filter(a=>live.has(a.id)).map(a=>String(a.telegramId)))];if(!e.jury.length)fail('Ovoz beradigan klub egalari topilmadi.',409);e.openedAt=new Date(now).toISOString();}
    e.closesAt=d.closesAt;e.status='open';
   }
   if(d.action==='CLOSE'){if(e.status!=='open')fail('Ovoz berish ochiq emas.',409);e.status='closed';}
   if(d.action==='PUBLISH'){
    if(e.status==='published')fail('Natija allaqachon e’lon qilingan.',409);
    if(e.status==='draft'||e.status==='open'&&Date.parse(e.closesAt||'')>now||!Object.keys(e.ballots).length)fail('Avval ovoz berish tugashi va kamida bitta ovoz bo‘lishi kerak.',409);
    const tied=awardTiedWinners(awardStandings(e));if(tied.length>1){if(!d.tieWinner||!tied.includes(d.tieWinner)||!d.reason||d.reason.length<5)fail('Tenglik: faqat teng nomzodlardan birini sabab bilan tanlang.',409);e.tieDecision={winner:d.tieWinner,reason:d.reason};}
    e.status='published';e.publishedAt=new Date(now).toISOString();
   }
  }
  e.version++;tx.set(ref,e);tx.set(db.collection('season_awards_audit').doc(randomUUID()),{seasonId:season,electionId:e.id,actor:actor.id,action:d.action,at:new Date(now).toISOString(),version:e.version,...(d.action==='PUBLISH'&&e.tieDecision?{tieDecision:e.tieDecision}:{})});
 });
}
