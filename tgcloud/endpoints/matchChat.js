import { db, EndpointError } from 'sdk';
import { validateChatInput } from '../lib/chatInput.js';

export default async function (input, ctx) {
  let request;
  try { request = validateChatInput(input, ctx?.initData?.user?.id); }
  catch (error) { throw new EndpointError('Chat so‘rovini tekshiring.', { code: error.message }); }
  const params = { ':match': request.matchId, ':user': request.telegramId };
  const access = await db.get('SELECT writable FROM efl_match_access WHERE match_id = :match AND (home_telegram_id = :user OR away_telegram_id = :user)', params);
  if (!access) throw new EndpointError('Bu o‘yinning chatiga ruxsat yo‘q.', { code: 'CHAT_FORBIDDEN' });
  if (request.action === 'send') {
    if (!access.writable) throw new EndpointError('Chat faqat o‘qish holatida.', { code: 'CHAT_READ_ONLY' });
    // Re-check permission in the write itself; duplicate retries insert nothing.
    const inserted = await db.run(`INSERT INTO efl_match_messages (match_id, sender_telegram_id, client_id, body, created_at)
      SELECT :match, :user, :client, :body, :now FROM efl_match_access
      WHERE match_id = :match AND writable = 1 AND (home_telegram_id = :user OR away_telegram_id = :user)
      ON CONFLICT(client_id) DO NOTHING`, { ...params, ':client': request.clientId, ':body': request.text, ':now': Date.now() });
    if (!inserted.rowsAffected) {
      const previous = await db.get('SELECT id FROM efl_match_messages WHERE client_id = :client AND match_id = :match AND sender_telegram_id = :user AND body = :body', { ...params, ':client': request.clientId, ':body': request.text });
      if (!previous) throw new EndpointError('Xabar yuborilmadi. Chatni qayta oching.', { code: 'CHAT_WRITE_CONFLICT' });
    }
  }
  const messages = await db.all(`SELECT m.id, m.body AS text, m.sender_telegram_id AS senderTelegramId, m.created_at AS createdAt
    FROM efl_match_messages m JOIN efl_match_access a ON a.match_id = m.match_id
    WHERE m.match_id = :match AND m.id > :after AND (a.home_telegram_id = :user OR a.away_telegram_id = :user)
    ORDER BY m.id ASC LIMIT 100`, { ...params, ':after': request.after });
  return { messages, readOnly: !access.writable, nextCursor: messages.at(-1)?.id ?? request.after };
}
