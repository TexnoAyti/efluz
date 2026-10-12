import { normalizeAiEntity } from './telegramAiEntities';
import { detectNaturalAdminAction } from './telegramAiAdminLanguage';

type Clarification = { request: string; question: string };

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
  let field: string | null = null;
  if (/qaysi foydalanuvchi|qaysi akkaunt|kimga biriktiray|bitta.*username|toliq.*username/.test(q)) {
    const user = /^(?:foydalanuvchi\s+)?(@[A-Za-z][A-Za-z0-9_]{4,31}|user-\d+)(?:\s+ga)?$/.exec(value);
    if (user) field = user[1];
  } else if (/qaysi hisob|hisobni.*yozing/.test(q)) {
    const score = /^(?:(?:hisob|natija)\s*:?\s*)?(\d{1,2}\s*[:–—−-]\s*\d{1,2})$/i.exec(value);
    if (score && !/\b\d{1,2}\s*[:–—−-]\s*\d{1,2}\b/.test(draft.request)) field = score[1];
  } else if (/sabab yozing/.test(q)) {
    if (value.length >= 3 && !/\b(?:biriktir\w*|ochir\w*|yubor\w*|blokla\w*|qil\w*)\b/.test(a)) field = 'sabab: ' + value;
  } else if (/sana.*vaqt.*yozing/.test(q)) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) field = value;
  } else if (/qaysi mavsum/.test(q)) {
    if (/^season-\d{4}-\d{2}$/.test(value)) field = value;
  } else if (/qaysi tur|bir nechta oyin topildi/.test(q)) {
    const round = /^(?:tur\s*)?(\d{1,3})(?:\s*-?\s*tur(?:ni)?)?$/.exec(a);
    if (round && Number(round[1]) >= 1 && Number(round[1]) <= 100 && !/\b\d+\s*-?\s*tur\w*\b|\btur\s*\d+/.test(normalizeAiEntity(draft.request))) field = round[1] + '-tur';
  } else if (/necha soat|muddatni.*butun soat/.test(q)) {
    const hours = /^(\d{1,3})(?:\s*soat(?:ga)?)?$/.exec(a);
    if (hours && Number(hours[1]) >= 1 && Number(hours[1]) <= 720 && !/\b\d+\s*soat/.test(normalizeAiEntity(draft.request))) field = hours[1] + ' soat';
  } else if (/limit uchun bitta musbat butun son/.test(q)) {
    if (/^\d{1,4}$/.test(value) && Number(value) > 0 && Number(value) <= 5000 && !/\d/.test(draft.request)) field = value;
  } else if (/qaysi bitta ai limiti/.test(q)) {
    if (/^(?:foydalanuvchi|user|mavzu|topic|guruh|kunlik)$/.test(a)) field = value;
  } else if (/qaysi (?:bitta )?liga|admin qaysi ligani|bitta turnir|qaysi.*kubok/.test(q)) {
    if (value.length <= 80 && /^[\p{L}\p{N} .&’'_-]+$/u.test(value) &&
        !/\b(?:ber\w*|yoz\w*|tashla\w*|qil\w*|korsat\w*|yubor\w*)\b/.test(a)) field = value;
  } else if (/qaysi bitta klub|qaysi klub|klub nomini yozing/.test(q)) {
    if (value.length <= 80 && /^[\p{L}\p{N} .&’'_-]+$/u.test(value) &&
        !/\b(?:ber\w*|yoz\w*|tashla\w*|qil\w*|korsat\w*|yubor\w*)\b/.test(a)) field = value;
  }
  if (!field) return null;
  // A space avoids interpreting a missing-field answer as a second action.
  const request = `${draft.request} ${field}`;
  return request.length <= 1800 ? request : null;
}
