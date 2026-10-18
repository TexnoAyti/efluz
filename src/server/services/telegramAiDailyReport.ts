import { waitUntil } from '@vercel/functions';
import { createAiTournamentReader } from './telegramAiDataService';
import { getTelegramAiConfig, PRIMARY_OWNER_TELEGRAM_ID } from './telegramAiConfigService';
import { getAiRedisClient } from './telegramAiDeadline';
import { aiOperationsKey } from './telegramAiObservability';
import { sendTelegramMessage } from './telegramBotService';

type Reader = (query: any) => Promise<any>;
export function tashkentReportDate(now = new Date()) {
  return new Date(now.getTime() + 5 * 3600000).toISOString().slice(0,10);
}
/** Snapshot-based, bounded report. Missing/stale coverage is explicitly disclosed. No model or writes. */
export async function buildAiDailyReport(read: Reader = createAiTournamentReader(AbortSignal.timeout(10000)).read) {
  const rows: any[] = [];
  let complete = true, stale = false;
  const load = async (dataset: string) => {
    const data: any[] = [];
    for (let offset = 0; offset < 6000; offset += 30) {
      const page = await read({dataset,offset,limit:30});
      if (page.error || !Array.isArray(page.data)) {complete=false;break;}
      complete &&= page.complete === true; stale ||= Boolean(page.stale);
      data.push(...page.data);
      if (page.nextOffset === null) return data;
      if (page.nextOffset !== offset + 30 || !page.data.length) {complete=false;break;}
    }
    complete=false; return data;
  };
  const competitions = await load('competitions'); rows.push(...await load('fixtures'));
  const unique = [...new Map(rows.map(f => [f.id,f])).values()];
  const pending = unique.filter(f => ['PENDING_CONFIRMATION','AWAITING_RESULT'].includes(f.status));
  const disputed = unique.filter(f => f.status === 'DISPUTED');
  const unresolved = unique.filter(f => f.status === 'CONFIRMED' && f.homeScore === f.awayScore && !f.winnerClubId &&
    competitions.some(c => c.id === f.competitionId && ['KNOCKOUT','SUPER_CUP'].includes(c.type)));
  const active = unique.filter(f => !['CONFIRMED','CANCELLED'].includes(f.status) && competitions.some(c => c.id===f.competitionId && c.currentMatchday===f.matchday));
  const describe = (f: any) => `${f.home} — ${f.away} · ${f.competition} · ${f.roundName || f.matchday+'-tur'}`;
  const section = (name: string, list: any[]) => `${name}: ${list.length}\n${list.slice(0,5).map(describe).join('\n')}${list.length>5?'\nQolganini admin panelda ko‘ring.':''}`;
  const text = `EFL UZ · ${tashkentReportDate()} kunlik admin hisoboti\n${!complete || stale ? 'Diqqat: ma’lumotlar '+(!complete?'to‘liq emas':'')+(!complete&&stale?', ':'')+(stale?'eski nusxadan':'')+'. Bu sonlar joriy bazaning to‘liq tekshiruvi emas.\n' : ''}\n${section('Joriy turlardagi yakunlanmagan o‘yinlar',active)}\n\n${section('Natija/tasdiq kutilmoqda',pending)}\n\n${section('Bahsli o‘yinlar',disputed)}\n\n${section('G‘olibi aniqlanmagan durang kuboklar',unresolved)}\n\nHisobot faqat ma’lumot beradi; natijalar o‘zgartirilmadi.`;
  return {text:Array.from(text).slice(0,3800).join(''),complete,stale,counts:{active:active.length,pending:pending.length,disputed:disputed.length,unresolved:unresolved.length}};
}
/** At most one send attempt per local day, even after an uncertain Telegram timeout. */
export async function deliverAiDailyReport(now = new Date(), prepare = buildAiDailyReport) {
  if (Number(new Date(now.getTime()+5*3600000).toISOString().slice(11,13)) < 8) return {status:'before_report_time'};
  const {config,redisAvailable} = await getTelegramAiConfig();
  if (!redisAvailable || !config.dailyReportEnabled) return {status:'disabled_or_unavailable'};
  const client=getAiRedisClient(AbortSignal.timeout(12000)); if(!client)return {status:'state_unavailable'};
  const key=aiOperationsKey('daily-report',tashkentReportDate(now));
  if(await client.get(key))return {status:'already_attempted'};
  const report=await prepare();
  // A totally unavailable dataset should be retried by a later worker, not mailed as zero matches.
  if(!report.complete)return {status:'data_incomplete'};
  if(!await client.set(key,{status:'sending',at:now.toISOString()},{nx:true,ex:172800}))return {status:'already_attempted'};
  try {
    const sent=await sendTelegramMessage(Number(PRIMARY_OWNER_TELEGRAM_ID),report.text,{parse_mode:null});
    await client.set(key,{status:sent.ok?'sent':'unknown',at:now.toISOString()},{ex:172800});
    return {status:sent.ok?'sent':'unknown'};
  } catch {await client.set(key,{status:'unknown',at:now.toISOString()},{ex:172800});return {status:'unknown'};}
}
export function scheduleAiDailyReport() {
  const job=deliverAiDailyReport().catch(()=>console.warn('[AI_DAILY_REPORT_UNAVAILABLE]'));
  if(process.env.VERCEL==='1')waitUntil(job);
  return job;
}
