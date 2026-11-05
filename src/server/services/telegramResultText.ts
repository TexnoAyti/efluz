export const normalizeResultText=(value:string)=>value.normalize('NFKC').replace(/[\ufe0e\ufe0f\u20e3]/g,'').replace(/[‐‑‒–—−﹘﹣－]/g,'-').replace(/[∶：]/g,':');
const escape=(v:string)=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Only verified identities may split glued usernames and scores. */
export function separateResultIdentities(value:string,names:string[]){
 const aliases=[...new Set(names.map(n=>n.replace(/^@/,'').trim()).filter(n=>n.length>=3))].sort((a,b)=>b.length-a.length);
 if(!aliases.length)return normalizeResultText(value);
 return normalizeResultText(value).replace(new RegExp('(@(?:'+aliases.map(escape).join('|')+')|(?<![A-Za-z0-9_])(?:'+aliases.map(escape).join('|')+'))(?=$|[^A-Za-z0-9_]|vs|win|won|yutdi|galaba|[0-9]{1,2}[-:])','gi'),name=>' '+name+' ');
}
export function findResultScores(value:string){
 const text=normalizeResultText(value);
 let masked=text.replace(/@[A-Za-z0-9_]+/g,m=>' '.repeat(m.length));
 masked=masked.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g,m=>' '.repeat(m.length));
 return [...masked.matchAll(/(?<!\d)(\d{1,2})\s*[:-]\s*(\d{1,2})(?!\d)/g)].filter(m=>{const before=text.slice(Math.max(0,m.index!-36),m.index);return /(?:extra\s*time|shimcha\s*vaqt)\s*$/i.test(before)||!/(?:soat|vaqt|time|at)\s*$/i.test(before);});
}
export function hasResultInput(text:string){return /\d+\s*[:‐‑‒–—−-]\s*\d+/.test(text)||/(?:win|won|winner|yutdi|yutdim|g[‘’ʻʼ']?alaba|g[‘’ʻʼ']?olib|победа|выиграл)\b/i.test(text);}
export function onlyResultNoise(value:string){
 return value.toLowerCase().replace(/(?:soat|vaqt|time)\s*\d{1,2}:\d{2}|\d{4}-\d{1,2}-\d{1,2}/g,' ').normalize('NFKD').replace(/\p{M}/gu,'').replace(/[‘’ʻʼ'`]/g,'').replace(/\b(?:assalomu|alaykum|salom|rahmat|hisob|natija|oyin|tugadi|tugagan|yakunlandi|boldi|boldiku|men|biz|bugun|kecha|zor|yaxshi|aka|bro|admin|iltimos|tashladim|yubordim|kirit|kiriting|yozing|qoying|gol|penalti|penalty|penalties)\b/g,' ').replace(/[^\p{L}\p{N}]/gu,'').length===0;
}
export function winnerUsername(text:string):string|null{
 const names=[...normalizeResultText(text).matchAll(/@([A-Za-z0-9_]{5,32})\s+(?:[-:=]\s*)?(?:win(?:ner)?|won|yutdi|yutdim|g[‘’ʻʼ']?alaba|g[‘’ʻʼ']?olib|победа|выиграл)\b/gi)].map(m=>m[1].toLowerCase());
 names.push(...[...normalizeResultText(text).matchAll(/\b(?:win(?:ner)?|won|g[‘’ʻʼ']?olib|победитель)\s*[:=-]?\s*@([A-Za-z0-9_]{5,32})\b/gi)].map(m=>m[1].toLowerCase()));
 const unique=[...new Set(names)];
 if(unique.length>1)throw Error('CLARIFY:Ikki xil g‘olib yozilgan. Qaysi o‘yinchi yutganini va aniq hisobni yozing.');
 return unique[0]||null;
}
