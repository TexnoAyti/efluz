import {getUserNotificationsFirestore} from '../firebase/firestoreStore';
import {getFirestoreDb} from '../firebase/admin';
import {getNotificationReadState,applyNotificationReadState} from './notificationReadState';
import {getNotificationControls,notificationVisible} from './notificationVisibility';
import type {Notification} from '../../types';
/** Notification polling must see newly committed events across server instances. */
export async function getLiveUserNotifications(userId:string,limit=30):Promise<Notification[]>{
 try{
 const [rows,read,controls]=await Promise.all([getFirestoreDb().collection('notifications').where('userId','==',userId).orderBy('createdAt','desc').limit(Math.min(30,limit)).get(),getNotificationReadState(userId),getNotificationControls()]);
 const result=rows.docs.map(d=>{const v=d.data(),data=v.data||{};return {id:d.id,userId,type:v.type||'SYSTEM',title:v.title,message:v.message,broadcastId:v.broadcastId||data.broadcastId,entityType:v.entityType||data.entityType,entityId:v.entityId||data.entityId,fixtureId:v.fixtureId||data.fixtureId,isRead:!!v.isRead,createdAt:v.createdAt} as Notification;}).filter(n=>notificationVisible(n,controls));
 return applyNotificationReadState(result,read);
 }catch{return getUserNotificationsFirestore(userId,limit); }
}
