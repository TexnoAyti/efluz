export function validateChatInput(input, telegramId) {
  if (!telegramId || !/^\d+$/.test(String(telegramId))) throw new Error('AUTH_REQUIRED');
  if (!input || typeof input.matchId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(input.matchId)) throw new Error('INVALID_MATCH');
  const after = input.after ?? 0;
  if (!Number.isSafeInteger(after) || after < 0) throw new Error('INVALID_CURSOR');
  const action = input.action ?? 'list';
  if (!['list', 'send'].includes(action)) throw new Error('INVALID_ACTION');
  const result = { matchId: input.matchId, telegramId: String(telegramId), after, action };
  if (action === 'send') {
    if (typeof input.text !== 'string' || !input.text.trim() || Array.from(input.text.trim()).length > 2000) throw new Error('INVALID_MESSAGE');
    if (typeof input.clientId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.clientId)) throw new Error('INVALID_CLIENT_ID');
    result.text = input.text.trim();
    result.clientId = `${telegramId}:${input.clientId}`;
  }
  return result;
}
