import type {Transaction} from 'firebase-admin/firestore';
import type {CustomTournament,CustomTournamentFixture,CustomTournamentParticipant} from '../../types/customTournament';
import {tournamentTelegramLink} from '../../lib/customTournamentLinks';
import {noticeGuard,noticeHash,writeCompetitionNotices,type CompetitionNotice} from './competitionNotices';
const url=(t:CustomTournament)=>tournamentTelegramLink(t.id,t.inviteToken);
export function writeCustomRegistration(tx:Transaction,t:CustomTournament,userId:string,label:string,body:string,key:string){
 writeCompetitionNotices(tx,'custom-registration:'+key,[...new Set([userId,t.organizerUserId])].map(id=>({userId:id,title:t.name+' · '+label,body,url:url(t),entityType:'custom-tournament',entityId:url(t)})));
}
export function writeCustomLifecycleNotices(tx:Transaction,before:CustomTournament,after:CustomTournament,oldFixtures:CustomTournamentFixture[],fixtures:CustomTournamentFixture[],players:CustomTournamentParticipant[]){
 const notices:CompetitionNotice[]=[],admins=[after.organizerUserId,...after.assistantAdminIds];
 const add=(ids:(string|undefined)[],title:string,body:string,f?:CustomTournamentFixture)=>{for(const userId of new Set(ids.filter((id):id is string=>!!id))){const roleGuards=admins.includes(userId)&&!players.some(p=>p.userId===userId&&p.status==='REGISTERED')&&![f?.homeUserId,f?.awayUserId].includes(userId)?[noticeGuard('custom_tournaments',after.id,['organizerUserId','assistantAdminIds'],after)]:[];notices.push({userId,title:after.name+' · '+title,body,url:url(after),entityType:'custom-tournament',entityId:url(after),...(f?{guard:noticeGuard('custom_tournament_fixtures',f.id,['homeUserId','awayUserId','status','homeScore','awayScore','penaltyHomeScore','penaltyAwayScore'],f),guards:[noticeGuard('custom_tournaments',after.id,['cancelledAt'],after),...roleGuards]}:{guard:noticeGuard('custom_tournaments',after.id,['status','winnerClubId'],after),guards:roleGuards})});}};
 if(before.status!=='IN_PROGRESS'&&after.status==='IN_PROGRESS')add([...players.filter(p=>p.status==='REGISTERED').map(p=>p.userId),...admins],'Turnir boshlandi','Taqvim tayyor. O‘yinlaringiz va muddatlarni turnir sahifasida tekshiring.');
 const previousFixtures=new Map(oldFixtures.map(f=>[f.id,f]));
 for(const f of fixtures){
  const old=previousFixtures.get(f.id),label=`${f.homeClubName} — ${f.awayClubName}`,ready=f.homeUserId&&f.awayUserId&&!['BYE','TBD'].includes(f.homeClubId)&&!['BYE','TBD'].includes(f.awayClubId);
  if(!ready)continue;
  if(f.status==='SCHEDULED'&&((old&&(old.homeUserId!==f.homeUserId||old.awayUserId!==f.awayUserId))||(!old&&(f.roundOrMatchday===1||before.status==='IN_PROGRESS'))))for(const id of [f.homeUserId,f.awayUserId])add([id],'Raqibingiz aniqlandi',`${label}\nRaqibingiz: ${id===f.homeUserId?f.awayClubName:f.homeClubName}.\nMuddat: ${new Date(f.deadlineAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}`,f);
  if(noticeHash([old?.status,old?.homeScore,old?.awayScore,old?.penaltyHomeScore,old?.penaltyAwayScore])!==noticeHash([f.status,f.homeScore,f.awayScore,f.penaltyHomeScore,f.penaltyAwayScore])){
   const score=`${f.homeClubName} ${f.homeScore??'—'}:${f.awayScore??'—'} ${f.awayClubName}${f.penaltyHomeScore!=null?' · penaltilar '+f.penaltyHomeScore+':'+f.penaltyAwayScore:''}`;
   if(f.status==='PENDING_CONFIRMATION')add([f.submittedByUserId===f.homeUserId?f.awayUserId:f.homeUserId,...admins],'Hisob tasdiq kutmoqda',score+'\nNatijani tekshiring va tasdiqlang.',f);
   if(f.status==='DISPUTED')add([f.homeUserId,f.awayUserId,...admins],'Natijaga e’tiroz',score+'\nAdmin tekshirishi kerak.',f);
   if(f.status==='CONFIRMED')add([f.homeUserId,f.awayUserId,...admins],old?.status==='CONFIRMED'?'Natija tuzatildi':'Natija tasdiqlandi',score,f);
  }
 }
 if(after.status==='COMPLETED'&&(before.status!=='COMPLETED'||before.winnerClubId!==after.winnerClubId))add([...players.map(p=>p.userId),...admins],'Turnir yakunlandi',`Chempion: ${after.winnerClubName||'Yakuniy jadvalni ko‘ring'}. Natijalar tarixda saqlandi.`);
 if(after.status==='CANCELLED'&&before.status!=='CANCELLED')add([...players.map(p=>p.userId),...admins],'Turnir bekor qilindi','Tashkilotchi turnirni bekor qildi.');
 writeCompetitionNotices(tx,'custom:'+after.id+':'+noticeHash([after.updatedAt,notices]),notices);return notices;
}

