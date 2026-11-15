import assert from 'node:assert/strict';
import test from 'node:test';
import {notificationDeliveryMode} from '../services/notificationDeliveryGate';

test('notification delivery can run alone while all other background workers stay paused',()=>{
  assert.equal(notificationDeliveryMode({
    DISABLE_BACKGROUND_WORKERS:'true',
    ENABLE_NOTIFICATION_DELIVERY_WORKER:'true',
    DATABASE_PROVIDER:'supabase',
    SUPABASE_DATA_NAMESPACE:'production',
  }),'isolated');
});

test('global pause remains fail-closed without the explicit delivery override',()=>{
  assert.equal(notificationDeliveryMode({DISABLE_BACKGROUND_WORKERS:'true'}),'disabled');
});

test('migration freeze and preview can never send production Telegram notices',()=>{
  assert.equal(notificationDeliveryMode({
    MIGRATION_WRITE_FREEZE:'true',
    ENABLE_NOTIFICATION_DELIVERY_WORKER:'true',
  }),'disabled');
  assert.equal(notificationDeliveryMode({
    DATABASE_PROVIDER:'supabase',
    SUPABASE_DATA_NAMESPACE:'preview',
    ENABLE_NOTIFICATION_DELIVERY_WORKER:'true',
  }),'disabled');
});

test('normal production operation keeps the complete worker path',()=>{
  assert.equal(notificationDeliveryMode({
    DISABLE_BACKGROUND_WORKERS:'false',
    DATABASE_PROVIDER:'supabase',
    SUPABASE_DATA_NAMESPACE:'production',
  }),'full');
});
