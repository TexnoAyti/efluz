import assert from 'node:assert/strict';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState} from '../services/uzeflifeService';
import {processUNotices,writeUNotices,uNoticeVersion,validUNotice,uNoticeText,type UNotice} from '../services/uzeflifeNotifications';
import {getLiveUserNotifications} from '../services/liveNotifications';
import {openUzeflifeMatch} from '../../lib/uzeflifeLinks';
export async function verifyUzeflifeNotificationDelivery(){
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),prior=(await ref.get()).data();
 const collection=db.collection('uzeflife_notifications'),priorJobs=(await collection.get()).docs.map(d=>({id:d.id,data:d.data()}));for(const old of priorJobs)await collection.doc(old.id).delete();
 const users=['a','b','c'].map((id,i)=>({id:'u-notification-'+id,telegramId:String(886000+i),firstName:id,isSuspended:false}));for(const u of users)await db.collection('users').doc(u.id).set(u);
 const state=initialUState();state.format='LEAGUE';state.status='playing';state.round=1;state.participants=users.map(u=>({id:u.id,name:u.firstName,status:'approved'}));state.matches=[{id:'l1m0',round:1,bracket:0,home:users[0].id,away:users[1].id,winner:null,homeScore:null,awayScore:null,penaltyHome:null,penaltyAway:null,proposal:null,scheduledAt:null}];
 const notice=(i:number,title='Raqibingiz'):UNotice=>({userId:users[i].id,kind:'opponent',matchId:'l1m0',version:uNoticeVersion('opponent',state.matches[0]),title,body:'Raqibingiz: <b>A &amp; B &lt;test&gt;</b>'});
 const put=(id:string,notices:UNotice[])=>collection.doc(id).set({status:'pending',cursor:0,leaseUntil:0,createdAt:'2026-10-31T00:00:00.000Z',notices});
 const queued=new Set<string>(),send=async(p:any)=>{const fresh=!queued.has(p.eventId);queued.add(p.eventId);return fresh;};
 try{
  await ref.set(state);await put('u-delivery-both',[notice(0),notice(1)]);await processUNotices(10,send);
  assert.equal(queued.size,2);let a=(await db.collection('notifications').where('userId','==',users[0].id).get()).docs;assert.equal(a.length,1);assert.equal(a[0].data().message,'Raqibingiz: A & B <test>');assert.equal(a[0].data().entityType,'uzeflife');assert.equal(a[0].data().entityId,'l1m0');
  const id=a[0].id;await a[0].ref.update({isRead:true});await collection.doc('u-delivery-both').update({status:'pending',cursor:0});await processUNotices(10,send);assert.equal(queued.size,2,'Queue IDs stay stable across retries');assert.equal((await db.collection('notifications').doc(id).get()).data()?.isRead,true);assert.equal((await db.collection('notifications').doc(id).get()).data()?.createdAt,'2026-10-31T00:00:00.000Z');
  const live=await getLiveUserNotifications(users[0].id);assert.ok(live.some(n=>n.id===id&&n.isRead));assert.ok(live.every(n=>n.userId===users[0].id),'The shared snapshot stays private');
  await put('u-job-broken',[notice(0,'Broken queue')]);await put('u-job-healthy',[notice(1,'Healthy queue')]);const attempts:string[]=[];
  await assert.rejects(processUNotices(10,async p=>{attempts.push(p.title);if(p.title==='Broken queue')throw Error('isolated Telegram queue outage');return true;}),/outage/);assert.ok(attempts.includes('Healthy queue'));assert.equal((await collection.doc('u-job-healthy').get()).data()?.status,'done');assert.equal((await collection.doc('u-job-broken').get()).data()?.retryIndices?.[0],0);await processUNotices(10,send);
  await put('u-mixed-job',[notice(0,'Broken first'),notice(1,'Healthy second')]);const sameJob:string[]=[];await assert.rejects(processUNotices(10,async p=>{sameJob.push(p.title);if(p.title==='Broken first')throw Error('one recipient fails');return true;}),/fails/);assert.deepEqual(sameJob,['Broken first','Healthy second']);assert.deepEqual((await collection.doc('u-mixed-job').get()).data()?.retryIndices,[0]);await processUNotices(10,send);
  await db.collection('users').doc(users[1].id).update({isSuspended:true});await put('u-suspended',[notice(1)]);let blocked=0;await processUNotices(10,async()=>{blocked++;return true;});assert.equal(blocked,0,'A suspended recipient gets neither a bot enqueue nor a new in-app item');await db.collection('users').doc(users[1].id).update({isSuspended:false});
  assert.equal(validUNotice(notice(2),state),false,'Another approved player cannot receive this match’s private announcement');
  await put('u-wrong-recipient',[notice(2)]);await processUNotices(10,async()=>{blocked++;return true;});assert.equal(blocked,0);assert.equal((await db.collection('notifications').where('userId','==',users[2].id).get()).size,0);
  // A projection outage must not prevent the accepted Telegram job, and retry must preserve read state.
  await put('u-projection-outage',[notice(0)]);const beforeCollection=db.collection;let accepted=false;
  (db as any).collection=function(name:string){const ref=beforeCollection.call(db,name);return name==='notifications'?new Proxy(ref,{get(target,key){if(key==='where')return ()=>{throw Error('isolated live projection outage');};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}}):ref;};
  try{await assert.rejects(processUNotices(10,async()=>{accepted=true;return true;}),/projection outage/);}finally{(db as any).collection=beforeCollection;}
  assert.equal(accepted,true);assert.equal((await collection.doc('u-projection-outage').get()).data()?.retryIndices?.[0],0);await processUNotices(10,send);assert.equal((await db.collection('notifications').doc(id).get()).data()?.isRead,true);
  // A rejected score may be submitted again unchanged: this is a new occurrence,
  // while retrying that occurrence must still use the same queue ID.
  const before=structuredClone(state);state.matches[0].proposal={by:users[0].id,home:2,away:1,penaltyHome:null,penaltyAway:null};
  await db.runTransaction(async tx=>{writeUNotices(tx,before,state,'u-proposal-first');tx.set(ref,state);});const proposalIds:string[]=[];
  await processUNotices(20,async p=>{if(p.userId===users[1].id)proposalIds.push(p.eventId);return true;});
  const resolved=structuredClone(state);resolved.matches[0].proposal=null;
  await db.runTransaction(async tx=>{writeUNotices(tx,resolved,state,'u-proposal-again');tx.set(ref,state);});
  await processUNotices(20,async p=>{if(p.userId===users[1].id)proposalIds.push(p.eventId);return true;});
  assert.equal(proposalIds.length,2);assert.notEqual(proposalIds[0],proposalIds[1],'Resubmitting the same score after rejection must notify the opponent again');
  await collection.doc('u-proposal-again').update({status:'pending',cursor:0});
  await processUNotices(20,async p=>{if(p.userId===users[1].id)assert.equal(p.eventId,proposalIds[1],'Retrying this occurrence keeps its queue identity');return false;});
  const previous=globalThis.window,opened:string[]=[];(globalThis as any).window={Telegram:{WebApp:{openTelegramLink:(url:string)=>opened.push(url)}}};
  try{openUzeflifeMatch('l15m120');assert.deepEqual(opened,['https://t.me/efluzbot?startapp=uze_l15m120']);assert.throws(()=>openUzeflifeMatch('../admin'));assert.equal(opened.length,1);}finally{(globalThis as any).window=previous;}
  assert.equal(uNoticeText('&lt;b&gt;literal&lt;/b&gt; &amp; &quot;x&quot; &#39;y&#39;'),'<b>literal</b> & "x" \'y\'');
  console.log('PASS UZEFLIFE delivery/native PostgreSQL: both channels, private live snapshot, HTML-to-text, stable queue IDs, read/timestamp preservation, job isolation, suspension and recipient ACL, projection outage retry and validated 15-round navigation');
 }finally{for(const job of (await collection.get()).docs)await job.ref.delete();for(const old of priorJobs)await collection.doc(old.id).set(old.data);if(prior)await ref.set(prior);else await ref.delete();for(const u of users)await db.collection('users').doc(u.id).delete();}
}
