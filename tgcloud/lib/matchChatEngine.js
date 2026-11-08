import {validateChatInput} from './chatInput.js';

// Dependency-injected for SQLite integration tests and Telegram SDK use.
// The session identity comes exclusively from verified Telegram initData.
export async function runMatchChat(db,input,telegramId){
  const request=validateChatInput(input,telegramId);
  const params={':match':request.matchId,':user':request.telegramId};
  const access=await db.get(
    'SELECT writable FROM efl_match_access WHERE match_id = :match AND (home_telegram_id = :user OR away_telegram_id = :user)',params
  );
  if(!access)throw Error('CHAT_FORBIDDEN');
  if(request.action==='send'){
    if(!access.writable)throw Error('CHAT_READ_ONLY');
    const values={...params,':client':request.clientId,':body':request.text,':now':Date.now()};
    // The database rechecks permission atomically with the INSERT.
    // A retry with the same client ID is harmless; different content is denied.
    await db.run(`INSERT INTO efl_match_messages (match_id,sender_telegram_id,client_id,body,created_at)
      SELECT :match,:user,:client,:body,:now FROM efl_match_access
      WHERE match_id=:match AND writable=1
        AND (home_telegram_id=:user OR away_telegram_id=:user)
      ON CONFLICT(client_id) DO NOTHING`,values);
    // Telegram SDK db.run does not promise a rowsAffected property.
    // Always verify the stored record, even when a write appears successful.
    const persisted=await db.get(
      `SELECT id,match_id AS matchId,sender_telegram_id AS senderTelegramId,
        body FROM efl_match_messages WHERE client_id=:client`,
      {':client':request.clientId}
    );
    if(!persisted || persisted.matchId!==request.matchId||
       String(persisted.senderTelegramId)!==request.telegramId||
       persisted.body!==request.text)throw Error('CHAT_WRITE_CONFLICT');
  }
  const messages=await db.all(`SELECT m.id,m.body AS text,
    m.sender_telegram_id AS senderTelegramId,m.created_at AS createdAt
    FROM efl_match_messages m JOIN efl_match_access a ON a.match_id=m.match_id
    WHERE m.match_id=:match AND m.id>:after
      AND (a.home_telegram_id=:user OR a.away_telegram_id=:user)
    ORDER BY m.id ASC LIMIT 100`,
    {...params,':after':request.after}
  );
  return {messages,readOnly:!access.writable,nextCursor:messages.at(-1)?.id??request.after};
}
