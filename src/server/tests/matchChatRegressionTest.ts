import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState} from '../services/uzeflifeService';
import {listMatchChatReports,readMatchChat,reportMatchChat,resolveMatchChatReport,sendMatchChatMessage,setMatchChatAdminBlock,setMatchChatBlock} from '../services/matchChatService';
import type {User} from '../../types';

await initDatabase();
const db=getFirestoreDb(),seasonId='season-chat-regression',fixtureId='fixture-chat-regression';
const account=(id:string,isAdmin=false):User=>({id,telegramId:id.replace(/\D/g,'')||'1',username:id,firstName:id,isAdmin,isSuspended:false,createdAt:'2026-11-06T00:00:00.000Z',updatedAt:'2026-11-06T00:00:00.000Z'});
const first=account('user-71001'),second=account('user-71002'),outsider=account('user-71003'),replacement=account('user-71004'),admin=account('user-71999',true);
for(const user of [first,second,outsider,replacement,admin])await db.collection('users').doc(user.id).set(user);
for(const [clubId,name] of [['chat-home','Chat Home'],['chat-away','Chat Away']])await db.collection('clubs').doc(clubId).set({id:clubId,name,shortName:name,leagueId:'chat-league',country:'UZ',logo:'',isActive:true,createdAt:''});
await db.collection('club_occupancies').doc(`${seasonId}_chat-home`).set({seasonId,clubId:'chat-home',userId:first.id,status:'active'});
await db.collection('club_occupancies').doc(`${seasonId}_chat-away`).set({seasonId,clubId:'chat-away',userId:second.id,status:'active'});
await db.collection('fixtures').doc(fixtureId).set({id:fixtureId,seasonId,competitionId:'chat-league',competitionName:'Chat League',matchday:3,roundName:'3-tur',homeClubId:'chat-home',awayClubId:'chat-away',scheduledAt:'2026-11-06T12:00:00.000Z',status:'SCHEDULED',createdAt:'',updatedAt:''});

let firstView=await readMatchChat('fixture',fixtureId,first);assert.equal(firstView.messages.length,0);assert.equal(firstView.opponentId,second.id);
firstView=await sendMatchChatMessage('fixture',fixtureId,first,'Assalomu alaykum');assert.equal(firstView.messages.length,1);assert.equal(firstView.unreadCount,0);
await sendMatchChatMessage('fixture',fixtureId,first,'Qachon o‘ynaymiz?');
let secondView=await readMatchChat('fixture',fixtureId,second);assert.equal(secondView.messages.length,2);assert.equal(secondView.unreadCount,0,'Opening the room acknowledges the unread burst');
assert.equal((await db.collection('notifications').where('userId','==',second.id).get()).size,1,'One in-app alert per unread burst');
await sendMatchChatMessage('fixture',fixtureId,first,'Xona ID yuboring.');const refreshedAlert=await db.collection('notifications').where('userId','==',second.id).get();assert.equal(refreshedAlert.size,1,'Chat keeps one durable in-app alert instead of flooding the inbox');assert.equal(refreshedAlert.docs[0].data().isRead,false,'A new unread burst refreshes the alert');
await assert.rejects(readMatchChat('fixture',fixtureId,outsider),(error:any)=>error.code==='NOT_MATCH_PARTICIPANT');
secondView=await setMatchChatBlock('fixture',fixtureId,second,true);assert.equal(secondView.blocked,true);await assert.rejects(sendMatchChatMessage('fixture',fixtureId,first,'blocked'),(error:any)=>error.code==='CHAT_BLOCKED');
await setMatchChatBlock('fixture',fixtureId,second,false);secondView=await reportMatchChat('fixture',fixtureId,second,'Qo‘pol xabar yuborildi');assert.equal(secondView.reportedByMe,true);
let reports=await listMatchChatReports(admin);assert.equal(reports.length,1);assert.equal(reports[0].messages.length,3);assert.equal(reports[0].reason,'Qo‘pol xabar yuborildi');
await setMatchChatAdminBlock(admin,reports[0].roomId,true);reports=await listMatchChatReports(admin);assert.equal(reports[0].blocked,true);await assert.rejects(sendMatchChatMessage('fixture',fixtureId,first,'admin blocked'),(error:any)=>error.code==='CHAT_BLOCKED');
await setMatchChatAdminBlock(admin,reports[0].roomId,false);await resolveMatchChatReport(admin,reports[0].roomId,reports[0].reportId);assert.equal((await listMatchChatReports(admin)).length,0);

await db.collection('club_occupancies').doc(`${seasonId}_chat-home`).update({userId:replacement.id});
await assert.rejects(readMatchChat('fixture',fixtureId,first),(error:any)=>error.code==='NOT_MATCH_PARTICIPANT');
const replacementView=await readMatchChat('fixture',fixtureId,replacement);assert.equal(replacementView.messages.length,0,'A transferred club never exposes the former owner chat');

const uState=initialUState();uState.status='playing';uState.round=1;uState.participants=[{id:first.id,name:'Birinchi',status:'approved'},{id:second.id,name:'Ikkinchi',status:'approved'}];uState.matches=[{id:'u-chat-match',round:1,bracket:1,home:first.id,away:second.id,homeScore:null,awayScore:null,penaltyHome:null,penaltyAway:null,winner:null,proposal:null,deadlineAt:null,scheduledAt:null,dispute:null}];
await db.collection('uzeflife').doc('championship').set(uState);
const uView=await sendMatchChatMessage('uzeflife','u-chat-match',first,'UZEFLIFE uchun tayyormisiz?');assert.equal(uView.kind,'uzeflife');assert.equal((await readMatchChat('uzeflife','u-chat-match',second)).messages.length,1);
console.log('PASS match chat: participants only, unread-burst notification dedupe, text delivery, block/unblock, report/admin review, transfer privacy and UZEFLIFE isolation.');
