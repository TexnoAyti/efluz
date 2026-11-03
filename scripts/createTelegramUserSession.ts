import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH?.trim();
if (!Number.isInteger(apiId) || !apiHash) throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH are required');

const terminal = readline.createInterface({ input, output });
const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

try {
  await client.start({
    phoneNumber: () => terminal.question('Telegram phone number: '),
    phoneCode: () => terminal.question('Telegram login code: '),
    password: () => terminal.question('Telegram 2FA password (if enabled): '),
    onError: (error) => console.error('[TELEGRAM LOGIN]', error.message),
  });
  console.log('\nTELEGRAM_USER_SESSION=');
  console.log(client.session.save());
  console.log('\nStore this value only in the worker host secret settings.');
} finally {
  terminal.close();
  await client.disconnect();
}
