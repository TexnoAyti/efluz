// handlers/message.js — runs on each `message` update. The file name is the
// Telegram update type; the platform calls the default export with the matching
// payload (here, a Message). The full update is available as `ctx.update`.

import { api } from 'sdk';

// Safe migration probe. It deliberately does not answer normal EFLUZ messages
// until the Serverless path has passed parity checks and is explicitly enabled.
export default async function (message) {
  if (message.text !== '/serverless-check') return;
  await api.sendMessage({
    chat_id: message.chat.id,
    text: 'EFLUZ Serverless migratsiya kanali tayyor. Asosiy bot oqimi hali o‘zgarmadi.',
  });
}
