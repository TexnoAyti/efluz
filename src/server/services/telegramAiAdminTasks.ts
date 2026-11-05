import type {AdminTask,AdminTaskGroup,AdminTaskPriority} from '../../types/adminTasks';
import type {DailyReportOperations} from './telegramAiDailyReportSources';
import {uMatchFinished,isULeague} from '../../lib/uzeflifeLeague';
import {uzeflifeMatchLink} from '../../lib/uzeflifeLinks';
import {teamTournamentTelegramLink} from '../../lib/teamNavigation';
import {CLASICO_SIDE_SIZE} from '../../types/elClasico';

export const ADMIN_TASK_CATALOG:Array<{kind:string;group:AdminTaskGroup;name:string}>=[
 ['result_dispute','EFL','Bahsli hisobni tekshirish'],['cup_winner','EFL','Kubok g‘olibini aniqlash'],['result_review','EFL','Hisobni ko‘rib chiqish'],['match_overdue','EFL','Muddati o‘tgan o‘yin'],['match_due','EFL','Yaqinlashayotgan muddat'],['round_backlog','EFL','Oldingi tur o‘yinlari'],['round_ready','EFL','Keyingi turni ko‘rib chiqish'],['season_review','EFL','Mavsum yakunini tekshirish'],['round_deadline','EFL','Tur muddatini belgilash'],['competition_paused','EFL','Pauzadagi turnir'],
 ['uze_dispute','UZEFLIFE','E’tirozni tekshirish'],['uze_review','UZEFLIFE','Hisobni ko‘rib chiqish'],['uze_overdue','UZEFLIFE','Muddati o‘tgan o‘yin'],['uze_due','UZEFLIFE','Yaqinlashayotgan muddat'],['uze_backlog','UZEFLIFE','Oldingi turdagi o‘yinlar'],['uze_link','UZEFLIFE','Akkauntlarni ulash'],['uze_next','UZEFLIFE','Keyingi tur'],['uze_complete','UZEFLIFE','Turnir yakuni'],['uze_deadline','UZEFLIFE','O‘yin muddatini belgilash'],
 ['team_dispute','TEAMS','Juftlik e’tirozi'],['team_review','TEAMS','Juftlik hisobini ko‘rib chiqish'],['team_lineup','TEAMS','Tarkibni topshirish'],['team_next','TEAMS','Keyingi jamoaviy tur'],['clasico_review','TEAMS','El-Clasico natijasi'],['clasico_start','TEAMS','El-Clasico startini tekshirish'],
 ['delivery_unknown','TELEGRAM','Yetkazilishi noma’lum xabar'],['delivery_failed','TELEGRAM','Rad etilgan xabar'],['delivery_stalled','TELEGRAM','Uzoq kutilayotgan xabar'],['telegram_link','TELEGRAM','Telegram aloqasini tiklash'],['channel_missing','TELEGRAM','Tur e’lonini tayyorlash'],['channel_check','TELEGRAM','Kanal yuborishini tekshirish'],['channel_stalled','TELEGRAM','To‘xtab qolgan e’lon'],['source_unavailable','SYSTEM','O‘qilmagan manbani tekshirish'],['source_stale','SYSTEM','Eski yoki qisman ma’lumotni yangilash'],
].map(([kind,group,name])=>({kind,group:group as AdminTaskGroup,name}));
const catalog=new Map(ADMIN_TASK_CATALOG.map(c=>[c.kind,c]));
const text=(value:unknown,max=90)=>Array.from(String(value??'').replace(/[\u0000-\u001f\u007f\s]+/g,' ').trim()).slice(0,max).join('');
const date=(value:unknown)=>typeof value==='string'?Date.parse(value):NaN;
const rank:Record<AdminTaskPriority,number>={URGENT:0,HIGH:1,NORMAL:2};

