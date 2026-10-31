import {getUserNotificationsFirestore,invalidateFirestoreCache} from '../firebase/firestoreStore';
import {getFirestoreDb} from '../firebase/admin';
import {getNotificationReadState,applyNotificationReadState} from './notificationReadState';
import {getNotificationControls,notificationVisible} from './notificationVisibility';
import {redisGetFresh,redisGetLkg,redisSetRaw} from '../readModel/readModelStore';
import type {Notification} from '../../types';
const key=(userId:string,limit:number)=>`efluz:v1:user:${userId}:notifications:${limit}`;
/** Retrying delivery must preserve the original timestamp and read status. */
export async function persistLiveUserNotification(notification:Notification){
 const ref=getFirestoreDb().collection('notifications').doc(notification.id);
 await getFirestoreDb().runTransaction(async tx=>{if(!(await tx.get(ref)).exists)tx.set(ref,notification);});
 invalidateFirestoreCache(`firestore:notifications:${notification.userId}`);
}
/** Publish on delivery, rather than querying the database on every viewer poll. */
export async function publishLiveUserNotifications(userId:string){
 const generatedAt=new Date().toISOString();
 const rows=await getFirestoreDb().collection('notifications').where('userId','==',userId).orderBy('createdAt','desc').limit(30).get();
 const notifications=rows.docs.map(d=>{const v=d.data(),data=v.data||{};return {id:d.id,userId,type:v.type||'SYSTEM',title:v.title,message:v.message,broadcastId:v.broadcastId||data.broadcastId,entityType:v.entityType||data.entityType,entityId:v.entityId||data.entityId,fixtureId:v.fixtureId||data.fixtureId,isRead:!!v.isRead,createdAt:v.createdAt} as Notification;});
 await redisSetRaw(key(userId,30),{data:notifications,generatedAt,sourceVersion:'competition-notifications'},300);
}
/** A shared projection bypasses stale instance-local lists without extra reads. */
export async function getLiveUserNotifications(userId:string,limit=30):Promise<Notification[]>{
 try{
  const snapshot=(await redisGetFresh<Notification[]>(key(userId,limit)))||(await redisGetLkg<Notification[]>(key(userId,limit)));
  if(snapshot&&Array.isArray(snapshot.data)){
   const [read,controls]=await Promise.all([getNotificationReadState(userId),getNotificationControls()]);
   return applyNotificationReadState(snapshot.data.filter(n=>n.userId===userId&&notificationVisible(n,controls)).slice(0,30),read);
  }
 }catch{ /* Preserve the previous resilient reader during projection outages. */ }
 return getUserNotificationsFirestore(userId,limit);
}
