import { normalizeAiEntity } from './telegramAiEntities';

/** A scenario or consequence question is discussion, not permission to perform its action. */
export function isAiHypotheticalQuestion(text: string): boolean {
  const q = normalizeAiEntity(text.replace(/^\/ai_(?:admin|read)(?:@[A-Za-z0-9_]+)?\s*/i, '').replace(/"[^"]*"|“[^”]*”/g, ' '));
  return /^(?:agar|if|suppose|what if)\b/.test(q) ||
    /\b(?:bolsa|qilsa|kiritilsa|ochirilsa|yutsa|yutqazsa|durang qilsa)\b/.test(q) ||
    /\b(?:qilsam|kiritsam|ochirsam|chiqarsam|qulflasam|ochsam|bloklasam)\b/.test(q) && /\?|nima|qanday|boladi|ozgaradi/.test(text.toLowerCase()) ||
    /\b(?:nima boladi|nima ozgaradi|qanday oqibat|what happens)\b/.test(q);
}

/** Concise reasoning requirements; no private chain of thought is requested or exposed. */
export function aiReasoningInstructions(query: string): string {
  const scenario = isAiHypotheticalQuestion(query);
  return `MANTIQ VA DALIL: avval foydalanuvchi savolining maqsadini aniqlang. Xulosani tekshirilgan dalil bilan asoslang; sabab bazada yo‘q bo‘lsa “sababi aniqlanmagan” deng, natijadan sababni to‘qimang. Taqqoslashda bir xil musobaqa, davr va tasdiqlangan o‘yinlarni oling; o‘yin sonlari farq qilsa o‘yin boshiga ko‘rsatkichni ajrating. Kam yoki to‘liq bo‘lmagan namuna ustidan qat’iy ustunlik e’lon qilmang. Ziddiyatli raqam/maqsad bo‘lsa bittasini tanlab ketmang, qaysi biri kerakligini so‘rang. Sonli xulosani mos birlik va manba bilan tekshiring. Javobda xulosa, qisqa dalil va cheklovni bering; ichki fikrlash jarayonini yozmang.${scenario ? ' SHARTLI SENARIY: bu savol bajarish buyrug‘i emas. Hozirgi holat va “agar”dagi holatni alohida ayting. Ochko o‘zgarishi uchun musobaqaning g‘alaba/durang/mag‘lubiyat qoidasi, joriy ochko va o‘yinning hozirgi tasdiq holatini tekshiring. Oldingi tasdiqlangan natija almashtirilsa uning hissasini olib tashlab, yangisini qo‘shing; natijani ikki marta sanamang. Yangi o‘rin uchun boshqa jamoalar ochkosi va tenglik qoidasi ham kerak. Yetishmagan ma’lumot bilan aniq yangi o‘rin yoki ochko to‘qimang. Bazaga hech narsa yozilmadi.' : ''}`;
}

/** Read aspects only. This never chooses mutation targets or grants authority. */
export function aiReadAspects(text: string): string[] {
  const q = normalizeAiEntity(text);
  const patterns: Array<[string, RegExp]> = [
    ['standings', /\b(?:jadval\w*|ochko\w*|nechanchi|orinda|standings|table|таблица)\b/],
    ['results', /\b(?:natijalar\w*|hisob\w*|results|score\w*)\b/],
    ['fixtures', /\b(?:oyinlar\w*|uchrashuvlar\w*|raqib\w*|keyingi oyin\w*|fixtures|schedule|opponent)\b/],
    ['ownership', /\b(?:egasi\w*|egalar\w*|kimniki|owner\w*)\b/],
    ['tactics', /\b(?:taktika\w*|tarkib\w*|pressing|formatsiya\w*|maslahat\w*|tactics|formation)\b/],
    ['explanation', /\b(?:nega|nima uchun|tushuntir\w*|why|explain)\b/],
  ];
  return patterns.filter(([, pattern]) => pattern.test(q)).map(([aspect]) => aspect);
}

export function hasMultipleAiReadAspects(text: string): boolean {
  return aiReadAspects(text).length > 1;
}

/** Owner + league position is already covered by the exact server-side fact formatter. */
export function needsSemanticAiReadAnswer(text: string): boolean {
  const aspects = aiReadAspects(text);
  return aspects.length > 1 && !aspects.every(a => ['ownership', 'standings'].includes(a));
}

export function wantsCombinedAiTables(text: string): boolean {
  const aspects = aiReadAspects(text);
  // “O‘yinlar jadvali” is one fixture list. Require a separate results request.
  return aspects.includes('standings') && aspects.includes('results') &&
    aspects.every(a => ['standings', 'results', 'fixtures'].includes(a)) &&
    /\b(?:va|ham|hamda|bilan|and|also|и)\b/.test(normalizeAiEntity(text));
}

/** Only harmless standalone courtesy can be skipped when finding a read topic. */
export function isAiReadCourtesy(text: string): boolean {
  return /^(?:salom|assalomu alaykum|rahmat|katta rahmat|tushunarli|zor|ok|okay|thanks|thank you|привет|спасибо)$/.test(normalizeAiEntity(text));
}
