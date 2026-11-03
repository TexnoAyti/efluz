import {createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {BACKLOG_STATE_COLLECTION,backlogCompetitionEnabled,processLeagueBacklogReminders,reminderDay} from './leagueBacklogReminders';
export const BACKLOG_REQUESTS='competition_reminder_requests';
export type BacklogReminderScope={category:'ALL'|'LEAGUES'|'CUPS';competitionId?:string};

export async function requestBacklogReminders(scope:BacklogReminderScope,actorId:string){
  const db=getFirestoreDb();
  if(scope.competitionId){
    const d=await db.collection('competitions').doc(scope.competitionId).get();
    if(!d.exists||!backlogCompetitionEnabled({...d.data(),id:d.id}))throw Object.assign(Error('Musobaqa faol emas yoki topilmadi.'),{statusCode:409});
  }
  const id=createHash('sha256').update(JSON.stringify([reminderDay(),scope.category,scope.competitionId||''])).digest('hex');
  const ref=db.collection(BACKLOG_REQUESTS).doc(id);
  const result=await db.runTransaction(async tx=>{
    const old=await tx.get(ref);if(old.exists)return old.data()!;
    const row={scope,status:'PENDING',day:reminderDay(),actorId,createdAt:new Date().toISOString()};tx.set(ref,row);return row;
  });
  return {success:true,requestId:id,status:result.status,scope};
}
export async function processRequestedBacklogReminders(){
  const hour=new Date(Date.now()+5*3600000).getUTCHours();
  if(hour<9||hour>=21)return false;
  const db=getFirestoreDb(), rows=await db.collection(BACKLOG_REQUESTS).where('status','==','PENDING').limit(1).get();
  if(!rows.docs.length)return false;
  const request=rows.docs[0];
  const pending=await processLeagueBacklogReminders({requestId:request.id,scope:request.data().scope});
  const state=(await db.collection(BACKLOG_STATE_COLLECTION).doc('request-'+request.id).get()).data();
  if(state?.status==='DONE')await request.ref.update({status:'DONE',finishedAt:new Date().toISOString()});
  return pending||state?.status==='DONE';
}
