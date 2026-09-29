import assert from 'node:assert/strict';
import { telegramMiniAppButton } from '../services/telegramMiniAppButton';

const previousWebApp = process.env.TELEGRAM_WEBAPP_URL;
const previousApp = process.env.APP_URL;
try {
  process.env.TELEGRAM_WEBAPP_URL = 'https://efluz.vercel.app';
  process.env.APP_URL = 'https://other.example';
  assert.deepEqual(telegramMiniAppButton('Mening o‘yinlarim'), {
    text: 'Mening o‘yinlarim',
    web_app: { url: 'https://efluz.vercel.app' },
  });
  assert.equal('url' in telegramMiniAppButton(), false);
  delete process.env.TELEGRAM_WEBAPP_URL;
  assert.equal(telegramMiniAppButton().web_app.url, 'https://other.example');
  console.log('Telegram Mini App notification button: PASS');
} finally {
  if (previousWebApp === undefined) delete process.env.TELEGRAM_WEBAPP_URL;
  else process.env.TELEGRAM_WEBAPP_URL = previousWebApp;
  if (previousApp === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousApp;
}
