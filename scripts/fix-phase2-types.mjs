import fs from 'node:fs';
const path = 'src/server/services/telegramNotificationQueue.ts';
let source = fs.readFileSync(path, 'utf8');
const anchor = '  recipients: BroadcastRecipientStatus[];\n}';
const replacement = '  recipients: BroadcastRecipientStatus[];\n  bodyIsHtml?: boolean;\n  replyMarkup?: any;\n}';
if (!source.includes('recipients: BroadcastRecipientStatus[];\n  bodyIsHtml?: boolean;')) {
  if (!source.includes(anchor)) throw new Error('TelegramBroadcastRecord interface patch point missing');
  source = source.replace(anchor, replacement);
  fs.writeFileSync(path, source);
}
console.log('PHASE2_TYPE_FIX_APPLIED');
