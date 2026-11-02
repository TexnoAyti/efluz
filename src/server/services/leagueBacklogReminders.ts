import {randomUUID} from 'node:crypto';
import {FieldPath} from 'firebase-admin/firestore';
import {getFirestoreDb} from '../firebase/admin';
import {getRuntimeStateStore} from '../readModel/runtimeStateStore';
import {filterRetiredFixtures} from './retiredFixtureService';
import {CURRENT_SEASON_ID, isSeasonCompetitionEnabled} from '../../lib/seasonParticipationPolicy';
import {enqueueSmartTelegramNotification} from './smartNotificationService';
import {telegramMiniAppButton} from './telegramMiniAppButton';
import {SEED_CLUBS} from '../db/seed';

export const BACKLOG_STATE_COLLECTION = 'league_reminder_workers';
export interface LeagueReminderGuard {competitionId: string; seasonId: string; day: string}
const html = (s: unknown) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const reminderDay = (now = Date.now()) => new Date(now + 5 * 3600000).toISOString().slice(0,10);
const enabled = (c: any) => c.type === 'LEAGUE' && !['completed','cancelled','archived','draft'].includes(String(c.status || '').toLowerCase()) && Number.isInteger(c.currentMatchday) && c.currentMatchday > 0 && c.currentMatchday <= 100 && isSeasonCompetitionEnabled(c.id,c.seasonId);

async function byIds(collection: string, ids: string[]) {
  const result = new Map<string, any>();
  for (let i=0;i<ids.length;i+=30) {
    const rows=await getFirestoreDb().collection(collection).where(FieldPath.documentId(),'in',ids.slice(i,i+30)).get();
    for (const doc of rows.docs) result.set(doc.id,doc.data());
  }
  return result;
}

/** Authoritative data only. Historical owner fields and fixture cache never authorize a recipient. */
export async function loadLeagueBacklog(competitionId: string, seasonId: string) {
  const db=getFirestoreDb(), doc=await db.collection('competitions').doc(competitionId).get();
  const competition={...doc.data(),id:doc.id} as any;
  if (!doc.exists || competition.seasonId !== seasonId || !enabled(competition)) return null;
  const rows=await db.collection('fixtures').where('competitionId','==',competitionId).where('seasonId','==',seasonId).get();
  const fixtures=filterRetiredFixtures(rows.docs.map(d=>({...d.data(),id:d.id}) as any),seasonId)
    .filter(f=>Number.isInteger(Number(f.matchday)) && Number(f.matchday)>0 && Number(f.matchday)<=competition.currentMatchday && ['SCHEDULED','PENDING_CONFIRMATION'].includes(f.status) && f.homeClubId && f.awayClubId && f.homeClubId!=='TBD' && f.awayClubId!=='TBD')
    .sort((a,b)=>Number(a.matchday)-Number(b.matchday)||a.id.localeCompare(b.id));
  const clubIds=[...new Set(fixtures.flatMap(f=>[f.homeClubId,f.awayClubId]))] as string[];
  const occupancies=await byIds('club_occupancies',clubIds.map(id=>`${seasonId}_${id}`));
  const owners=new Map<string,string>();
  for(const clubId of clubIds){const o=occupancies.get(`${seasonId}_${clubId}`);if(o?.status==='active' && o.userId)owners.set(clubId,o.userId);}
  const users=await byIds('users',[...new Set(owners.values())]);
  return {competition,fixtures,owners,users};
}

export function leagueBacklogMessage(data: NonNullable<Awaited<ReturnType<typeof loadLeagueBacklog>>>, userId: string) {
  const user=data.users.get(userId);
  if(!user || user.isSuspended || !user.telegramId)return null;
  const fixtures=data.fixtures.filter(f=>data.owners.get(f.homeClubId)===userId||data.owners.get(f.awayClubId)===userId);
  if(!fixtures.length)return null;
  // Domestic leagues have at most 38 games per player. Bound Telegram text/buttons
  // even for malformed or expanded calendars; the app always shows the full list.
  const lines: string[]=[], buttons: any[][]=[], contacts=new Set<string>();
  for(const f of fixtures.slice(0,19)){
    const opponentClub=data.owners.get(f.homeClubId)===userId?f.awayClubId:f.homeClubId;
    const opponent=data.users.get(data.owners.get(opponentClub)||'');
    const username=String(opponent?.username||'').replace(/^@+/,'');
    const validUsername=/^[A-Za-z0-9_]{5,32}$/.test(username)?username:'';
    const name=SEED_CLUBS.find(c=>c.id===opponentClub)?.name || opponentClub;
    const who=validUsername?`@${validUsername}`:opponent?[opponent.firstName,opponent.lastName].filter(Boolean).join(' ').slice(0,45)||'Guruhda admin orqali bog‘laning':'Klub egasi hali yo‘q';
    const line=`${Number(f.matchday)}-tur · <b>${html(String(name).slice(0,50))}</b> · ${html(who)}${f.status==='PENDING_CONFIRMATION'?' · ⏳ hisob tasdiqlanishi kutilmoqda':''}${Number(f.matchday)<data.competition.currentMatchday?' · eski tur: admin yordami':''}`;
    if(lines.join('\n').length+line.length>3000)break;
    lines.push(line);
    if(validUsername&&!contacts.has(validUsername)){contacts.add(validUsername);buttons.push([{text:`${Number(f.matchday)}-tur · @${validUsername}`,url:`https://t.me/${validUsername}`}]);}
  }
  buttons.push([{text:'💬 Raqibni topish / admin yordami',url:'https://t.me/efleagueuz'}],[telegramMiniAppButton('⚽ O‘yinlar va hisob yuborish')]);
  return {title:'⚽ O‘ynalmagan o‘yinlaringiz',body:`<b>${html(String(data.competition.name||data.competition.id).slice(0,80))}</b> · Joriy tur: ${data.competition.currentMatchday}\nSizda <b>${fixtures.length}</b> ta yakunlanmagan o‘yin bor.\n\n${lines.join('\n')}${fixtures.length>lines.length?'\nQolgan o‘yinlar ilovada.':''}\n\nRaqibga yozib vaqtni kelishing. Hisob allaqachon yuborilgan bo‘lsa, ilovada tasdiqlash holatini tekshiring. Eski tur hisobini topshirish uchun guruhdagi adminga tur raqami, raqib va hisobni yozing. Raqib topilmasa ham admin yordam beradi.`,replyMarkup:{inline_keyboard:buttons}};
}

