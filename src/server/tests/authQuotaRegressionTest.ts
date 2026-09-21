import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { authRouter } from '../routes/auth.routes';
import { meRouter } from '../routes/me.routes';
import { authMiddleware } from '../middleware/authMiddleware';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { parseFirestoreError } from '../firebase/firestoreErrorHandler';
import { resetMemoryRedisStore, ReadModelNotWarmedError, redisSetRaw, ReadModelKeys } from '../readModel/readModelStore';

async function main() {
  process.env.TELEGRAM_BOT_TOKEN = 'isolated-test-token';
  process.env.SESSION_SECRET = 'isolated-session-secret-32-bytes';
  await initDatabase();
  resetMemoryRedisStore();
  const db = getFirestoreDb();
  const originalCollection = db.collection.bind(db);
  let occupancyReads = 0;
  db.collection = ((name: string) => {
    if (name === COLLECTIONS.CLUB_OCCUPANCIES) {
      occupancyReads++;
      throw Object.assign(new Error('RESOURCE_EXHAUSTED: quota exceeded'), { code: 8 });
    }
    return originalCollection(name);
  }) as any;
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now()/1000)), user: JSON.stringify({ id: 987654321, first_name: 'Isolated' }) });
  const message = [...params].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256',secret).update(message).digest('hex'));
  try {
    const login = await fetch(base+'/api/auth/telegram', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({initData:params.toString()}) });
    assert.equal(login.status,200);
    const body = await login.json() as any;
    assert.equal(body.success,true);
    assert.ok(body.token);
    assert.equal(body.currentClubStatus,'unavailable');
    assert.equal(body.degraded,true);
    assert.equal(firestoreCircuitBreaker.getStatus().state,'OPEN');
    const me = await fetch(base+'/api/me', {headers:{Authorization:`Bearer ${body.token}`}});
    assert.equal(me.status,200);
    assert.equal((await me.json() as any).currentClubStatus,'unavailable');
    assert.equal(occupancyReads,1,'Repeated profile read must not retry exhausted Firestore');
    const bad = await fetch(base+'/api/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:params.toString().replace('987654321','987654322')})});
    assert.equal(bad.status,401);
    assert.equal((await fetch(base+'/api/me')).status,401);
    assert.equal(parseFirestoreError(new ReadModelNotWarmedError()).httpStatus,503);
    await redisSetRaw(ReadModelKeys.clubsWithOwners(), {data:[{id:'club-barcelona',ownerUserId:'user-987654321',ownerUsername:'Isolated',isOccupied:true}]});
    const restored = await fetch(base+'/api/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:params.toString()})});
    const restoredBody = await restored.json() as any;
    assert.equal(restored.status,200);
    assert.equal(restoredBody.currentClub.id,'club-barcelona');
    assert.equal(restoredBody.currentClubStatus,'resolved');
    console.log('PASS: signed Telegram login and /me survive missing snapshot; quota circuit opens; invalid auth rejected; cached ownership restored');
  } finally { server.close(); db.collection = originalCollection; }
}
main().catch(error => { console.error(error); process.exitCode=1; });
