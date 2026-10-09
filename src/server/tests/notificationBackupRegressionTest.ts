import assert from 'node:assert/strict';
import { persistBackupNotification, recoverBackupNotifications, getNotificationBackupClient, SMART_ENQUEUE_SCRIPT } from '../services/notificationBackupQueue';
import { resolveRedisConfig } from '../readModel/redisConfig';

const records = new Map<string, any>();
const pending = new Set<string>();
const broadcasts = new Set<string>();
let primaryDown = true;
let losePrimaryReply = false;
let loseBackupAck = false;
let enqueued = 0;
const backup: any = {
  eval: async (script: string, _keys: string[], args: any[]) => {
    const id = args[0];
    if (script.includes('HSETNX')) {
      if (!records.has(id)) records.set(id, JSON.parse(args[1]));
      pending.add(id);
    } else {
      if (loseBackupAck) throw Error('backup delete failed');
      records.delete(id); pending.delete(id);
    }
    return 1;
  },
  zrange: async (_key: string, start: number, end: number) => [...pending].slice(start, end + 1),
  hget: async (_key: string, id: string) => records.get(id),
};
const primary: any = {
  eval: async (script: string, _keys: string[], args: any[]) => {
    assert.equal(script, SMART_ENQUEUE_SCRIPT);
    if (primaryDown) throw Error('primary unavailable');
    if (broadcasts.has(args[1])) return 0;
    broadcasts.add(args[1]); enqueued++;
    if (losePrimaryReply) throw Error('response lost after commit');
    return 1;
  },
};
const envelope = { broadcastId: 'smart-1', dedupeKey: 'dedupe-1', record: '{}', job: '{}' };
assert.equal(await persistBackupNotification(envelope, backup), true);
assert.equal(await persistBackupNotification(envelope, backup), true);
assert.equal(pending.size, 1);
await assert.rejects(recoverBackupNotifications(25, primary, backup));
assert.equal(pending.size, 1);
primaryDown = false; losePrimaryReply = true;
await assert.rejects(recoverBackupNotifications(25, primary, backup));
assert.equal(pending.size, 1); assert.equal(enqueued, 1);
losePrimaryReply = false; loseBackupAck = true;
await assert.rejects(recoverBackupNotifications(25, primary, backup));
assert.equal(pending.size, 1); assert.equal(enqueued, 1);
loseBackupAck = false;
assert.equal(await recoverBackupNotifications(25, primary, backup), 1);
assert.equal(pending.size, 0); assert.equal(enqueued, 1);
for (let i = 2; i < 32; i++) await persistBackupNotification({ ...envelope, broadcastId: `smart-${i}` }, backup);
assert.equal(await recoverBackupNotifications(25, primary, backup), 25);
assert.equal(pending.size, 5);
assert.equal(await recoverBackupNotifications(25, primary, backup), 5);
assert.equal(pending.size, 0);
assert.equal(await persistBackupNotification(envelope, null), false);
assert.equal(resolveRedisConfig({ NOTIFICATION_BACKUP_REDIS_REST_URL: 'https://backup.invalid', NOTIFICATION_BACKUP_REDIS_REST_TOKEN: 'fake' }), null);
process.env.UPSTASH_REDIS_REST_URL = 'https://primary.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake';
process.env.NOTIFICATION_BACKUP_REDIS_REST_URL = 'https://primary.invalid';
process.env.NOTIFICATION_BACKUP_REDIS_REST_TOKEN = 'fake';
assert.equal(getNotificationBackupClient(), null);
console.log('PASS backup outage/recovery, lost replies, duplicate retry, bounded multi-batch replay and independent configuration. Mock storage; no network or Firestore reads.');
