import {normalizeAiEntity} from './telegramAiEntities';
import {matchesAiCompetition} from './telegramAiDataService';
import type {AdminPlan} from './telegramAiAdminCatalog';
export function isBacklogReminderRequest(text:string){
  const q=normalizeAiEntity(text.replace(/"[^"\n]*"|“[^”\n]*”/g,' ').split(/(?:sarlavha|matn|sabab|izoh)\s*:/i)[0]);
  return /\b(?:eslat\w*|bildirishnoma\w*|xabarnoma\w*)\b/.test(q)&&/\b(?:yubor\w*|jonat\w*|eslat(?:gin|ing)?)\b/.test(q)&&
    !/\b\d{1,3}\s*tur\w*|joriy\s+tur\w*/.test(q)&&/\b(?:hamma\w*|barcha\w*|qolgan\w*|eski\w*|oynalmagan\w*|oynamagan\w*|tugamagan\w*|yakunlanmagan\w*|kubok\w*|kubog\w*|chempionat\w*)\b/.test(q);
}
export async function planBacklogReminder(text:string,read:(q:any)=>Promise<any>):Promise<AdminPlan|null>{
  if(!isBacklogReminderRequest(text))return null;
  text=text.replace(/"[^"\n]*"|“[^”\n]*”/g,' ').split(/(?:sarlavha|matn|sabab|izoh)\s*:/i)[0];
  const q=normalizeAiEntity(text);
  const page=await read({dataset:'competitions',limit:30});
  if(page.error||page.complete===false||page.nextOffset)throw Error('CLARIFY:Musobaqalar ro‘yxati to‘liq o‘qilmadi.');
  const found=(page.data||[]).filter((c:any)=>matchesAiCompetition(text,c));
  if(found.length===1)return {action:'backlog_remind',body:{category:'ALL',competitionId:found[0].id}};
  if(found.length>1)throw Error('CLARIFY:Bitta turnir nomini yoki barcha musobaqalar deb yozing.');
  if(!/\b(?:hamma\w*|barcha\w*)\b/.test(q)||!/\b(?:chempionat\w*|musobaqa\w*|turnir\w*|liga\w*|kubok\w*|kubog\w*)\b/.test(q))throw Error('CLARIFY:Qaysi turnirga? Masalan: “La Liga qolgan o‘yinlariga eslatma yubor” yoki “barcha kuboklarga eslatma yubor”.');
  const cups=/\b(?:kubok\w*|kubog\w*|cup\w*)\b/.test(q),leagues=/\bliga(?:lar\w*)?\b/.test(q);
  return {action:'backlog_remind',body:{category:cups&&!leagues?'CUPS':leagues&&!cups?'LEAGUES':'ALL'}};
}
