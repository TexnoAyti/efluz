import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync('src/server/services/smartNotificationService.ts', 'utf8');
assert(source.includes("status === 'PENDING_CONFIRMATION'"), 'missing verification lifecycle');
assert(source.includes("eventId: `${eventBase}:verify:${actorUserId}`"), 'verification event must target the opponent');
assert(source.includes("title: '⚡ Natijani tasdiqlang'"), 'verification message missing');
assert(source.includes("status === 'CONFIRMED'"), 'confirmed lifecycle missing');
assert(source.includes("eventId: `${eventBase}:confirmed`"), 'confirmed event missing');
assert(source.includes("status === 'DISPUTED'"), 'dispute lifecycle missing');
assert(source.includes("eventId: `${eventBase}:disputed`"), 'dispute event missing');
assert(source.includes("replyMarkup: await fixtureReplyMarkup(fixture, actorUserId)"), 'verification must include opponent/result-topic actions');
console.log('SMART_RESULT_LIFECYCLE_CONTRACT_PASS');