/** Rebuild immediately before dispatch: scores, transfers, suspensions and withdrawn leagues can change while queued. */
export async function freshLeagueReminder(guard: LeagueReminderGuard,userId: string){
  if(guard.day!==reminderDay())return null;
  const data=await loadLeagueBacklog(guard.competitionId,guard.seasonId);
  return data?leagueBacklogMessage(data,userId):null;
}

/** Daily, resumable digest: one message per player/league/day, never seven separate game messages.
 * Only explicit authenticated workers call this; ordinary page reads do not. */
export async function processLeagueBacklogReminders(options: {now?:number; deadline?:number; enqueue?:typeof enqueueSmartTelegramNotification}={}) {
  if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER!=='supabase'||process.env.SUPABASE_DATA_NAMESPACE!=='production')return false;
  const hour=new Date((options.now??Date.now())+5*3600000).getUTCHours();
  if(hour<9 || hour>=21)return false;
  const store=getRuntimeStateStore();if(!store)throw Error('LEAGUE_REMINDER_STORAGE_UNAVAILABLE');
  const token=randomUUID(),lock='efluz:v1:league-backlog-worker';
  if(!await store.set(lock,token,{nx:true,ex:120}))return false;
  const db=getFirestoreDb(),ref=db.collection(BACKLOG_STATE_COLLECTION).doc(CURRENT_SEASON_ID),started=Date.now();
  let state:any;
  try{
    const day=reminderDay(options.now),saved=(await ref.get()).data();
    state=saved?.day===day?saved:{day,completed:[],cursors:{},queued:0,skipped:0,status:'PENDING'};
    if(state.status==='DONE')return false;
    const rows=await db.collection('competitions').where('seasonId','==',CURRENT_SEASON_ID).get();
    const competitions=rows.docs.map(d=>({...d.data(),id:d.id})).filter(enabled).sort((a,b)=>a.id.localeCompare(b.id));
    const competition=competitions.find(c=>!state.completed.includes(c.id));
    if(!competition){await ref.set({...state,status:'DONE',finishedAt:new Date().toISOString(),lastError:null});return false;}
    const data=await loadLeagueBacklog(competition.id,CURRENT_SEASON_ID);
    if(data){
      const ids=[...new Set(data.owners.values())].sort().filter(id=>id>(state.cursors[competition.id]||''));
      let processed=0;
      for(const userId of ids){
        if(processed>=4 || processed>0 && Date.now()>(options.deadline??started+7000))return true;
        const message=leagueBacklogMessage(data,userId);
        if(message){
          const queued=await (options.enqueue||enqueueSmartTelegramNotification)({userId,seasonId:CURRENT_SEASON_ID,eventId:`matchday-open:backlog:${competition.id}:${day}`, ...message,deferDrain:true,leagueReminder:{competitionId:competition.id,seasonId:CURRENT_SEASON_ID,day}});
          if(queued)state.queued++;else state.skipped++;
        }
        state.cursors[competition.id]=userId;state.status='PENDING';state.lastError=null;state.updatedAt=new Date().toISOString();state.lastSliceMs=Date.now()-started;
        await ref.set(state);processed++;
      }
    }
    state.completed.push(competition.id);state.updatedAt=new Date().toISOString();state.lastSliceMs=Date.now()-started;
    await ref.set(state);return true;
  }catch(error){
    // Do not advance the failed recipient. Stable event IDs recover a lost checkpoint without duplicate messages.
    if(state)await ref.set({...state,status:'RETRY_PENDING',lastError:'LEAGUE_REMINDER_PREPARATION_FAILED',updatedAt:new Date().toISOString(),lastSliceMs:Date.now()-started}).catch(()=>{});
    console.warn('[LEAGUE_REMINDER_PREPARATION_FAILED]');throw error;
  }finally{await store.eval('EFL_STATE_RELEASE_V1',[lock],[token]).catch(()=>{});}
}
