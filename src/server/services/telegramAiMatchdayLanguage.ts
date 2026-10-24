import { normalizeAiEntity } from './telegramAiEntities';
import { matchesAiCompetition } from './telegramAiDataService';
import type { AdminPlan } from './telegramAiAdminCatalog';

type RoundIntent='OPEN'|'LOCK'|'EXTEND'|'RESTART'|'ADVANCE'|'REMIND'|'STATUS';
export function matchdayCommandHead(text:string) { return text.replace(/"[^"\n]*"|“[^”\n]*”/g,' ').split(/(?:sarlavha|matn|sabab|izoh)\s*:/i)[0]; }
export function detectMatchdayIntent(text:string):RoundIntent|null {
 const q=normalizeAiEntity(matchdayCommandHead(text));
 if(!/\b(?:tur\w*|matchday)\b/.test(q))return null;
 const remind=/\beslat\w*\b/.test(q)||/\b(?:xabar\w*|bildirishnoma\w*|xabarnoma\w*)\b/.test(q)&&/\b(?:yubor\w*|jonat\w*)\b/.test(q)&&/\b(?:oynamagan\w*|oynalmagan\w*|kiritmagan\w*|tugamagan\w*|yakunlanmagan\w*|qolgan\w*)\b/.test(q);
 const singularFixture=/\b(?:oyini(?:ni|ga)?|uchrashuvi(?:ni|ga)?)\b/.test(q);
 const missingPlayers=/\b(?:oynamagan\w*|oynalmagan\w*|kiritmagan\w*|tugamagan\w*|yakunlanmagan\w*)\b/.test(q);
 if(remind&&(!singularFixture||missingPlayers))return 'REMIND';
 if(singularFixture)return null;
 if(/\bkeyingi\s+tur\w*\b/.test(q)&&/\b(?:otkaz\w*|otamiz|boshlat\w*|boshla\w*|och(?:gin|ing)?)\b/.test(q))return 'ADVANCE';
 if(/\b(?:qayta|qaytadan|boshidan)\s+(?:boshla\w*|ishga tushir\w*)\b/.test(q))return 'RESTART';
 if(/\b(?:uzaytir\w*|choz\w*)\b/.test(q))return 'EXTEND';
 if(/\b(?:qulfla\w*|berkit\w*|yop(?:gin|ing|inglar)?|yopib(?: qoy\w*)?)\b/.test(q))return 'LOCK';
 if(/\b(?:och(?:gin|ing|inglar)?|ochib(?: ber\w*| qoy\w*)?)\b/.test(q))return 'OPEN';
 if(/\b(?:holati|ochiqmi|yopiqmi|ochilganmi|yopilganmi|nechanchi|qaysi tur|qachon yopil\w*|qancha vaqt)\b/.test(q))return 'STATUS';
 return null;
}
export function matchdayDuration(text:string):number|undefined {
 const head=matchdayCommandHead(text);
 if(/\b(?:daqiqa|minut|yarim)\b/i.test(head))throw Error('CLARIFY:Muddatni to‘liq soat yoki kun bilan yozing. Masalan: 24 soat yoki 2 kun.');
 const entries=[...head.matchAll(/(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*(soat|kun)(?:ga|lik|dan)?\b/gi)];
 if(/[-−–—]\s*\d+(?:[.,]\d+)?\s*(?:soat|kun)/i.test(head)||!entries.length&&/\b(?:soat|kun)(?:ga|lik|dan)?\b/i.test(head))throw Error('CLARIFY:Muddatni musbat son bilan yozing. Masalan: 24 soat yoki 2 kun.');
 if(!entries.length)return;
 const values=entries.map(m=>Number(m[1].replace(',','.'))*(m[2].toLowerCase()==='kun'?24:1));
 if(values.some(n=>!Number.isInteger(n)||n<1||n>720)||new Set(values).size!==1)throw Error('CLARIFY:Bitta aniq muddat yozing: 1–720 soat yoki 1–30 kun.');
 return values[0];
}
export async function planMatchdayRequest(text:string,read:(q:any)=>Promise<any>):Promise<AdminPlan|null> {
 const intent=detectMatchdayIntent(text);if(!intent)return null;
 const q=normalizeAiEntity(matchdayCommandHead(text));
 if(!['STATUS','ADVANCE'].includes(intent)&&!/\b(?:\d{1,3}\s*tur\w*|matchday\s*\d{1,3}|joriy\s+tur\w*)\b/.test(q))throw Error('CLARIFY:Qaysi turni boshqaramiz? Tur raqamini yoki “joriy tur” deb yozing.');
 const page=await read({dataset:'competitions',limit:30});
 if(page.error||page.complete===false||page.nextOffset)throw Error('CLARIFY:Turnirlarning to‘liq holati o‘qilmadi. Hozir reja tuzib bo‘lmaydi.');
 const found=(page.data||[]).filter((c:any)=>matchesAiCompetition(matchdayCommandHead(text),c));
 if(found.length!==1)throw Error('CLARIFY:Qaysi liga yoki kubok? Bitta turnir nomini yozing.');
 const comp=found[0];
 // Existing cup stage handling stays responsible for cup opening/locking.
 if(!['LEAGUE','EUROPEAN_LEAGUE_PHASE'].includes(comp.type))return null;
 if(intent==='STATUS')return {action:'matchday_status',targetId:comp.id,body:{}};
 const rounds=[...q.matchAll(/\b(\d{1,3})\s*tur\w*\b|\bmatchday\s*(\d{1,3})\b/g)].map(m=>Number(m[1]||m[2]));
 if(new Set(rounds).size>1)throw Error('CLARIFY:Qaysi bitta tur? Tur raqamlari bir-biriga mos kelmadi.');
 const round=rounds[0]||(/\bjoriy\s+tur\w*\b/.test(q)?comp.currentMatchday:undefined);
 const durationHours=matchdayDuration(text);
 if(intent==='ADVANCE'&&rounds.length)throw Error('CLARIFY:Keyingi turga o‘tkazaymi yoki aniq raqamli turni tanlaymi? Bitta amal yozing.');
 if(intent==='ADVANCE')return {action:'matchday_advance',targetId:comp.id,body:{...(durationHours?{durationHours}:{})}};
 if(!Number.isInteger(round)||round<1||round>100)throw Error('CLARIFY:Qaysi tur? Raqamini yoki “joriy tur” deb yozing.');
 const maximum=comp.type==='LEAGUE'?Number(comp.formatConfig?.totalClubs||(['league-bundesliga','league-ligue-1'].includes(comp.leagueId)?18:20))-1:Number(comp.totalMatchdays||100);
 if(round>maximum)throw Error(`CLARIFY:${comp.name}da ${maximum} ta tur bor. Mavjud tur raqamini yozing.`);
 if(intent==='REMIND')return {action:'matchday_remind',targetId:comp.id,body:{matchday:round,...(/\b\d{1,3}\s*turgacha\b/.test(q)?{fromMatchday:1}:{})}};
 if(intent==='EXTEND'&&!durationHours)throw Error('CLARIFY:Necha soatga uzaytiray? Masalan: 6 soatga yoki 1 kunga.');
 if(intent==='OPEN'&&(/\b(?:hozir|majburiy)\b/.test(q)||/ochib ber/.test(q)))return {action:'matchday_open_now',targetId:comp.id,body:{matchday:round,...(durationHours?{durationHours}:{})}};
 return {action:'matchday_control',targetId:comp.id,body:{action:intent,matchday:round,...(durationHours?{durationHours}:{})}};
}
/** Versions are copied from the data source, never accepted from a model guess. */
export function bindMatchdaySnapshot(plan:AdminPlan,comp:any):AdminPlan {
 const body={...plan.body};
 if(plan.action==='matchday_control'&&Object.hasOwn(comp,'updatedAt'))body.expectedUpdatedAt=comp.updatedAt||null;
 if(plan.action==='matchday_advance'){
  if(Number.isInteger(comp.currentMatchday))body.expectedCurrentMatchday=comp.currentMatchday;
  if(Object.hasOwn(comp,'updatedAt'))body.expectedUpdatedAt=comp.updatedAt||null;
 }
 if(['matchday_remind','matchday_advance'].includes(plan.action)&&comp.seasonId)body.seasonId=comp.seasonId;
 return {...plan,body};
}
