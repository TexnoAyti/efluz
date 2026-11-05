import assert from 'node:assert/strict';
import {buildAiDailyReport,tashkentReportDate} from '../services/telegramAiDailyReport';
import {loadDailyReportOperations,type DailyReportOperations} from '../services/telegramAiDailyReportSources';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState} from '../services/uzeflifeService';

const now=new Date('2026-11-05T03:00:00Z'),recent='2026-11-05T00:00:00Z',old='2026-11-03T00:00:00Z';
const competitions=[{id:'league',name:'La Liga',type:'LEAGUE',status:'ACTIVE',currentMatchday:3},{id:'cup',name:'Kubok',type:'KNOCKOUT',status:'ACTIVE',currentMatchday:1},{id:'hidden',name:'Hidden',type:'LEAGUE',hidden:true,currentMatchday:1},{id:'completed',name:'Old',type:'LEAGUE',status:'COMPLETED',currentMatchday:1}];
const fixture=(id:string,matchday=3,status='SCHEDULED',extra:any={})=>({id,matchday,status,competitionId:'league',competition:'La Liga',home:'Barcelona',away:'Real Madrid',...extra});
const fixtures=[fixture('old',1),fixture('current'),fixture('pending',3,'PENDING_CONFIRMATION'),fixture('dispute',3,'DISPUTED'),fixture('future',4),fixture('done',3,'CONFIRMED',{homeScore:2,awayScore:1,resultConfirmedAt:recent}),fixture('outside',2,'CONFIRMED',{homeScore:8,awayScore:8,resultConfirmedAt:old}),fixture('tie',1,'CONFIRMED',{competitionId:'cup',homeScore:1,awayScore:1}),fixture('hidden',1,'DISPUTED',{competitionId:'hidden'}),fixture('completed',1,'PENDING_CONFIRMATION',{competitionId:'completed'})];
const s=initialUState();s.format='LEAGUE';s.status='playing';s.round=2;s.participants=[{id:'linked',name:'Ali',status:'approved'},{id:'uze-slot-1-2',name:'Vali',status:'approved'}];
const match=(id:string,round:number,extra:any={})=>({id,round,bracket:0,home:'linked',away:'uze-slot-1-2',homeScore:null,awayScore:null,winner:null,penaltyHome:null,penaltyAway:null,scheduledAt:null,proposal:null,...extra});
s.matches=[match('u-old',1,{deadlineAt:old}),match('u-current',2,{proposal:{by:'linked',home:2,away:1,penaltyHome:null,penaltyAway:null}}),match('u-future',3,{deadlineAt:old})];
const operations:DailyReportOperations={unavailable:[],locks:[{competitionId:'league',matchday:1,expiresAt:old},{competitionId:'league',matchday:3,expiresAt:old}],deadlines:[{fixtureId:'current',deadlineAt:'2026-11-05T10:00:00Z'}],uzeflife:s,teams:[{status:'ACTIVE',currentRound:1,fixtures:[{round:1,bouts:[{pendingResult:{},disputed:true}]}]}],clasico:null,channelPosts:[{round:2,state:'sent',sentPages:16,totalPages:16}],users:{total:123,newUsers:4},payments:[{currency:'XTR',amount:50,paidAt:recent,userId:'SECRET-USER',telegramPaymentChargeId:'SECRET-CHARGE'},{currency:'UZS',amount:999999,paidAt:recent},{currency:'XTR',amount:50,paidAt:old}],broadcasts:[{createdAt:old,metrics:{sentCount:9999},recipients:[{status:'SENT',sentAt:recent},{status:'SENT',sentAt:old}]},{createdAt:recent,recipients:[{status:'FAILED',error:'DELIVERY_UNKNOWN: interrupted'},{status:'FAILED',error:'403'},{status:'PENDING'},{status:'SKIPPED_NO_TELEGRAM'}]}]};
const read=async(q:any)=>{const rows=q.dataset==='competitions'?competitions:fixtures;return {data:rows.slice(q.offset,q.offset+30),nextOffset:null,complete:true,stale:false};};
const report=await buildAiDailyReport(read,{now,loadOperations:async()=>structuredClone(operations)});
assert.deepEqual(report.counts,{active:3,pending:1,disputed:1,unresolved:1,backlog:1,overdue:3,due:1,confirmed24h:1});
assert.match(report.text,/Tasdiqlangan: 1 ta o‘yin · Gollar: 3/);
assert.match(report.text,/La Liga · 3-tur: 1\/4 yakunlangan/);
assert.match(report.text,/Akkaunt ulagan: 1\/2/);assert.match(report.text,/Oldingi turlarda 1 o‘yin qolgan/);
assert.match(report.text,/yetkazilgan: 1 · Rad etilgan: 1 · Noma’lum: 1/);
assert.match(report.text,/16\/16 rasm · yuborilgan/);assert.match(report.text,/1 to‘lov · 50 Stars/);
assert.doesNotMatch(report.text,/SECRET|9999|999999|u-future|Hidden/);
assert.equal(report.window.from,'2026-11-04T03:00:00.000Z');assert.equal(report.generatedAt,now.toISOString());
const boundaries=await buildAiDailyReport(async q=>({data:q.dataset==='competitions'?competitions:[fixture('at-start',3,'CONFIRMED',{resultConfirmedAt:report.window.from}),fixture('at-end',3,'CONFIRMED',{resultConfirmedAt:now.toISOString()}),fixture('after',3,'CONFIRMED',{resultConfirmedAt:'2027-01-01T00:00:00Z'})],nextOffset:null,complete:true,stale:false}),{now});
assert.equal(boundaries.counts.confirmed24h,1,'The (from,to] window counts a boundary result only once across daily reports');
const oldUnknown=await buildAiDailyReport(read,{now,loadOperations:async()=>({...structuredClone(operations),channelPosts:[{round:2,state:'sending',leaseUntil:1,sentPages:3,totalPages:16}],broadcasts:[{createdAt:old,recipients:[{status:'FAILED',error:'DELIVERY_UNKNOWN'}]}]})});
assert.match(oldUnknown.text,/ochiq noma’lum: 1/);assert.match(oldUnknown.text,/kanalni tekshirish kerak/);assert.match(oldUnknown.text,/Kanal: 1 turning yuborilishini tekshiring/);
assert.equal(tashkentReportDate(new Date('2026-11-04T20:00:00Z')),'2026-11-05');
const degraded=await buildAiDailyReport(async()=>{throw Error('offline');},{now,loadOperations:async()=>({unavailable:['UZEFLIFE','Telegram yetkazilishi']})});
assert.equal(degraded.complete,false);assert.match(degraded.text,/to‘liq emas/);assert.match(degraded.text,/O‘qilmadi: UZEFLIFE, Telegram/);assert.doesNotMatch(degraded.text,/Shoshilinch muammo aniqlanmadi|TELEGRAM\n24 soatda yetkazilgan: 0/);
const stale=await buildAiDailyReport(async q=>({...await read(q),stale:true}),{now});assert.equal(stale.stale,true);assert.match(stale.text,/eski nusxadan/);
let calls=0;const broken=await buildAiDailyReport(async q=>{calls++;return {data:[fixture('duplicate')],nextOffset:1,complete:true};},{now});assert.equal(broken.complete,false);assert.equal(calls,2,'Broken pagination stops instead of looping');
const many=Array.from({length:300},(_,i)=>fixture('long-'+i,3,'DISPUTED',{home:'😀'.repeat(250)+'\nFAKE SECTION',away:'x'.repeat(300),competition:'C'.repeat(200)}));
const bounded=await buildAiDailyReport(async q=>{const rows=q.dataset==='competitions'?competitions:many;return {data:rows.slice(q.offset,q.offset+30),nextOffset:q.offset+30<rows.length?q.offset+30:null,complete:true,stale:false};},{now,loadOperations:async()=>structuredClone(operations)});
assert.ok(bounded.text.length<=3800);assert.doesNotMatch(bounded.text,/\nFAKE SECTION/);assert.match(bounded.text,/Admin panel/);
const timeout=AbortSignal.timeout;
AbortSignal.timeout=()=>{const c=new AbortController();setTimeout(()=>c.abort(),5);return c.signal;};
try{const hung=await buildAiDailyReport(()=>new Promise(()=>{}),{now,loadOperations:()=>new Promise(()=>{})});assert.equal(hung.complete,false);assert.ok(hung.unavailable.includes('Qo‘shimcha manbalar'));}
finally{AbortSignal.timeout=timeout;}

