import { normalizeAiEntity } from './telegramAiEntities';

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
