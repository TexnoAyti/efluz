/** Bounded budgets: longer answers are reserved for analysis and explicit detail requests. */
export interface AiResponsePolicy {
  detailed: boolean;
  maxChars: number;
  maxOutputTokens: number;
  maxToolRounds: number;
  maxReadCalls: number;
  maxReadPages: number;
}

export function getAiResponsePolicy(query: string): AiResponsePolicy {
  const detailed = /batafsil|tahlil|taqqosla|solishtir|qadam[\s-]*ba[\s-]*qadam|to[‘’'`]?liq\s+(?:tushuntir|izoh)|подроб|анализ|сравни|detail|analy[sz]|compar|step[\s-]by[\s-]step/i.test(query);
  return detailed
    ? { detailed, maxChars: 3000, maxOutputTokens: 1200, maxToolRounds: 4, maxReadCalls: 12, maxReadPages: 5 }
    : { detailed, maxChars: 1000, maxOutputTokens: 400, maxToolRounds: 3, maxReadCalls: 8, maxReadPages: 3 };
}

/** Keep Unicode intact and make output truncation visible instead of silently cutting facts. */
export function limitAiReply(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  const suffix = '\n… Javob qisqartirildi.';
  const body = chars.slice(0, Math.max(0, maxChars - Array.from(suffix).length)).join('');
  const boundary = Math.max(body.lastIndexOf('\n'), body.lastIndexOf('. '), body.lastIndexOf(' '));
  return (boundary > body.length * 0.7 ? body.slice(0, boundary).trimEnd() : body) + suffix;
}
