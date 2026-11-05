import { waitUntil } from '@vercel/functions';
import { createAiTournamentReader } from './telegramAiDataService';
import { getTelegramAiConfig, PRIMARY_OWNER_TELEGRAM_ID } from './telegramAiConfigService';
import { getAiRedisClient } from './telegramAiDeadline';
import { aiOperationsKey } from './telegramAiObservability';
import {uMatchFinished} from '../../lib/uzeflifeLeague';
import {loadDailyReportOperations,type DailyReportOperations} from './telegramAiDailyReportSources';
import {withinAiDeadline} from './telegramAiDeadline';
import {telegramMiniAppButton} from './telegramMiniAppButton';
import { sendTelegramMessage } from './telegramBotService';

type Reader = (query: any) => Promise<any>;
export function tashkentReportDate(now = new Date()) {
  return new Date(now.getTime() + 5 * 3600000).toISOString().slice(0,10);
}
/** Bounded owner digest. Every count has a named source and a time window. */
export async function buildAiDailyReport(read?:Reader,options:{now?:Date;loadOperations?:(now:Date)=>Promise<DailyReportOperations>}={}) {
 const now=options.now||new Date(),end=now.getTime(),start=end-86400000;
 const signal=AbortSignal.timeout(15000);
 const reader=read||createAiTournamentReader(AbortSignal.timeout(12000)).read;
 let complete=true,stale=false;
 const load=async(dataset:string)=>{
  const rows:any[]=[];
  try{for(let offset=0;offset<6000;offset+=30){
   const page=await withinAiDeadline(signal,()=>reader({dataset,offset,limit:30}));
   if(page.error||!Array.isArray(page.data)){complete=false;break;}
   complete&&=page.complete===true;stale||=Boolean(page.stale);rows.push(...page.data);
   if(page.nextOffset===null)return rows;
   if(page.nextOffset!==offset+30||!page.data.length){complete=false;break;}
  }}catch{complete=false;}
  complete=false;return rows;
 };
 const operationsPromise=options.loadOperations?options.loadOperations(now):read?Promise.resolve({unavailable:[]} as DailyReportOperations):loadDailyReportOperations(now);
 const [competitions,rows,operationsResult]=await Promise.all([load('competitions'),load('fixtures'),withinAiDeadline(signal,()=>operationsPromise).catch(()=>({unavailable:['Qo‘shimcha manbalar']} as DailyReportOperations))]);
 const ops=operationsResult;
 const clean=(value:unknown,max=64)=>Array.from(String(value??'').replace(/[\r\n\t\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()).slice(0,max).join('');
 const timestamp=(value:unknown)=>typeof value==='string'?Date.parse(value):NaN;
 const recent=(value:unknown)=>timestamp(value)>start&&timestamp(value)<=end;
 const time=(date:Date)=>date.toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const unique=[...new Map(rows.filter(f=>typeof f.id==='string').map(f=>[f.id,f])).values()];
 const enabled=competitions.filter(c=>!c.hidden&&!['COMPLETED','CANCELLED','ARCHIVED','DRAFT','INACTIVE','UPCOMING'].includes(String(c.status||'').toUpperCase()));
 const byCompetition=new Map(enabled.map(c=>[c.id,c]));
 const finished=(f:any)=>['CONFIRMED','CANCELLED'].includes(f.status);
 const reached=(f:any)=>{const c=byCompetition.get(f.competitionId);return c&&Number(f.matchday)>0&&Number(f.matchday)<=Math.max(Number(c.currentMatchday)||0,Number(c.resultEntryThroughMatchday)||0,...(ops.locks||[]).filter(l=>l.competitionId===c.id&&timestamp(l.openedAt)<=end).map(l=>Number(l.matchday)||0));};
 const opened=unique.filter(f=>reached(f)&&!finished(f));
 const pending=unique.filter(f=>['PENDING_CONFIRMATION','AWAITING_RESULT'].includes(f.status)&&byCompetition.has(f.competitionId));
 const disputed=unique.filter(f=>f.status==='DISPUTED'&&byCompetition.has(f.competitionId));
 const unresolved=unique.filter(f=>byCompetition.has(f.competitionId)&&f.status==='CONFIRMED'&&Number.isInteger(f.homeScore)&&f.homeScore===f.awayScore&&!f.winnerClubId&&competitions.some(c=>c.id===f.competitionId&&['KNOCKOUT','SUPER_CUP','EUROPEAN_KNOCKOUT'].includes(c.type)));
 const active=opened.filter(f=>Number(byCompetition.get(f.competitionId)?.currentMatchday)===Number(f.matchday));
 const backlog=opened.filter(f=>Number(byCompetition.get(f.competitionId)?.currentMatchday)!==Number(f.matchday));
 const deadline=(f:any)=>timestamp(ops.deadlines?.find(d=>d.fixtureId===f.id)?.deadlineAt||ops.locks?.find(l=>l.competitionId===f.competitionId&&Number(l.matchday)===Number(f.matchday))?.expiresAt);
 const overdue=opened.filter(f=>deadline(f)<end),due=opened.filter(f=>deadline(f)>=end&&deadline(f)<=end+86400000);
 const played=unique.filter(f=>f.status==='CONFIRMED'&&recent(f.resultConfirmedAt));
 const goals=played.reduce((n,f)=>n+(Number.isInteger(f.homeScore)?f.homeScore:0)+(Number.isInteger(f.awayScore)?f.awayScore:0),0);
 const counts={active:active.length,pending:pending.length,disputed:disputed.length,unresolved:unresolved.length,backlog:backlog.length,overdue:overdue.length,due:due.length,confirmed24h:played.length};
 const parts=[`EFLUZ · ${tashkentReportDate(now)} · kunlik admin hisoboti`,`24 soat: ${time(new Date(start))} — ${time(now)} (Toshkent)`];
 if(!complete||stale)parts.push(`Diqqat: EFL ma’lumotlari ${!complete?'to‘liq emas':''}${!complete&&stale?', ':''}${stale?'eski nusxadan':''}. Sonlar mavjud nusxa bo‘yicha.`);
 if(ops.unavailable.length)parts.push(`O‘qilmadi: ${ops.unavailable.join(', ')}. Bu bo‘limlarda nol deb hisoblanmadi.`);
 const priorities:string[]=[];
 if(disputed.length+unresolved.length)priorities.push(`${disputed.length} bahsli o‘yin va ${unresolved.length} g‘olibsiz kubokni tekshiring.`);
 if(pending.length)priorities.push(`${pending.length} hisob tasdiq kutmoqda.`);
 if(overdue.length)priorities.push(`${overdue.length} o‘yinning muddati o‘tgan.`);
 if(backlog.length)priorities.push(`Oldin ochilgan turlarda ${backlog.length} yakunlanmagan o‘yin bor.`);
 const s=ops.uzeflife;
 let uPending=0,uDisputed=0,uOverdue=0;
 if(s){const eligible=s.matches.filter(m=>m.round<=s.round&&m.home&&m.away),unfinished=eligible.filter(m=>!uMatchFinished(m));uPending=unfinished.filter(m=>m.proposal).length;uDisputed=unfinished.filter(m=>m.dispute?.status==='open').length;uOverdue=unfinished.filter(m=>timestamp(m.deadlineAt)<end).length;
  if(uDisputed||uPending||uOverdue)priorities.push(`UZEFLIFE: ${uPending} tasdiq, ${uDisputed} e’tiroz, ${uOverdue} muddati o‘tgan o‘yin.`);
 }
 const delivery={sent:0,pending:0,failed:0,unknown:0,skipped:0,unknownOutstanding:0};
 if(ops.broadcasts)for(const b of ops.broadcasts)for(const r of b.recipients||[]){
  if(r.status==='SENT'&&recent(r.sentAt||b.createdAt))delivery.sent++;
  if(['PENDING','SENDING'].includes(r.status))delivery.pending++;
  if(r.status==='FAILED'&&String(r.error||'').includes('DELIVERY_UNKNOWN'))delivery.unknownOutstanding++;
  if(recent(b.createdAt)&&r.status==='FAILED'){if(String(r.error||'').includes('DELIVERY_UNKNOWN'))delivery.unknown++;else delivery.failed++;}
  if(recent(b.createdAt)&&r.status==='SKIPPED_NO_TELEGRAM')delivery.skipped++;
 }
 if(delivery.failed||delivery.unknownOutstanding)priorities.push(`Telegram: ${delivery.failed} yangi rad etilgan, ${delivery.unknownOutstanding} yetkazilishi noma’lum xabarni tekshiring.`);
 const channelState=(p:any)=>p.state==='sending'&&(!p.leaseUntil||p.leaseUntil<end)?'unverified':p.state;
 const channelIssues=ops.channelPosts?.filter(p=>['failed','unverified'].includes(channelState(p)))||[];
 if(channelIssues.length)priorities.push(`Kanal: ${channelIssues.length} turning yuborilishini tekshiring.`);
 parts.push(`BIRINCHI NAVBATDA\n${priorities.length?priorities.map((v,i)=>`${i+1}. ${v}`).join('\n'):!complete||stale||ops.unavailable.length?'Mavjud ma’lumotlar bilan to‘liq xulosa qilib bo‘lmaydi. O‘qilmagan manbalarni tekshiring.':'Shoshilinch muammo aniqlanmadi.'}`);
 parts.push(`EFL · so‘nggi 24 soat\nTasdiqlangan: ${played.length} ta o‘yin · Gollar: ${goals}\nHozir: ${active.length} joriy tur o‘yini qolgan · ${pending.length} tasdiq · ${disputed.length} bahsli · ${unresolved.length} g‘olibsiz kubok.\nOldingi turlar: ${backlog.length} o‘yin.${ops.locks?` Ma’lum muddatlar bo‘yicha o‘tgan: ${overdue.length}; 24 soatda tugaydi: ${due.length}.`:''}`);
 const leagueLines=enabled.filter(c=>c.type==='LEAGUE').slice(0,10).map(c=>{const games=unique.filter(f=>f.competitionId===c.id&&Number(f.matchday)===Number(c.currentMatchday));return `${clean(c.name,34)} · ${c.currentMatchday||'?'}-tur: ${games.filter(f=>f.status==='CONFIRMED').length}/${games.length} yakunlangan`;});
 if(leagueLines.length)parts.push(`LIGALAR\n${leagueLines.join('\n')}`);
 if(s){const round=s.matches.filter(m=>m.round===s.round&&m.home&&m.away),approved=s.participants.filter(p=>p.status==='approved');const linked=approved.filter(p=>!p.id.startsWith('uze-slot-')).length;
  parts.push(`UZEFLIFE · ${s.round}-tur\n${round.filter(uMatchFinished).length}/${round.length} yakunlangan · ${uPending} tasdiq · ${uDisputed} e’tiroz.\nOldingi turlarda ${s.matches.filter(m=>m.round<s.round&&m.home&&m.away&&!uMatchFinished(m)).length} o‘yin qolgan. Akkaunt ulagan: ${linked}/${approved.length}.`);
 }else if(ops.uzeflife===null)parts.push('UZEFLIFE · turnir hali yaratilmagan.');
 if(ops.teams){const live=ops.teams.filter(t=>t.status==='ACTIVE');const bouts=live.flatMap(t=>(t.fixtures||[]).filter(f=>f.round<=t.currentRound).flatMap(f=>f.bouts||[]));const event=ops.clasico;
  parts.push(`TEAMS · ${live.length} faol turnir\n${bouts.filter(b=>b.pendingResult).length} tasdiq · ${bouts.filter(b=>b.disputed).length} bahsli juftlik${event?`\nEl-Clasico: ${clean(event.status,20)} · ${(event.bouts||[]).filter(b=>b.homeScore!==null&&b.awayScore!==null).length}/${(event.bouts||[]).length} natija.`:'.'}`);
 }
 if(ops.broadcasts)parts.push(`TELEGRAM\n24 soatda yetkazilgan: ${delivery.sent} · Rad etilgan: ${delivery.failed} · Noma’lum: ${delivery.unknown} · Telegramsiz: ${delivery.skipped}.\nHozir kutilmoqda/yuborilmoqda: ${delivery.pending}; ochiq noma’lum: ${delivery.unknownOutstanding}. Noma’lum yetkazish avtomatik takrorlanmaydi.`);
 if(ops.channelPosts?.length)parts.push(`UZEFLIFE KANALI\n${[...ops.channelPosts].sort((a,b)=>b.round-a.round).slice(0,2).map(p=>`${p.round}-tur: ${p.sentPages||0}/${p.totalPages||'?'} rasm · ${({sent:'yuborilgan',pending:'navbatda',sending:'yuborilmoqda',failed:'to‘xtagan',unverified:'kanalni tekshirish kerak'} as any)[channelState(p)]||'holati noma’lum'}`).join('\n')}`);
 if(ops.users)parts.push(`FOYDALANUVCHILAR\nJami: ${ops.users.total} · 24 soatda yangi: ${ops.users.newUsers}.`);
 if(ops.payments){const payments=ops.payments.filter(p=>p.currency==='XTR'&&recent(p.paidAt));parts.push(`PREMIUM TO‘LOVLAR · 24 soat\n${payments.length} to‘lov · ${payments.reduce((n,p)=>n+(Number(p.amount)||0),0)} Stars. Faqat Telegram tasdiqlagan to‘lovlar.`);}
 const describe=(f:any)=>`${clean(f.home,28)} — ${clean(f.away,28)} · ${clean(f.competition,30)} · ${clean(f.roundName||f.matchday+'-tur',22)}`;
 const urgent=[...new Map([...disputed,...unresolved,...overdue.sort((a,b)=>deadline(a)-deadline(b)),...pending,...due.sort((a,b)=>deadline(a)-deadline(b))].map(f=>[f.id,f])).values()];
 if(urgent.length)parts.push(`TEKSHIRILADIGAN O‘YINLAR · ${urgent.length}\n${urgent.slice(0,4).map(describe).join('\n')}${urgent.length>4?'\nQolganlari admin panelda.':''}`);
 const footer='Admin panelda batafsil tekshiring. Hisobot natijalarni o‘zgartirmaydi.';
 // Keep whole sections; never cut a player name or hide the coverage warning.
 const kept:string[]=[];let omitted=0;
 for(const part of parts){if([...kept,part,footer].join('\n\n').length<=3650)kept.push(part);else omitted++;}
 if(omitted)kept.push(`${omitted} qo‘shimcha bo‘lim matn chegarasi sabab qisqartirildi. Batafsil: admin panel.`);
 return {text:[...kept,footer].join('\n\n'),complete,stale,counts,generatedAt:now.toISOString(),window:{from:new Date(start).toISOString(),to:now.toISOString()},unavailable:ops.unavailable};
}
/** At most one send attempt per local day, even after an uncertain Telegram timeout. */
export async function deliverAiDailyReport(now = new Date(), prepare = () => buildAiDailyReport(undefined,{now})) {
  if (Number(new Date(now.getTime()+5*3600000).toISOString().slice(11,13)) < 8) return {status:'before_report_time'};
  const {config,redisAvailable} = await getTelegramAiConfig();
  if (!redisAvailable || !config.dailyReportEnabled) return {status:'disabled_or_unavailable'};
  const client=getAiRedisClient(AbortSignal.timeout(12000)); if(!client)return {status:'state_unavailable'};
  const key=aiOperationsKey('daily-report',tashkentReportDate(now));
  if(await client.get(key))return {status:'already_attempted'};
  const report=await prepare();
  // A totally unavailable dataset should be retried by a later worker, not mailed as zero matches.
  if(!report.complete)return {status:'data_incomplete'};
  // Each phase receives a fresh deadline. Report reads and Telegram delivery
  // must not consume the deadline of the final durable receipt write.
  const state=()=>{const c=getAiRedisClient(AbortSignal.timeout(12000));if(!c)throw Error('DAILY_REPORT_STATE_UNAVAILABLE');return c;};
  if(!await state().set(key,{status:'sending',at:now.toISOString(),reportVersion:2},{nx:true,ex:172800}))return {status:'already_attempted'};
  try {
    const sent=await sendTelegramMessage(Number(PRIMARY_OWNER_TELEGRAM_ID),report.text,{parse_mode:null,reply_markup:{inline_keyboard:[[telegramMiniAppButton('Hisobotni tekshirish · EFLUZ')]]}});
    await state().set(key,{status:sent.ok?'sent':'unknown',at:now.toISOString(),reportVersion:2,generatedAt:report.generatedAt,counts:report.counts},{ex:172800});
    return {status:sent.ok?'sent':'unknown'};
  } catch {await state().set(key,{status:'unknown',at:now.toISOString(),reportVersion:2},{ex:172800});return {status:'unknown'};}
}
export function scheduleAiDailyReport() {
  const job=deliverAiDailyReport().catch(()=>console.warn('[AI_DAILY_REPORT_UNAVAILABLE]'));
  if(process.env.VERCEL==='1')waitUntil(job);
  return job;
}
