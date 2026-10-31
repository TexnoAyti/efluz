import assert from 'node:assert/strict';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState,applyUAction,mutateUState,readUState,publicUState} from '../services/uzeflifeService';
import {uTransitionNotices,processUNotices,sweepUDeadlines,validUNotice,prepareUNotifications,runNoticePreparations} from '../services/uzeflifeNotifications';
import {normalizeUEvidence} from '../services/uzeflifeEvidence';
import {paintUzeflifeChampion} from '../../lib/uzeflifeChampionImage';
import {readUzeflifeLaunch,uzeflifeMatchLink} from '../../lib/uzeflifeLinks';
import type {User} from '../../types';
import {writeFileSync} from 'node:fs';

await initDatabase();const db=getFirestoreDb();
const owner={id:'canonical-owner',telegramId:'5209126900',isAdmin:false,isSuspended:false,firstName:'Owner'} as User;
const other={id:'outsider',telegramId:'99999',isAdmin:false,isSuspended:false} as User;
const s=initialUState();s.status='registration';s.participants=Array.from({length:256},(_,i)=>({id:'p'+i,name:i===0?'Muhammadazizbek Abdurahmonov':'Ishtirokchi '+i,status:'approved'}));
await db.collection('users').doc(owner.id).set(owner);await db.collection('uzeflife').doc('championship').set(s);
await mutateUState(owner,'roundSettings',{hours:72});await mutateUState(owner,'generate',{});
let state=await readUState();assert.equal(state.matches.filter(m=>m.deadlineAt).length,128);assert.ok(Date.parse(state.matches[0].deadlineAt!)>Date.now()+71*3600000);
const jobs=()=>db.collection('uzeflife_notifications').get();assert.equal((await jobs()).size,1);
const beforeJob=(await jobs()).docs[0].data();assert.equal(beforeJob.notices.length,256,'Both players receive their own opponent and match link');
const home={id:state.matches[0].home,telegramId:'10001',isAdmin:false,isSuspended:false} as User,away={id:state.matches[0].away,telegramId:'10002',isAdmin:false,isSuspended:false} as User;
for(const u of [home,away])await db.collection('users').doc(u.id).set(u);
const delivered:any[]=[];const enqueue=async(n:any)=>{delivered.push(n);return true;};
assert.equal(await processUNotices(3,enqueue,Date.now()-1),true);assert.equal(delivered.length,0,'Expired worker budget preserves pending work');
await Promise.all([processUNotices(3,enqueue),processUNotices(3,enqueue)]);assert.equal(delivered.length,3,'Concurrent workers respect the durable lease');
assert.ok(delivered.every(n=>n.replyMarkup.inline_keyboard[0][0].url.startsWith('https://t.me/efluzbot?startapp=uze_r1m')));
let attempt=0;await assert.rejects(processUNotices(3,async(n)=>{if(++attempt===2)throw Error('temporary queue outage');return enqueue(n);}),/outage/);
assert.equal((await jobs()).docs[0].data().cursor,4,'Only durably accepted events advance the cursor');
while(await processUNotices(50,enqueue)){}assert.equal(delivered.length,256);assert.equal(new Set(delivered.map(n=>n.eventId)).size,256);assert.equal(await processUNotices(50,enqueue),false);
const match=state.matches[0];
const approve=async(actor:User)=>mutateUState(actor,'approveResult',{matchId:match.id,expected:(await readUState()).matches[0].proposal||{by:home.id,home:3,away:1,penaltyHome:null,penaltyAway:null}});
await assert.rejects(mutateUState(other,'deadline',{matchId:match.id,deadlineAt:new Date(Date.now()+86400000).toISOString()}),/ruxsat/);
await mutateUState(owner,'deadline',{matchId:match.id,deadlineAt:new Date(Date.now()+12*3600000).toISOString()});
await sweepUDeadlines();const firstReminder=(await jobs()).size;await sweepUDeadlines(Date.now()+2*3600000);assert.equal((await jobs()).size,firstReminder,'Repeated sweeps do not recreate pending reminder jobs');
await mutateUState(home,'result',{matchId:match.id,home:2,away:1});state=await readUState();assert.ok(state.matches[0].proposal);assert.equal(state.matches[0].winner,null);
const proposed=uTransitionNotices(s,state).filter(n=>n.kind==='proposal');assert.ok(proposed.some(n=>n.userId===away.id));assert.ok(proposed.some(n=>n.adminOnly));
await assert.rejects(approve(other),/ruxsat/);
await assert.rejects(mutateUState(owner,'approveResult',{matchId:match.id,expected:{...state.matches[0].proposal,home:9}}),/yangilangan/,'An admin cannot approve a different proposal than the one reviewed');
const canvas=createCanvas(64,64);canvas.getContext('2d').fillRect(0,0,64,64);const jpeg=canvas.toBuffer('image/jpeg',75).toString('base64');assert.ok(await normalizeUEvidence(jpeg));await assert.rejects(normalizeUEvidence('PHN2Zz48L3N2Zz4='),/JPG/);
await assert.rejects(mutateUState(other,'dispute',{matchId:match.id,reason:'Hisob xato',evidence:jpeg}),/sizning/);
await mutateUState(away,'dispute',{matchId:match.id,reason:'Hisob skrinshotga mos emas',evidence:jpeg});state=await readUState();const disputed=state.matches[0];assert.equal(disputed.dispute?.status,'open');assert.equal((await db.collection('uzeflife_evidence').get()).size,1);
assert.equal(publicUState(state,other).matches[0].dispute,null);assert.ok(publicUState(state,away).matches[0].dispute?.evidenceId);assert.equal(JSON.stringify(publicUState(state,away)).includes(jpeg),false);
await assert.rejects(approve(owner),/e’tiroz/);await assert.rejects(mutateUState(owner,'clearProposal',{matchId:match.id}),/e’tiroz/);await assert.rejects(mutateUState(home,'result',{matchId:match.id,home:2,away:1}),/e’tiroz/);
await mutateUState(owner,'resolveDispute',{matchId:match.id,resolution:'Skrinshot tekshirildi, hisob qayta kiritilsin.'});state=await readUState();assert.equal(state.matches[0].proposal,null);assert.equal(state.matches[0].dispute?.status,'resolved');
const disputeNotice=uTransitionNotices(s,{...state,matches:[disputed]}).find(n=>n.kind==='dispute'&&n.adminOnly)!;assert.equal(validUNotice({...disputeNotice,userId:owner.id},state,owner.id),false,'Resolved dispute notifications cannot leak as new pending alerts');
await mutateUState(home,'result',{matchId:match.id,home:3,away:1});await approve(owner);state=await readUState();assert.equal(state.matches[0].winner,home.id);assert.equal(state.matches.find(m=>m.id==='r2m0')?.home,home.id);await assert.rejects(approve(owner),/topilmadi/);
// Complete all 255 fixtures through the same engine, then persist a full archive.
for(let r=1;r<=8;r++){for(const m of state.matches.filter(m=>m.round===r&&!m.winner))applyUAction(state,owner,'result',{matchId:m.id,home:1,away:0,penaltyHome:null,penaltyAway:null});if(r<8)applyUAction(state,owner,'next',{});}
await db.collection('uzeflife').doc('championship').set(state);await mutateUState(owner,'complete',{});state=await readUState();assert.equal(state.history?.[0].matchCount,255);const archive=(await db.collection('uzeflife_history').doc(state.history![0].id).get()).data()!;assert.equal(archive.matches.length,255);assert.ok(archive.matches.every((m:any)=>!m.dispute&&!m.proposal));assert.ok(uTransitionNotices({...state,status:'playing'},state).some(n=>n.kind==='champion'));
GlobalFonts.registerFromPath('node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf','Arial');GlobalFonts.registerFromPath('node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf','Arial');
const image=createCanvas(1080,1350);paintUzeflifeChampion(image.getContext('2d') as any,state,'season-2026-27');assert.equal(image.width,1080);assert.equal(image.height,1350);const png=image.toBuffer('image/png');assert.ok(png.length>10000&&png.length<500000);writeFileSync('/tmp/efluz-uzeflife-champion-qa.png',png);
assert.throws(()=>paintUzeflifeChampion(image.getContext('2d') as any,{...state,status:'playing'},'season-2026-27'),/yakunlangach/);
assert.equal(uzeflifeMatchLink('r8m0'),'https://t.me/efluzbot?startapp=uze_r8m0');assert.throws(()=>uzeflifeMatchLink('../admin'));
const windowBefore=globalThis.window;(globalThis as any).window={location:{search:'?startapp=uze_r2m12'},Telegram:{WebApp:{}}};assert.equal(readUzeflifeLaunch(),'r2m12');(globalThis as any).window.location.search='?startapp=uze_../../admin';assert.equal(readUzeflifeLaunch(),null);(globalThis as any).window=windowBefore;
const collectionBefore=db.collection;(db as any).collection=()=>{throw Error('No database access during freeze/preview');};
try{process.env.MIGRATION_WRITE_FREEZE='true';assert.equal(await prepareUNotifications(),false);delete process.env.MIGRATION_WRITE_FREEZE;process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';assert.equal(await prepareUNotifications(),false);}finally{(db as any).collection=collectionBefore;delete process.env.MIGRATION_WRITE_FREEZE;delete process.env.DATABASE_PROVIDER;delete process.env.SUPABASE_DATA_NAMESPACE;}
console.log('PASS UZEFLIFE: atomic opponent intents, leased/retry-safe outbox, match deep links, deadline reminders/deduplication, private screenshots, dispute blocking/resolution, admin result queue, 255-match archive and native EFL champion PNG. No Telegram messages sent.');

const attempts:string[]=[];
await assert.rejects(runNoticePreparations([
 async()=>{attempts.push('competition');throw Error('isolated competition outage');},
 async()=>{attempts.push('custom');return true;},
 async()=>{attempts.push('deadlines');throw Error('isolated deadline index outage');},
 async()=>{attempts.push('uzeflife');return false;},
]),AggregateError);
assert.deepEqual(attempts,['competition','custom','deadlines','uzeflife'],'An unrelated outbox or deadline error cannot prevent other tournaments from preparing messages');
assert.equal(await runNoticePreparations([async()=>true,async()=>false]),true,'Keep continuation work even if the final phase is empty');
console.log('PASS notification phase failure isolation and continuation propagation');
