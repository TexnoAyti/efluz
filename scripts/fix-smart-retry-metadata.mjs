import fs from 'node:fs';
const path = 'src/server/services/smartNotificationService.ts';
let s = fs.readFileSync(path, 'utf8');
const ifaceAnchor = '  recipients: SmartRecipientStatus[];\n}';
if (!s.includes('recipients: SmartRecipientStatus[];\n  bodyIsHtml?: boolean;')) {
  if (!s.includes(ifaceAnchor)) throw new Error('SmartBroadcastRecord anchor missing');
  s = s.replace(ifaceAnchor, '  recipients: SmartRecipientStatus[];\n  bodyIsHtml?: boolean;\n  replyMarkup?: any;\n}');
}
const recordAnchor = "    recipients: [{\n      userId: recipient.userId,\n      username: recipient.username || 'player',\n      displayName: recipient.displayName || recipient.username || 'EFL Player',\n      status: 'PENDING',\n      retryCount: 0,\n    }],\n  };";
if (!s.includes('bodyIsHtml: true,\n    replyMarkup: params.replyMarkup,')) {
  if (!s.includes(recordAnchor)) throw new Error('Smart broadcast record creation anchor missing');
  s = s.replace(recordAnchor, "    recipients: [{\n      userId: recipient.userId,\n      username: recipient.username || 'player',\n      displayName: recipient.displayName || recipient.username || 'EFL Player',\n      status: 'PENDING',\n      retryCount: 0,\n    }],\n    bodyIsHtml: true,\n    replyMarkup: params.replyMarkup,\n  };");
}
fs.writeFileSync(path, s);
console.log('SMART_RETRY_METADATA_PATCHED');
