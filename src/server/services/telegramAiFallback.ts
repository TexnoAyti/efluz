import type { GroundingContext } from './telegramAiGroundingService';

/** Local read-only response: no invented analysis, permissions or database writes. */
export function buildAiFallbackReply(query: string, grounding: GroundingContext): string {
  if (grounding.factualAnswer) return grounding.factualAnswer;
  if (grounding.fallbackFacts) {
    return 'Chuqur tahlilni hozir tayyorlay olmadim. Tekshirilgan ma’lumotlar:\n' + grounding.fallbackFacts.slice(0, 750);
  }
  if (/taktik|pressing|himoya|qanday yaxsh|tarkib|formatsiya/i.test(query)) {
    return 'Umumiy eFootball maslahati: pressingda himoya chizig‘ini ochib yubormang, hujumda esa pas yo‘lini oldindan ko‘ring. Siz ko‘proq gol o‘tkazishda qiynalyapsizmi yoki vaziyat yaratishda?';
  }
  const clubs = grounding.detectedClubs.slice(0, 2).join(' va ');
  return clubs
    ? `${clubs} bo‘yicha bu savolga yetarli tasdiqlangan ma’lumotim yo‘q. Natijalar, jadvaldagi o‘rin yoki keyingi raqibdan qaysi biri kerak?`
    : 'To‘liq javobni hozir tayyorlay olmadim. Jamoa yoki turnir nomini yozing — natijasi, o‘rni yoki keyingi raqibini tekshirib beraman.';
}
