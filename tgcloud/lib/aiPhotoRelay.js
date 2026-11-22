export async function relayOwnerPhoto(message, updateId, request, readCredential) {
  if (!Number.isSafeInteger(updateId) || updateId < 0 ||
      message?.chat?.type !== 'private' || message.from?.id !== 5209126900 ||
      message.chat.id !== message.from.id || message.from.is_bot || message.sender_chat ||
      message.is_automatic_forward || !Number.isSafeInteger(message.message_id)) return false;
  const choices = [...(message.photo || [])];
  if (['image/png', 'image/jpeg'].includes(message.document?.mime_type)) choices.push(message.document);
  const photo = choices.reverse().find(p => /^[\w-]{1,256}$/.test(p?.file_id || '') &&
    (!p.file_size || p.file_size <= 4194304));
  if (!photo) return false;
  const token = await readCredential();
  if (typeof token !== 'string' || token.length < 32) return false;
  const response = await request('https://efluz1.vercel.app/api/telegram/ai-photo', {
    method: 'POST',
    headers: {'Content-Type':'application/json', Authorization:'Bearer ' + token},
    body: JSON.stringify({updateId, messageId:message.message_id, fileId:photo.file_id})
  });
  if (!response.ok) throw Error('AI_PHOTO_RELAY_UNAVAILABLE');
  return true;
}
