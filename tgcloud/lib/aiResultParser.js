// Safe, provider-free fallback for the Serverless AI result flow.
// It only creates a proposal; it never writes a fixture or standings.
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const scorePattern = /(?:^|\s)(\d{1,2})\s*[-–—:]\s*(\d{1,2})(?:\s|$)/;

export function parseScoreText(input) {
  if (typeof input !== 'string' || input.trim().length < 3 || input.length > 500) return null;
  const text = clean(input);
  const match = text.match(scorePattern);
  if (!match) return null;
  const homeScore = Number(match[1]);
  const awayScore = Number(match[2]);
  if (homeScore > 99 || awayScore > 99) return null;

  const before = clean(text.slice(0, match.index));
  const after = clean(text.slice((match.index || 0) + match[0].length));
  const home = before.replace(/^(?:hisob|natija|score)\s*[:：-]?\s*/i, '').trim();
  const away = after.replace(/^(?:vs|v|—|-|:)?\s*/i, '').trim();
  if (!home || !away || home.length > 100 || away.length > 100) return null;
  return { home, away, homeScore, awayScore, source: 'text-fallback', needsConfirmation: true };
}

export function aiProviderStatus() {
  return { enabled: false, mode: 'safe-text-fallback', provider: null, writesResults: false };
}