await initDatabase();const db=getFirestoreDb();
await db.collection('users').doc('report-new').set({createdAt:recent});await db.collection('users').doc('report-future').set({createdAt:'2027-01-01T00:00:00Z'});
await db.collection('premium_payments').doc('paid').set({paidAt:recent,currency:'XTR',amount:50});
await db.collection('uzeflife').doc('championship').set(s);
// Read-only production loader: a missing source is disclosed while other
// sections survive, and a row limit never silently becomes a total.
const original=db.collection;db.collection=((name:string)=>{
 if(name==='team_league_preview_leagues')throw Error('isolated team read outage');
 if(name==='uzeflife_channel_posts')return {limit:()=>({get:async()=>({docs:Array.from({length:501},(_,i)=>({id:String(i),data:()=>({})}))})})} as any;
 const ref=original.call(db,name);return ref;
}) as any;
try{const loaded=await loadDailyReportOperations(now);assert.equal(loaded.uzeflife?.round,2);assert.equal(loaded.users?.newUsers,1);assert.equal(loaded.payments?.length,1);assert.ok(loaded.unavailable.includes('TEAMS'));assert.ok(loaded.unavailable.includes('Kanal e’lonlari'));assert.equal(loaded.channelPosts,undefined);}
finally{db.collection=original;}
console.log('PASS enhanced daily report: 24h window, Tashkent boundary, active/future/hidden scopes, per-game deadline override, postponed matches, UZEFLIFE account linking, real delivery receipts, Stars currency, private-field exclusion, partial/stale coverage, bounded pagination/text and source isolation; no Telegram sends.');
