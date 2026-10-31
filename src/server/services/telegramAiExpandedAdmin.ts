import { randomUUID } from 'node:crypto';
import { normalizeAiEntity, resolveAiClubs } from './telegramAiEntities';
import { matchesAiCompetition } from './telegramAiDataService';
import type { AdminPlan } from './telegramAiAdminCatalog';

export function expandedAdminIntent(text:string):string|null {
  const q=normalizeAiEntity(text.split(/(?:sabab|izoh|matn)\s*:/i)[0]);
  if(/\buzeflife\b/.test(q)&&!/kartochka|card/.test(q)) {
    if(/(?:kanal|@uzeflife_turner).*(?:tashla|yubor|joyla|elon|post)|(?:tashla|yubor|joyla|elon|post).*(?:kanal|@uzeflife_turner)/.test(q))return 'uzeflife_round_post';
    if(/keyingi.*(?:bosqich|tur).*(?:otkaz|och)|keyingi bosqichga/.test(q))return 'uzeflife_next';
    if(/pauza|toxtat/.test(q))return 'uzeflife_pause';
    if(/davom ettir|davom et|qayta ishga/.test(q))return 'uzeflife_resume';
    if(/qura.*(?:yarat|tashla)|\bboshla(?:gin|ng)?\b/.test(q))return 'uzeflife_generate';
    if(/yakunla|tugat/.test(q))return 'uzeflife_complete';
    if(/(?:royxat|qabul|registratsiya).*och/.test(q))return 'uzeflife_open';
    if(/(?:royxat|qabul|registratsiya).*yop/.test(q))return 'uzeflife_close';
    if(/holati|korsat|royxat/.test(q))return 'uzeflife_state';
  }
  if (/\b(?:kartochka\w*|intizom|discipline|card\w*)\b/.test(q)) {
    if (/bekor|olib tashla|qaytar|ochir/.test(q)) return 'discipline_revoke';
    if (/ber\w*|qoy\w*|issue/.test(q)) return 'discipline_issue';
    if (/korsat|koray|tekshir|holati|royxat|bormi|nechta/.test(q)) return 'discipline_view';
  }
  if (/klub\w*.*tanlash|jamoa\w*.*tanlash/.test(q)&&/holati|korsat|ochiqmi|yopiqmi/.test(q))return 'admission';
  if (/klub\w*.*tanlash|jamoa\w*.*tanlash/.test(q)&&/och\w*|yop\w*|qulfla\w*/.test(q)) return 'admission_league';
  if (/stadion|stadium|venue|oyin\w* vaqti|uchrashuv\w* vaqti|oyin\w* sanasi/.test(q)&&/ozgartir|belgila|qil\w*|qoy\w*|tozala|olib tashla/.test(q)) return 'fixture_schedule';
  return null;
}
export interface ExpandedAdminDependencies {
  read:(query:any)=>Promise<any>;
  users:()=>Promise<Array<{id:string;username?:string;telegramId?:string}>>;
  now?:Date;
  adminRead:(plan:AdminPlan)=>Promise<{status:number;data:any}>;
}
const clarify=(text:string):never=>{throw Error('CLARIFY:'+text);};
async function protectedRead(deps:ExpandedAdminDependencies,plan:AdminPlan) {
  const response=await deps.adminRead(plan);
  if(response.status<200||response.status>=300||response.data?.unavailable||response.data?.stale)clarify('Joriy admin ma’lumoti o‘qilmadi yoki bu amalga ruxsat yo‘q. Hech narsa o‘zgarmadi.');
  return response.data;
}
async function catalog(deps:ExpandedAdminDependencies,dataset:string) {
  const rows:any[]=[];
  for(let offset=0;offset<10000;offset+=30){const page=await deps.read({dataset,offset,limit:30});if(page.error||page.complete===false)clarify('Kerakli ma’lumotlar to‘liq o‘qilmadi.');rows.push(...(page.data||[]));if(!page.nextOffset && (page.total===undefined||rows.length>=page.total))return rows;if(!page.data?.length)break;}
  return clarify('Ro‘yxat to‘liq o‘qilmadi.');
}
async function player(text:string,deps:ExpandedAdminDependencies) {
  const head=text.split(/(?:sabab|izoh)\s*:/i)[0];
  const refs=head.match(/@[A-Za-z][A-Za-z0-9_]{4,31}|\buser-\d+\b/g)||[];
  let reference=refs[0],clubId:string|undefined;
  if(refs.length>1)clarify('Bitta aniq o‘yinchini yozing.');
  if(!reference){
    const clubs=await catalog(deps,'clubs'),named=resolveAiClubs(head,clubs);
    if(named.clarification)clarify(named.clarification);
    if(named.clubs.length!==1)clarify('Kimga? Bitta @username yoki klub egasini yozing.');
    const club:any=named.clubs[0];clubId=club.id;
    if(!/egasi\w*|egasiga/.test(normalizeAiEntity(head))||!club.ownerUsername)clarify('Klub egasi aniq topilmadi. O‘yinchining @username’ini yozing.');
    reference='@'+club.ownerUsername.replace(/^@/,'');
  }
  const users=await deps.users();
  const matches=users.filter(u=>reference.startsWith('@')?(u.username||'').replace(/^@/,'').toLowerCase()===reference.slice(1).toLowerCase():u.id===reference);
  if(matches.length!==1)clarify('O‘yinchi aniq topilmadi. Bitta amaldagi @username yoki user-ID yozing.');
  const user=matches[0];return {id:user.id,identity:{...(reference.startsWith('@')?{expectedUsername:reference.slice(1)}:{}),...(clubId?{expectedClubId:clubId}:{})}};
}
export async function planExpandedAdminRequest(text:string,deps:ExpandedAdminDependencies):Promise<AdminPlan|null> {
  const action=expandedAdminIntent(text);if(!action)return null;
  const q=normalizeAiEntity(text),seasonId=/\bseason-\d{4}-\d{2}\b/.exec(text)?.[0]||'season-2026-27';
  if(action==='admission')return{action,body:{seasonId}};
  if(action.startsWith('uzeflife_'))return {action,body:{}};
  if(action.startsWith('discipline_')){
    if(/\b(?:uzeflife|team|custom)\b/.test(q))clarify('Kartochka hozir EFL liga va kubok o‘yinlari uchun. Qaysi EFL o‘yinchisi ekanini aniq yozing.');
    const target=await player(text,deps),body:any={seasonId,...target.identity};
    if(action==='discipline_view')return{action,targetId:target.id,body};
    const colors=[/\b(?:sariq|yellow)\b/.test(q)?'YELLOW':null,/\b(?:qizil|red)\b/.test(q)?'RED':null].filter(Boolean);
    if(colors.length>1)clarify('Qaysi bitta kartochka: sariqmi yoki qizil?');
    const explicit=/(?:sabab|izoh)\s*:\s*([\s\S]+)/i.exec(text)?.[1]?.trim();
    const categories=[/haqorat|sokin|hurmatsiz/.test(q)?'ABUSE':null,/choz|kechiktir/.test(q)?'DELAY':null,/vaqtida oynama|kelmagan|no show|oynamay/.test(q)?'NO_SHOW':null].filter(Boolean);
    const note=explicit||(/\buchun\b/.test(q)||categories.length===1?text.trim():undefined);
    if(!note||note.length<3||note.length>500)clarify('Sababini yozing. Masalan: “Sabab: raqibini haqorat qildi”.');
    if(action==='discipline_revoke'){
      const data=await protectedRead(deps,{action:'discipline_view',targetId:target.id,body:{seasonId}});
      const explicitId=/\bcard-[a-f0-9-]{36}\b/i.exec(text)?.[0];
      const cards=(data.cards||[]).filter((c:any)=>c.status==='ACTIVE'&&(!explicitId||c.id===explicitId)&&(!colors.length||c.color===colors[0]));
      if(cards.length!==1)clarify(cards.length?'Bir nechta faol kartochka bor. Qaysi birini bekor qilay? Kartochka IDni yozing.':'Mos faol kartochka topilmadi.');
      return{action,targetId:target.id,secondaryId:cards[0].id,body:{...body,reason:note}};
    }
    if(colors.length!==1)clarify('Sariq yoki qizil kartochka ekanini yozing.');
    if(categories.length>1)clarify('Bitta asosiy sababni aniqlang: haqorat, o‘yinni cho‘zish yoki vaqtida o‘ynamaslik.');
    const incident=/\b(?:fixture|oyin|match)\s*id\s*[:=]\s*([A-Za-z0-9_:-]+)/i.exec(text)?.[1]||null;
    const fixtures=await protectedRead(deps,{action:'discipline_fixtures',targetId:target.id,body:{seasonId}});
    if(incident&&!(fixtures.fixtures||[]).some((f:any)=>f.id===incident))clarify('Ko‘rsatilgan o‘yin bu o‘yinchiga tegishli emas.');
    const next=colors[0]==='RED'?(fixtures.fixtures||[]).find((f:any)=>f.eligible&&f.id!==incident):null;
    return{action,targetId:target.id,body:{...body,color:colors[0],reason:categories[0]||'OTHER',note,incidentFixtureId:incident,expectedSuspensionFixtureId:next?.id||null,requestId:randomUUID()}};
  }
  const comps=await catalog(deps,'competitions');
  const found=comps.filter(c=>matchesAiCompetition(text,c));
  if(action==='admission_league'){
    const leagues=found.filter(c=>c.type==='LEAGUE');if(leagues.length!==1)clarify('Klub tanlash uchun qaysi bitta liga?');
    const open=/\boch(?:gin|ing|ib)?\b/.test(q),close=/\b(?:yop\w*|qulfla\w*)\b/.test(q);
    if(open===close)clarify('Klub tanlashni ochaymi yoki yopaymi?');
    const source=await protectedRead(deps,{action:'admission',body:{seasonId}});
    if(!source.admission||source.admission.stale||!Object.hasOwn(source.admission,'revision'))clarify('Klub tanlashning joriy holati o‘qilmadi.');
    return{action,body:{seasonId,leagueId:leagues[0].leagueId,open,expectedRevision:source.admission.revision}};
  }
  let fixtureId=/\b(?:fixture|oyin|match)\s*id\s*[:=]\s*([A-Za-z0-9_:-]+)/i.exec(text)?.[1];
  const round=/\b(\d{1,3})\s*tur\w*\b/.exec(q)?.[1];
  if(!fixtureId){
    const clubs=await catalog(deps,'clubs');const named=resolveAiClubs(text,clubs);
    if(named.clarification)clarify(named.clarification);
    if(named.clubs.length>1)clarify('Bitta o‘yin IDni yozing.');
    if(named.clubs.length===1){const page=await deps.read({dataset:'fixtures',club:named.clubs[0].id,...(found.length===1?{competition:found[0].id}:{}),...(round?{matchday:Number(round)}:{}),fixtureState:'unfinished',limit:30});if(page.error||page.complete===false||page.nextOffset||page.data?.length!==1)clarify('Bu klubning bir nechta o‘yini bor yoki ro‘yxat to‘liq emas. Turni yoki o‘yin IDni yozing.');fixtureId=page.data[0].id;}
  }
  const selector:any={seasonId};
  if(fixtureId)selector.fixtureId=fixtureId;
  else if(found.length===1)selector.competitionId=found[0].id;
  else if(found.length>1)clarify('Bitta turnir yoki umumiy kategoriyani tanlang.');
  else if(/barcha ligalar|hamma ligalar/.test(q))selector.category='LEAGUE';
  else if(/barcha kubok|hamma kubok/.test(q))selector.category='KNOCKOUT';
  else if(/barcha oyinlar|hamma oyinlar/.test(q))selector.category='ALL';
  else clarify('Qaysi o‘yinlar? Liga, kategoriya yoki “fixture id: ...” yozing.');
  if(round)selector.matchday=Number(round);
  let venue:string|null|undefined=/(?:stadion|venue)\s*:\s*([^\n]+)/i.exec(text)?.[1]?.trim();
  if(/stadion\w*.*(?:olib tashla|tozala)/.test(q))venue=null;
  if(venue!==undefined&&venue!==null&&(!venue||venue.length>150))clarify('Stadion nomi 1–150 belgi bo‘lsin.');
  if(venue!==undefined&&!fixtureId)clarify('Stadionni o‘zgartirish uchun bitta aniq o‘yin IDni yozing.');
  let rawDate=/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?\b/.exec(text)?.[0];
  if(!rawDate){
    const time=/\b(\d{1,2}):(\d{2})\b/.exec(text);
    if(time&&/\b(?:bugun|ertaga)\b/.test(q)){
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(deps.now||new Date());
      const day=new Date(today+'T00:00:00Z');if(/\bertaga\b/.test(q))day.setUTCDate(day.getUTCDate()+1);
      rawDate=day.toISOString().slice(0,10)+'T'+time[1].padStart(2,'0')+':'+time[2];
    }
  }
  let scheduledAt:string|null|undefined;
  if(rawDate){const calendar=new Date(rawDate.slice(0,10)+'T00:00:00Z');if(!Number.isFinite(calendar.getTime())||calendar.toISOString().slice(0,10)!==rawDate.slice(0,10)||Number(rawDate.slice(11,13))>23||Number(rawDate.slice(14,16))>59)clarify('Sana yoki vaqt noto‘g‘ri.');const value=rawDate.replace(' ','T')+( /Z$|[+-]\d{2}:\d{2}$/.test(rawDate)?'':'+05:00');const date=new Date(value);if(!Number.isFinite(date.getTime()))clarify('Sana noto‘g‘ri. YYYY-MM-DD HH:mm shaklida yozing.');scheduledAt=date.toISOString();}
  else if(/vaqt\w*.*(?:tozala|olib tashla)/.test(q))scheduledAt=null;
  const source=await protectedRead(deps,{action:'fixture_schedules',body:selector});
  if(!source.count||!Array.isArray(source.expected)||source.expected.length!==source.count)clarify('O‘zgartiriladigan o‘yinlar to‘liq topilmadi.');
  if(scheduledAt===undefined&&venue!==undefined){if(source.count!==1)clarify('Stadion uchun bitta o‘yin tanlang.');scheduledAt=source.expected[0].scheduledAt?new Date(source.expected[0].scheduledAt).toISOString():null;}
  if(scheduledAt===undefined)clarify('Aniq sana va vaqt yozing. Masalan: “2026-10-25 20:00”.');
  return{action,body:{...selector,scheduledAt,...(venue!==undefined?{venue}:{}),expected:source.expected}};
}