/** Read-only suggestions, derived again on every refresh. No task is an execution authorization. */
export function buildAdminTasks(input:{competitions:any[];fixtures:any[];operations:DailyReportOperations;now:Date;complete:boolean;stale:boolean}):AdminTask[]{
 const {competitions,operations:ops}=input,now=input.now.getTime(),fresh=input.complete&&!input.stale,items=new Map<string,AdminTask>();
 const add=(kind:string,entity:string,priority:AdminTaskPriority,title:string,reason:string,nextStep:string,where:string,extra:Partial<AdminTask>={})=>{const definition=catalog.get(kind)!;const id=kind+':'+entity;items.set(id,{id,kind,group:definition.group,priority,title:text(title,110),reason:text(reason,220),nextStep:text(nextStep,240),where,verified:fresh,...extra});};
 const active=competitions.filter(c=>!c.hidden&&!['completed','cancelled','archived','draft','inactive','upcoming'].includes(String(c.status||'').toLowerCase()));
 const fixtures=[...new Map(input.fixtures.map(f=>[f.id,f])).values()];
 for(const c of active){
  const all=fixtures.filter(f=>f.competitionId===c.id),round=Number(c.currentMatchday)||0;
  const through=Math.max(round,Number(c.resultEntryThroughMatchday)||0,...(ops.locks||[]).filter(l=>l.competitionId===c.id&&date(l.openedAt)<=now).map(l=>Number(l.matchday)||0));
  const opened=all.filter(f=>f.matchday>0&&f.matchday<=through),unfinished=opened.filter(f=>!['CONFIRMED','CANCELLED'].includes(f.status));
  const current=all.filter(f=>Number(f.matchday)===round),label=text(c.name||c.id,42);
  if(String(c.status).toLowerCase()==='paused')add('competition_paused',c.id,'NORMAL',label+' pauzada','Turnir pauzaga qo‘yilgan.','Pauza sababini tekshirib, davom ettirish vaqtini belgilang.','Admin → Ligalar');
  for(const f of opened){const pair=`${text(f.home,28)} — ${text(f.away,28)} · ${label} · ${f.matchday}-tur`;
   const deadline=ops.deadlines?.find(d=>d.fixtureId===f.id)?.deadlineAt||ops.locks?.find(l=>l.competitionId===c.id&&Number(l.matchday)===Number(f.matchday))?.expiresAt;
   if(f.status==='DISPUTED')add('result_dispute',f.id,'URGENT',pair,'Hisob bo‘yicha kelishmovchilik bor.','Dalillar va ikkala tomon hisobini tekshirib, bahsni hal qiling.','Admin → Bahslar');
   else if(['PENDING_CONFIRMATION','AWAITING_RESULT'].includes(f.status))add('result_review',f.id,date(f.updatedAt)<now-86400000?'HIGH':'NORMAL',pair,'Hisob tasdiq kutmoqda.','Topshirilgan natija va dalilni tekshirib tasdiqlang yoki sabab bilan rad eting.','Admin → Natijalar');
   else if(!['CONFIRMED','CANCELLED'].includes(f.status)&&date(deadline)<now)add('match_overdue',f.id,'HIGH',pair,'Natija kiritish muddati o‘tgan.','Raqiblar bilan holatni tekshiring; o‘ynash yoki ko‘chirish bo‘yicha qaror qiling.','Admin → O‘yinlar',{dueAt:deadline});
   else if(!['CONFIRMED','CANCELLED'].includes(f.status)&&date(deadline)>=now&&date(deadline)<=now+86400000)add('match_due',f.id,date(deadline)<=now+10800000?'HIGH':'NORMAL',pair,'O‘yin muddati 24 soat ichida tugaydi.','Raqiblar bog‘langanini va eslatma yetkazilganini tekshiring.','Admin → O‘yinlar',{dueAt:deadline});
   if(f.status==='CONFIRMED'&&Number.isInteger(f.homeScore)&&f.homeScore===f.awayScore&&!f.winnerClubId&&['KNOCKOUT','SUPER_CUP','EUROPEAN_KNOCKOUT'].includes(c.type))add('cup_winner',f.id,'URGENT',pair,'Kubok o‘yini durang, g‘olib belgilanmagan.','Qo‘shimcha vaqt yoki penaltilar hisobini tekshirib, g‘olibni belgilang.','Admin → Kuboklar');
  }
  for(const oldRound of new Set(unfinished.filter(f=>f.matchday!==round).map(f=>f.matchday))){const count=unfinished.filter(f=>f.matchday===oldRound).length;add('round_backlog',c.id+':'+oldRound,'HIGH',`${label} · ${oldRound}-turdan ${count} o‘yin`, 'Oldin ochilgan turdagi natijalar yakunlanmagan.','Qolgan juftliklarni ko‘rib chiqing; har bir o‘yinning holatini aniqlang.','Admin → O‘yinlar');}
  if(fresh&&current.length&&current.every(f=>f.status==='CONFIRMED'&&(!['KNOCKOUT','SUPER_CUP','EUROPEAN_KNOCKOUT'].includes(c.type)||f.homeScore!==f.awayScore||!!f.winnerClubId))&&String(c.status).toLowerCase()==='active'){
   if(round<Number(c.totalMatchdays))add('round_ready',c.id,'NORMAL',label+' · keyingi tur','Joriy turning barcha o‘yinlari tasdiqlangan.','Jadval va muddatni tekshirib, keyingi turni ochishni ko‘rib chiqing.','Admin → Tur boshqaruvi');
   else if(Number(c.totalMatchdays)>0&&all.every(f=>['CONFIRMED','CANCELLED'].includes(f.status)))add('season_review',c.id,'NORMAL',label+' · yakuniy tekshiruv','Rejadagi turlar yakunlangan.','Yakuniy jadval, g‘olib va saralash joylarini tekshiring.','Admin → Mavsum');
  }
  if(fresh&&ops.locks&&ops.deadlines&&current.some(f=>!['CONFIRMED','CANCELLED'].includes(f.status))&&!current.some(f=>date(ops.deadlines!.find(d=>d.fixtureId===f.id)?.deadlineAt||ops.locks!.find(l=>l.competitionId===c.id&&Number(l.matchday)===round)?.expiresAt)>0))add('round_deadline',c.id,'NORMAL',label+' · tur muddati','Joriy tur uchun ma’lum muddat belgilanmagan.','Tur boshqaruvida muddatni belgilang.','Admin → Tur boshqaruvi');
 }
 const s=ops.uzeflife;
 if(s&&['playing','paused'].includes(s.status)){
  const current=s.matches.filter(m=>m.round===s.round&&m.home&&m.away),opened=s.matches.filter(m=>m.round<=s.round&&m.home&&m.away),unfinished=opened.filter(m=>!uMatchFinished(m));
  for(const m of unfinished){const name=(id:string|null)=>text(s.participants.find(p=>p.id===id)?.name||'Ishtirokchi',28);const pair=`${name(m.home)} — ${name(m.away)} · ${m.round}-tur`;let url:string|undefined;try{url=uzeflifeMatchLink(m.id);}catch{}
   const extra={verified:true,...(url?{url}:{})};
   if(m.dispute?.status==='open')add('uze_dispute',m.id,'URGENT',pair,'Natijaga e’tiroz ochilgan.','Dalilni tekshirib, e’tirozni hal qiling.','UZEFLIFE → Natijalar',extra);
   else if(m.proposal)add('uze_review',m.id,'HIGH',pair,'Hisob tasdiq kutmoqda.','Raqib tasdig‘i yoki admin tekshiruvini yakunlang.','UZEFLIFE → O‘yin',extra);
   else if(date(m.deadlineAt)<now)add('uze_overdue',m.id,'HIGH',pair,'O‘yin muddati o‘tgan.','Raqiblar bilan holatni aniqlab, natija yoki yangi muddatni belgilang.','UZEFLIFE → O‘yin',{...extra,dueAt:m.deadlineAt});
   else if(date(m.deadlineAt)<=now+86400000)add('uze_due',m.id,date(m.deadlineAt)<=now+10800000?'HIGH':'NORMAL',pair,'Muddat 24 soat ichida tugaydi.','Raqib bilan bog‘lanish va hisob topshirishni eslating.','UZEFLIFE → O‘yin',{...extra,dueAt:m.deadlineAt});
  }
  for(const round of new Set(unfinished.filter(m=>m.round<s.round).map(m=>m.round)))add('uze_backlog',String(round),'HIGH',`UZEFLIFE · ${round}-tur`,`${unfinished.filter(m=>m.round===round).length} o‘yin yakunlanmagan.`, 'Oldingi tur o‘yinlarining holatini tekshiring.','UZEFLIFE → O‘yinlar',{verified:true});
  const unlinked=s.participants.filter(p=>p.status==='approved'&&p.id.startsWith('uze-slot-')).length;
  if(unlinked)add('uze_link','accounts','NORMAL',`${unlinked} ishtirokchi akkauntini ulashi kerak`,'Username ro‘yxatda bor, lekin ilova akkaunti hali ulanmagan.','Ishtirokchilarni o‘z username’i bilan botga kirishga yo‘naltiring.','UZEFLIFE → Ishtirokchilar',{verified:true});
  if(current.some(m=>!uMatchFinished(m)&&!m.deadlineAt))add('uze_deadline',String(s.round),'NORMAL','UZEFLIFE · tur muddatlarini tekshirish','Joriy turda muddatsiz o‘yinlar bor.','Jadvalda o‘yin muddatlarini belgilang.','UZEFLIFE → Jadval',{verified:true});
  const last=isULeague(s)?15:8;
  if(current.length&&current.every(m=>uMatchFinished(m)&&!m.proposal&&m.dispute?.status!=='open'&&(isULeague(s)||!!m.winner))&&s.status==='playing'){
   if(s.round<last)add('uze_next',String(s.round),'NORMAL','UZEFLIFE · keyingi tur','Joriy tur natijalari yakunlangan.','Qolgan eski o‘yinlar va jadvalni tekshirib, keyingi turni ochishni ko‘rib chiqing.','UZEFLIFE → Boshqaruv',{verified:true});
   else if(!unfinished.length)add('uze_complete',String(s.round),'NORMAL','UZEFLIFE · turnir yakuni','Ochilgan o‘yinlarning natijalari yakunlangan.','Yakuniy jadval va chempionni tekshirib, turnirni yakunlang.','UZEFLIFE → Boshqaruv',{verified:true});
  }
  if(isULeague(s)&&ops.channelPosts&&!ops.channelPosts.some(p=>p.round===s.round))add('channel_missing',String(s.round),'NORMAL',`UZEFLIFE · ${s.round}-tur e’loni`,'Kanalga yuborish qaydi hali yo‘q.','Tur rasmlari va e’lonni ko‘rib, kanalga yuboring.','UZEFLIFE → Xabar yuborish',{verified:true});
 }
 for(const t of ops.teams||[]){if(t.status!=='ACTIVE')continue;const current=(t.fixtures||[]).filter(f=>f.round===t.currentRound);
  for(const f of (t.fixtures||[]).filter(f=>f.round<=t.currentRound)){let url:string|undefined;try{url=teamTournamentTelegramLink(t.id,f.id);}catch{}const extra={verified:true,...(url?{url}:{})},label=text(t.name,42);
   for(const b of f.bouts||[]){if(b.disputed)add('team_dispute',t.id+':'+f.id+':'+b.id,'URGENT',label+' · bahsli juftlik','Juftlik hisobida e’tiroz bor.','Ikki tomon dalillarini tekshiring.','TEAMS → O‘yin',extra);else if(b.pendingResult)add('team_review',t.id+':'+f.id+':'+b.id,'HIGH',label+' · natija tasdig‘i','Juftlik natijasi tasdiq kutmoqda.','Raqib yoki turnir admini natijani tekshirsin.','TEAMS → O‘yin',extra);}
   if(f.round===t.currentRound&&(!f.homeLineup||!f.awayLineup))add('team_lineup',t.id+':'+f.id,'NORMAL',label+' · tarkiblar','Joriy juftlikning bir yoki ikkala tarkibi topshirilmagan.','Jamoa sardorlari tarkibni kiritsin.','TEAMS → Tarkib',extra);
  }
  if(current.length&&current.every(f=>f.bouts?.length&&f.bouts.every(b=>Number.isInteger(b.homeScore)&&Number.isInteger(b.awayScore)&&b.homeScore>=0&&b.awayScore>=0&&!b.pendingResult&&!b.disputed))&&t.currentRound<t.totalRounds)add('team_next',t.id,'NORMAL',text(t.name)+' · keyingi tur','Joriy tur juftliklari yakunlangan.','Turnir boshqaruvida keyingi tur holatini tekshiring.','TEAMS → Boshqaruv',{verified:true});
 }
 const event=ops.clasico;
 if(event&&event.status==='ACTIVE')for(const b of event.bouts||[])if(b.disputed||b.pendingResult)add('clasico_review',String(b.id),b.disputed?'URGENT':'HIGH','El-Clasico · '+b.id+'-juftlik',b.disputed?'Hisob bo‘yicha e’tiroz bor.':'Hisob tasdiq kutmoqda.','Event sahifasida dalil va hisobni tekshiring.','TEAMS → El-Clasico',{verified:true});
 if(event?.status==='REGISTRATION'&&['REAL','BARCA'].every(side=>(event.players||[]).filter(p=>p.side===side).length===CLASICO_SIDE_SIZE))add('clasico_start','event','NORMAL','El-Clasico · startni tekshirish','Har ikkala tomon o‘rinlari to‘lgan.','Ishtirokchilarni tekshirib, eventni boshlashni ko‘rib chiqing.','TEAMS → El-Clasico',{verified:true});
 for(const b of ops.broadcasts||[]){const recipients=b.recipients||[],label=text(b.title,50),unknown=recipients.filter(r=>r.status==='FAILED'&&String(r.error||'').includes('DELIVERY_UNKNOWN')).length,failed=recipients.filter(r=>r.status==='FAILED'&&!String(r.error||'').includes('DELIVERY_UNKNOWN')).length,waiting=recipients.filter(r=>['PENDING','SENDING'].includes(r.status)).length,skipped=recipients.filter(r=>r.status==='SKIPPED_NO_TELEGRAM').length;
  if(unknown)add('delivery_unknown',b.id,'URGENT',label,`${unknown} xabarning yetkazilishi noma’lum.`,'Qabul qiluvchi yoki yuborish qaydini tekshiring; tekshirmasdan takror yubormang.','Admin → Bildirishnomalar',{verified:true});
  if(failed)add('delivery_failed',b.id,'HIGH',label,`${failed} xabarni Telegram rad etgan.`,'Rad etilish sababini tuzating; keyin faqat muvaffaqiyatsiz qabul qiluvchilarni ko‘rib chiqing.','Admin → Bildirishnomalar',{verified:true});
  if(waiting&&date(b.createdAt)<now-1800000)add('delivery_stalled',b.id,'HIGH',label,`${waiting} xabar 30 daqiqadan ortiq kutilmoqda.`,'Navbat va oxirgi yuborish qaydlarini tekshiring.','Admin → Bildirishnomalar',{verified:true});
  if(skipped)add('telegram_link',b.id,'NORMAL',label,`${skipped} qabul qiluvchida Telegram aloqasi yo‘q.`,'Akkaunt ulanganini va botga yozish imkoni borligini tekshiring.','Admin → Foydalanuvchilar',{verified:true});
 }
 for(const p of ops.channelPosts||[]){const uncertain=p.state==='unverified'||p.state==='sending'&&(!p.leaseUntil||p.leaseUntil<now);
  if(uncertain||p.state==='failed')add('channel_check',String(p.round),uncertain?'URGENT':'HIGH',`UZEFLIFE · ${p.round}-tur kanali`,`${p.sentPages||0}/${p.totalPages||'?'} rasm tasdiqlangan.`,uncertain?'Kanalda nechta rasm chiqqanini tekshirib, yuborish holatini tasdiqlang.':'Xato sababini tekshirib, qolgan rasmlarni davom ettiring.','UZEFLIFE → Xabar yuborish',{verified:true});
  else if(p.state==='pending'&&date(p.at)<now-900000)add('channel_stalled',String(p.round),'HIGH',`UZEFLIFE · ${p.round}-tur e’loni kutilmoqda`,'Yuborish qaydi 15 daqiqadan beri yangilanmagan.','Yuborish holatini yangilab, davom etayotganini tekshiring.','UZEFLIFE → Xabar yuborish',{verified:true});
 }
 for(const source of ops.unavailable)add('source_unavailable',source,'HIGH',source+' manbasini tekshirish','Hisobot bu manbani ishonchli o‘qiy olmadi.','Manba va ulanishni tekshirib, vazifalarni yangilang.','Admin → AI diagnostika',{verified:true});
 if(!fresh)add('source_stale','efl','HIGH','EFL ma’lumotlarini qayta tekshirish',input.stale?'Eski nusxa o‘qilgan.':'O‘yinlar yoki turnirlar to‘liq o‘qilmagan.','Manbani yangilang; pastdagi taxminiy vazifalarni joriy holat bilan tekshiring.','Admin → AI diagnostika',{verified:true});
 return [...items.values()].sort((a,b)=>rank[a.priority]-rank[b.priority]||(date(a.dueAt)||Infinity)-(date(b.dueAt)||Infinity)||a.id.localeCompare(b.id));
}