/** Existing worker wakes on requests/continuations and its configured cron.
 * Only recent due fixtures are read; no unbounded tournament/fixture scan. */
export async function sweepCustomCompetitionDeadlines(now=Date.now()){
 const {getFirestoreDb}=await import('../firebase/admin');const db=getFirestoreDb();
 const checkpoint=db.collection('competition_notification_worker').doc('deadlines'),progress=(await checkpoint.get()).data();if(Number(progress?.nextAt||0)>now)return false;
 let query=db.collection('custom_tournament_fixtures').where('status','in',['SCHEDULED','PENDING_CONFIRMATION']).where('deadlineAt','>=',new Date(now-86400000).toISOString()).where('deadlineAt','<=',new Date(now+86400000).toISOString()).orderBy('deadlineAt','asc').limit(40);
 if(progress?.cursor){const cursor=await db.collection('custom_tournament_fixtures').doc(progress.cursor).get();if(cursor.exists)query=query.startAfter(cursor);}
 const rows=await query.get();
 const tournaments=new Map<string,CustomTournament|undefined>();
 const stopAt=Date.now()+5000;let processed=0,lastId:string|null=null;
 for(const row of rows.docs){if(Date.now()>=stopAt)break;lastId=row.id;processed++;const fixture=row.data() as CustomTournamentFixture;if(!fixture.homeUserId||!fixture.awayUserId)continue;
  if(!tournaments.has(fixture.tournamentId))tournaments.set(fixture.tournamentId,(await db.collection('custom_tournaments').doc(fixture.tournamentId).get()).data() as CustomTournament|undefined);
  const t=tournaments.get(fixture.tournamentId);if(!t||t.status!=='IN_PROGRESS')continue;
  const overdue=Date.parse(fixture.deadlineAt)<=now,key='custom-deadline:'+fixture.id+':'+fixture.deadlineAt+':'+(overdue?'overdue':'reminder'),ref=db.collection('competition_notification_intents').doc(noticeHash([key,0]));
  await db.runTransaction(async tx=>{
   const [prior,current,parent]=await Promise.all([tx.get(ref),tx.get(row.ref),tx.get(db.collection('custom_tournaments').doc(t.id))]);
   if(prior.exists||noticeHash(current.data())!==noticeHash(fixture)||parent.data()?.status!=='IN_PROGRESS')return;
   const ids=fixture.status==='PENDING_CONFIRMATION'?[fixture.submittedByUserId===fixture.homeUserId?fixture.awayUserId:fixture.homeUserId]:[fixture.homeUserId,fixture.awayUserId];
   writeCompetitionNotices(tx,key,ids.map(userId=>({userId:userId!,title:t.name+(overdue?' · O‘yin muddati tugadi':' · O‘yin eslatmasi'),body:`${fixture.homeClubName} — ${fixture.awayClubName}\nMuddat: ${new Date(fixture.deadlineAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}\n${fixture.status==='PENDING_CONFIRMATION'?'Hisob tasdig‘ingizni kutmoqda.':overdue?'Raqib yoki tashkilotchi bilan bog‘laning.':'Hisobni o‘z vaqtida yuboring.'}`,url:url(t),entityType:'custom-tournament',entityId:url(t),...(overdue?{}:{expiresAt:Date.parse(fixture.deadlineAt)}),guard:noticeGuard('custom_tournament_fixtures',fixture.id,['status','deadlineAt','homeUserId','awayUserId'],fixture),guards:[noticeGuard('custom_tournaments',t.id,['status'],t)]})));
  });
 }
 const pending=processed<rows.size||rows.size===40;await checkpoint.set({cursor:pending?lastId:null,nextAt:pending?0:now+300000});return pending;
}
