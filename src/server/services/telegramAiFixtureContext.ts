import { createAiTournamentReader } from './telegramAiDataService';
import { resolveAiClubs, normalizeAiEntity } from './telegramAiEntities';
import { detectNaturalAdminAction } from './telegramAiAdminLanguage';
import { resolveAdminScore } from './telegramAiNaturalAdminPlanner';
import type { AdminPlan } from './telegramAiAdminCatalog';
import type { Club } from '../../types';

/** Only an explicit follow-up may use a uniquely selected, freshly re-read fixture. */
export async function contextualFixturePlan(text:string, fixtureIds:string[], signal:AbortSignal):Promise<AdminPlan|null> {
  const q=normalizeAiEntity(text);
  if(!/^(?:endi\s+)?(?:shu|osha|uning|uni|shuni|buni|hisobni|natijani)\b/.test(q))return null;
  if(q.split(' ').some(word=>!/^\d+$/.test(word)&&!/^(?:endi|shu|shuni|osha|uning|uni|buni|faqat|oyin\w*|uchrashuv\w*|hisob\w*|natija\w*|qil\w*|qoy\w*|kirit\w*|ozgartir\w*|saqla\w*|tasdiqla\w*|ochir\w*|och\w*|qayta|rad|et\w*|iltimos)$/.test(word)))return null;
  const action=detectNaturalAdminAction(text);
  if(!action || !['result_edit','result_approve','result_clear','result_reject','fixture_reopen'].includes(action))return null;
  const reader=createAiTournamentReader(signal);
  const clubs:Club[]=[];
  for(let offset=0;offset<10000;offset+=30){
    const page:any=await reader.read({dataset:'clubs',offset,limit:30});
    if(page.error || !page.data?.length)throw new Error('CLARIFY:Klublar ro‘yxati o‘qilmadi. O‘yin va jamoalarni aniq yozing.');
    clubs.push(...page.data);if(clubs.length>=page.total)break;
  }
  const named=resolveAiClubs(text,clubs);
  if(named.clarification)throw new Error('CLARIFY:'+named.clarification);
  if(named.clubs.length)return null; // Explicit team names always take precedence.
  if(new Set(fixtureIds).size!==1)throw new Error('CLARIFY:Qaysi o‘yin? Oldingi suhbatda bitta o‘yin aniq tanlanmagan. Jamoalar va turni yozing.');
  const found:any=await reader.read({dataset:'fixtures',fixtureId:fixtureIds[0],limit:1});
  if(found.error || found.data?.length!==1)throw new Error('CLARIFY:Oldingi o‘yin hozir bazada aniqlanmadi. Jamoalar va turni qayta yozing.');
  const fixture=found.data[0];
  const body:Record<string,unknown>={};
  if(action==='result_edit'||action==='result_approve'){
    const home=clubs.find(c=>c.id===fixture.homeClubId),away=clubs.find(c=>c.id===fixture.awayClubId);
    if(!home||!away)throw new Error('CLARIFY:O‘yin jamoalari aniqlanmadi. To‘liq nomlarni yozing.');
    Object.assign(body,resolveAdminScore(text,[home,away],fixture));
    if(action==='result_edit')body.status='CONFIRMED';
  }
  return {action,targetId:fixture.id,body};
}

/** A pronoun can select only one freshly-read club from the latest explicit club discussion. */
export async function contextualClubPlan(text:string, clubIds:string[], previousQueries:string[], signal:AbortSignal, read:(query:any)=>Promise<any>=createAiTournamentReader(signal).read):Promise<AdminPlan|null> {
  const q=normalizeAiEntity(text.replace(/@[A-Za-z0-9_]+/g,' '));
  if(!/^(?:endi\s+)?(?:shu|osha|uning|uni|unga|shuni|buni)\b/.test(q))return null;
  if(q.split(' ').some(word=>!/^(?:endi|shu|shuni|osha|uning|uni|unga|buni|faqat|klub\w*|jamoa\w*|egasi\w*|egasini|egasidan|biriktir\w*|ber\w*|boshat\w*|chiqar\w*|iltimos|qil\w*|ga)$/.test(word)))return null;
  const action=detectNaturalAdminAction(text);
  if(!action||!['club_assign','club_release'].includes(action))return null;
  if(new Set(clubIds).size!==1)throw new Error('CLARIFY:Qaysi klub? Suhbatda bitta klub aniq tanlanmagan. Klub nomini yozing.');
  const found:any=await read({dataset:'clubs',club:clubIds[0],limit:1});
  const club=found.data?.[0];
  if(found.error||found.complete===false||found.stale||!club)throw new Error('CLARIFY:Oldingi klubning joriy holati o‘qilmadi. Klubni aniq yozing yoki birozdan keyin urinib ko‘ring.');
  const latest=[...previousQueries].reverse().find(t=>!/^(?:salom|rahmat|katta rahmat|tushunarli|zor|ok)[.!?]*$/i.test(normalizeAiEntity(t)));
  if(!latest||!normalizeAiEntity(latest).includes(normalizeAiEntity(club.name)))throw new Error('CLARIFY:Qaysi klubni nazarda tutdingiz? Oldingi mavzudan klubni taxmin qilib o‘zgartirmayman.');
  if(action==='club_release')return {action,targetId:club.id,body:{}};
  const refs=text.match(/@[A-Za-z][A-Za-z0-9_]{4,31}/g)||[];
  if(refs.length!==1)throw new Error('CLARIFY:Kimga biriktiray? Bitta aniq @username yozing.');
  return {action,targetId:club.id,body:{targetUserId:refs[0]}};
}
