import { normalizeAiEntity, resolveAiClubs, replaceAiClubChoice, type AiClubChoice } from './telegramAiEntities';
import { detectNaturalAdminAction } from './telegramAiAdminLanguage';

type Clarification = { request: string; question: string; clubChoices?: AiClubChoice[] };

/** An explicit answer replaces the requested field, preserving targets and quoted payloads. */
function fillClarifiedField(request: string, pattern: RegExp, field: string): string | null {
  const masked = request.replace(/@[A-Za-z0-9_]+|"[^"]*"|“[^”]*”/g, m => ' '.repeat(m.length));
  const hits = [...masked.matchAll(pattern)];
  if (!hits.length) return request.length + field.length + 1 <= 1800 ? `${request} ${field}` : null;
  let result = request;
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i];
    result = result.slice(0, hit.index!) + (i === 0 ? field : '') + result.slice(hit.index! + hit[0].length);
  }
  return result.trim().length <= 1800 ? result.trim() : null;
}

/** Only fill the field the delivered question asked for. No history guesses,
 * action changes, or writes: the resulting request must be planned afresh. */
export function continueAiAdminClarification(draft: Clarification, answer: string): string | null {
  const raw = answer.trim();
  // Human answers often repeat the requested field or end with “bo‘lsin”.
  // Strip only anchored wrappers; usernames, scores, IDs and reasons stay exact.
  const reasonQuestion = /sabab yozing/.test(normalizeAiEntity(draft.question));
  const value = reasonQuestion ? raw : raw
    .replace(/^(?:iltimos[, ]+|please[, ]+)/i, '')
    .replace(/\s+(?:bo[‘’ʻʼ'`]?lsin|bolsin|edi|iltimos|please)[.!]?$/i, '')
    .replace(/[.!]$/, '').trim();
  const q = normalizeAiEntity(draft.question);
  const a = normalizeAiEntity(value);
  if (!value || raw.length > 200 || /[\n;?]/.test(raw) || /^\//.test(value) || /^[+-]\s*\d|\d[.,]\d/.test(value) ||
      /\b(?:kim|nega|qanday|nechanchi|nima|qachon|jadval\w*|natijalar\w*|oyinlar\w*|tasdiqla\w*|bekor|qilma\w*)\b/.test(a) ||
      detectNaturalAdminAction(value)) return null;
  if (!reasonQuestion && /\b(?:emas|yoq|boshqa|yoki|or|not|нет|не)\b/.test(a)) return null;
  if (draft.clubChoices?.length) {
    const choices = draft.clubChoices;
    let selected: AiClubChoice | undefined;
    if (/^(?:ha|xa|yes|xop|togri|aynan shu|osha|shuni|shu|(?:ha|xa) (?:shu|osha))$/.test(a) && choices.length === 1) selected = choices[0];
    else if (/^[1-4]$/.test(a)) selected = choices[Number(a) - 1];
    else if (/^(?:birinchisi|ikkinchisi|uchinchisi|tortinchisi)$/.test(a)) selected = choices[['birinchisi','ikkinchisi','uchinchisi','tortinchisi'].indexOf(a)];
    else {
      const named = resolveAiClubs(value, choices.map(c => ({ id: c.id, name: c.name })) as any);
      if (!named.clarification && named.clubs.length === 1) selected = choices.find(c => c.id === named.clubs[0].id);
    }
    const request = selected ? replaceAiClubChoice(draft.request, selected) : null;
    return request && request.length <= 1800 ? request : null;
  }
  // Missing shootout scores append only the explicitly requested field; the main score stays intact.
  if (/penalti/.test(q) && /kubok durang/.test(q)) {
    const penalty = /^(?:pen(?:alti\w*)?(?:\s+seriya\w*)?\s*[:=]?\s*)?(\d{1,2})\s*[:–—−-]\s*(\d{1,2})$/i.exec(value);
    if (penalty && penalty[1] !== penalty[2] && draft.request.length + value.length < 1800) {
      const base = draft.request.replace(/(?:pen(?:alti\w*)?(?:\s+seriya\w*)?)\s*[:=]?\s*(?:\d{1,2}\s*[:–—−-]\s*\d{1,2})?/gi, '').trim();
      return `${base}, penalti ${penalty[1]}-${penalty[2]}`;
    }
    return null;
  }
  let field: string | null = null;
  if (/qaysi foydalanuvchi|qaysi akkaunt|kimga biriktiray|bitta.*username|toliq.*username|username.*(?:yozing|kiriting)/.test(q)) {
    const user = /^(?:foydalanuvchi\s+)?(@[A-Za-z][A-Za-z0-9_]{4,31}|user-\d+)(?:\s+ga)?$/.exec(value);
    if (user) field = user[1];
  } else if (/qaysi hisob|hisobni.*yozing/.test(q) && !/ikkala jamoa/.test(q)) {
    const score = /^(?:(?:hisob|natija)\s*:?\s*)?(\d{1,2}\s*[:–—−-]\s*\d{1,2})$/i.exec(value);
    if (score) return fillClarifiedField(draft.request, /\b\d{1,2}\s*[:–—−-]\s*\d{1,2}\b/g, score[1]);
  } else if (/sabab yozing/.test(q)) {
    if (value.length >= 3 && !/\b(?:biriktir\w*|ochir\w*|yubor\w*|blokla\w*|qil\w*)\b/.test(a)) field = 'sabab: ' + value;
  } else if (/sana.*vaqt.*yozing/.test(q)) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) field = value;
  } else if (/qaysi mavsum/.test(q)) {
    if (/^season-\d{4}-\d{2}$/.test(value)) field = value;
  } else if (/qaysi (?:bitta )?tur|nechanchi tur|tur raqam|bir nechta oyin topildi/.test(q)) {
    const round = /^(?:tur\s*)?(\d{1,3})(?:\s*-?\s*tur(?:ni|dagi|da)?)?$/.exec(a);
    if (round && Number(round[1]) >= 1 && Number(round[1]) <= 100) return fillClarifiedField(draft.request, /\b\d{1,3}\s*-?\s*tur(?:ni|dagi|da)?\b|\btur\s*\d{1,3}\b/gi, round[1] + '-tur');
    else if (/turnirni yozing|tur yoki turnir/.test(q) && value.length <= 80 &&
        /^[\p{L}][\p{L}\p{N} .&’'_-]*$/u.test(value) && !/\b(?:ber\w*|yoz\w*|tashla\w*|qil\w*|korsat\w*|yubor\w*)\b/.test(a)) field = value;
  } else if (/necha soat|muddatni.*butun soat/.test(q)) {
    const hours = /^(\d{1,3})(?:\s*soat(?:ga)?)?$/.exec(a);
    if (hours && Number(hours[1]) >= 1 && Number(hours[1]) <= 720) return fillClarifiedField(draft.request, /\b\d{1,3}\s*soat(?:ga)?\b/gi, hours[1] + ' soat');
  } else if (/limit uchun bitta musbat butun son/.test(q)) {
    if (/^\d{1,4}$/.test(value) && Number(value) > 0 && Number(value) <= 5000 && !/\d/.test(draft.request)) field = value;
  } else if (/qaysi bitta ai limiti/.test(q)) {
    if (/^(?:foydalanuvchi|user|mavzu|topic|guruh|kunlik)$/.test(a)) field = value;
  } else if (/qaysi (?:bitta )?liga|liga nomini|admin qaysi ligani|bitta turnir|qaysi.*kubok/.test(q)) {
    if (value.length <= 80 && /^[\p{L}\p{N} .&’'_-]+$/u.test(value) &&
        !/\b(?:ber\w*|yoz\w*|tashla\w*|qil\w*|korsat\w*|yubor\w*)\b/.test(a)) field = value;
  } else if (/qaysi bitta klub|qaysi klub|klub nomini|klubni tanlang/.test(q)) {
    if (value.length <= 80 && /^[\p{L}\p{N} .&’'_-]+$/u.test(value) &&
        !/\b(?:ber\w*|yoz\w*|tashla\w*|qil\w*|korsat\w*|yubor\w*)\b/.test(a)) field = value;
  } else if (/jamoalar nomi|ikkala jamoa nomi/.test(q)) {
    if (value.length <= 100 && /^[\p{L}][\p{L}\p{N} .&’'—–_-]*$/u.test(value) &&
        !/\b(?:ber\w*|yoz\w*|tashla\w*|qil\w*|korsat\w*|yubor\w*)\b/.test(a)) field = value;
  }
  if (!field) return null;
  // A space avoids interpreting a missing-field answer as a second action.
  const request = `${draft.request} ${field}`;
  return request.length <= 1800 ? request : null;
}
