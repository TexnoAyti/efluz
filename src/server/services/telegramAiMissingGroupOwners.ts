import type { AdminPlan } from './telegramAiAdminCatalog';
import { normalizeAiEntity } from './telegramAiEntities';
import { isAiHypotheticalQuestion } from './telegramAiMessageUnderstanding';

export function isMissingGroupOwnersRequest(text:string):boolean {
  const q=normalizeAiEntity(text);
  if(isAiHypotheticalQuestion(text) || /\b(?:korsatma\w*|chiqarma\w*|tashlama\w*|yozma\w*|guruhdan|egasidan|klubidan|jamoadan|hayda\w*|blokla\w*|ochir\w*)\b/.test(q))return false;
  return /\bguruh(?:da|ga)\b/.test(q) && /\b(?:yoq\w*|emas\w*|kirmagan\w*|qoshilmagan\w*|bolmagan\w*)\b/.test(q) &&
    /\b(?:odam\w*|egalar\w*|foydalanuvchi\w*|oyinchi\w*|kim\w*|qaysi\w*|royxat\w*|yoqlar\w*|kirmaganlar\w*|qoshilmaganlar\w*|bolmaganlar\w*)\b/.test(q);
}
export function missingOwnersReadPlan(text:string):AdminPlan|null {
  if(!isMissingGroupOwnersRequest(text))return null;
  const q=normalizeAiEntity(text);
  const pages=[...q.matchAll(/\b(?:sahifa|page)\s*(\d+)\b|\b(\d+)\s*(?:sahifa|page)\b/g)];
  if(pages.length>1)throw Error('CLARIFY:Bitta sahifa raqamini yozing.');
  const page=pages.length?Number(pages[0][1]||pages[0][2]):1;
  if(page<1||page>50)throw Error('CLARIFY:Sahifa 1–50 oralig‘ida bo‘lsin.');
  return {action:'group_missing_owners',body:{page,limit:20}};
}
export function formatMissingGroupOwners(data:any):string {
  if(data?.success!==true || !Array.isArray(data.owners))return 'Guruh a’zoligini ishonchli tekshirib bo‘lmadi. Bu hamma guruhda degani emas.';
  const lines=['Guruhda yo‘q klub egalari:'];
  if(!data.owners.length)lines.push(data.complete&&data.totalMissing===0?'Barcha tekshirilgan klub egalari guruhda.':data.totalMissing?'Bu sahifada yozuv yo‘q. Birinchi sahifani so‘rang.':'Tekshirilganlar orasida topilmadi; tekshiruv to‘liq emas.');
  for(const [index,owner] of data.owners.entries()) {
    const name=owner.username?'@'+owner.username:owner.displayName?.slice(0,40)||'Username yo‘q';
    lines.push(`${(data.page-1)*data.limit+index+1}. ${owner.clubNames.join(', ').slice(0,70)} — ${name}${owner.username?'':' · ID: '+owner.telegramId}${owner.reason==='BANNED_FROM_GROUP'?' · guruhdan chetlatilgan':''}`);
  }
  lines.push(`\nTekshirildi: ${data.checkedOwners}/${data.totalOwners} ta klub egasi. Guruhda yo‘q: ${data.totalMissing} ta${data.complete?'':' topildi (to‘liq emas)'}.`);
  if(data.unverifiedOwners)lines.push(`${data.unverifiedOwners} ta akkaunt holati tasdiqlanmadi; ularni guruhda yo‘q deb hisoblamadim.`);
  if(data.nextPage)lines.push(`Davomi: “Guruhda yo‘q klub egalari, ${data.nextPage}-sahifa”.`);
  if(data.generatedAt && Number.isFinite(Date.parse(data.generatedAt)))lines.push('Tekshiruv: '+new Intl.DateTimeFormat('uz-UZ',{timeZone:'Asia/Tashkent',hour:'2-digit',minute:'2-digit'}).format(new Date(data.generatedAt)));
  return lines.join('\n');
}
