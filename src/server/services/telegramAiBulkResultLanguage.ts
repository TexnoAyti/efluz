import { normalizeAiEntity } from './telegramAiEntities';
import { isAiHypotheticalQuestion } from './telegramAiMessageUnderstanding';

export function isBulkResultRequest(text: string): boolean {
  const q = normalizeAiEntity(text);
  return /\b(?:hamma\w*|barcha\w*|all)\b/.test(q) && /\b(?:oynalmagan\w*|oynamagan\w*|otkazilmagan\w*|qolgan\w*|unplayed)\b/.test(q) &&
    /\d{1,2}\s*[:–—−-]\s*\d{1,2}/.test(text) && /\b(?:ber\w*|qil\w*|qoy\w*|kirit\w*|belgila\w*|yoz\w*|set)\b/.test(q);
}
export function parseBulkResultRequest(text: string) {
  if (!isBulkResultRequest(text)) return null;
  const q = normalizeAiEntity(text);
  if (isAiHypotheticalQuestion(text) || /[;\n?"“”]/.test(text) || /\b(?:emas|yoq|agar|tashqari|faqat|istisno|oxirgi|oldingi|keyingi|bugun|bugungi|kecha|kechagi|ertaga|muddati|deadline|kechikkan|ochiq|yopiq|qulflangan|egasiz|egali|ozim|mening|bizning|birinchi|ikkinchi|except|not|dont|yoki|keyin|song|hamda|berma\w*|qilma\w*|qoyma\w*|kiritma\w*|yozma\w*)\b/.test(q))
    throw new Error('CLARIFY:Bitta aniq ommaviy natija topshirig‘ini yozing: liga, tur chegarasi va hisob. Istisnolarni taxmin qilmayman.');
  const scores = [...text.matchAll(/\b(\d{1,2})\s*[:–—−-]\s*(\d{1,2})\b/g)];
  if (scores.length !== 1) throw new Error('CLARIFY:Ommaviy natija uchun bitta hisob yozing.');
  const rounds = [...q.matchAll(/\b(\d{1,2})\s*(turgacha|turdagi|turda|turga|tur(?:ni)?)\b/g)];
  if (rounds.length !== 1) throw new Error('CLARIFY:Qaysi turgacha yoki qaysi bitta turdagi o‘ynalmagan o‘yinlar? Masalan: “La Liga 9-turgacha o‘ynalmagan hamma o‘yinga 0-0 ber”.');
  const extraNumbers = normalizeAiEntity(text.replace(scores[0][0], '')).replace(rounds[0][0], '');
  if (/\b\d+\b/.test(extraNumbers)) throw new Error('CLARIFY:Qo‘shimcha son yoki miqdor cheklovi bor. Bitta liga, bitta tur chegarasi va bitta hisob yozing.');
  const toMatchday = Number(rounds[0][1]);
  if (toMatchday < 1 || toMatchday > 38) throw new Error('CLARIFY:Tur 1–38 oralig‘ida bo‘lsin.');
  if (/\b(?:safar\w*|uy\w*|texnik|penalti\w*|kubok\w*|final\w*|pley\w*|guruh\w*)\b/.test(q))
    throw new Error('CLARIFY:Bu ommaviy amal oddiy liga hisobi uchun. Texnik g‘alaba, penalti yoki kubok natijasini alohida aniqlashtiring.');
  return { fromMatchday: rounds[0][2] === 'turgacha' ? 1 : toMatchday, toMatchday, homeScore:Number(scores[0][1]),awayScore:Number(scores[0][2]) };
}
