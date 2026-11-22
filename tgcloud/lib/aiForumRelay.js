// Only the signed Telegram handler supplies these updates. Never expose this
// relay through a Mini App endpoint. The receiver owns retry deduplication.
export function forumUpdate(kind, event, updateId) {
  if (!Number.isSafeInteger(updateId) || updateId < 0 ||
      !['message','edited_message','callback_query'].includes(kind)) return null;
  const callback = kind === 'callback_query';
  const message = callback ? event?.message : event;
  const from = event?.from;
  if (message?.chat?.type !== 'supergroup' || message.chat.username?.toLowerCase() !== 'efleagueuz' ||
      !Number.isSafeInteger(message.chat.id) || !Number.isSafeInteger(message.message_thread_id) ||
      !Number.isSafeInteger(message.message_id) || !Number.isSafeInteger(from?.id) ||
      from.id <= 0 || from.is_bot || event.sender_chat || event.is_automatic_forward ||
      event.forward_origin || event.forward_from || event.forward_from_chat) return null;
  if (callback && !/^rs:(approve|reject):[a-f0-9]{24}$/.test(event.data)) return null;
  if (!callback && (typeof message.text !== 'string' || !message.text.trim() ||
      message.text.length > 4096 || message.text.trimStart().startsWith('/'))) return null;
  const sanitized = {
    chat:{id:message.chat.id, type:'supergroup', username:'efleagueuz'},
    message_id:message.message_id, message_thread_id:message.message_thread_id,
    from:message.from, text:message.text, date:message.date, edit_date:message.edit_date
  };
  if (!callback && message.reply_to_message) {
    const reply = message.reply_to_message;
    sanitized.reply_to_message = {message_id:reply.message_id, from:reply.from, text:reply.text};
  }
  return {update_id:updateId, [kind]:callback ? {id:event.id, from, data:event.data, message:sanitized} : sanitized};
}

export async function relayForum(kind, event, updateId, db, request) {
  const update = forumUpdate(kind,event,updateId);
  if (!update) return false;
  const thread = (kind === 'callback_query' ? event.message : event).message_thread_id;
  if (![2,3,4,5,6,7,8,2335,8989,11429,11972].includes(thread)) {
    const assistant = await db.get("SELECT credential FROM efl_ai_photo_relay WHERE target='efluz1-ai-thread'");
    if (String(thread) !== assistant?.credential) return false;
  }
  const config = await db.get("SELECT credential FROM efl_ai_photo_relay WHERE target='efluz1-forum-webhook'");
  if (!config?.credential) return false;
  const response = await request('https://efluz1.vercel.app/api/telegram/webhook',{
    method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':config.credential},
    body:JSON.stringify(update)
  });
  if (!response.ok) throw Error('AI_FORUM_RELAY_UNAVAILABLE');
  return true;
}
