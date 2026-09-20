import assert from 'node:assert/strict';
import { once } from 'node:events';
import app from '../app';

async function main() {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const unsafeCrest = await fetch(`${base}/api/clubs/crest-proxy?url=${encodeURIComponent('http://127.0.0.1/internal')}`);
    assert.equal(unsafeCrest.status, 400);

    const webhook = await fetch(`${base}/api/telegram/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ update_id: 1 }),
    });
    assert.equal(webhook.status, 503);

    const probe = await fetch(`${base}/api/health/probe`, { method: 'POST' });
    assert.equal(probe.status, 401);

    const cors = await fetch(`${base}/api/health`, {
      method: 'OPTIONS', headers: { origin: 'https://attacker.example' },
    });
    assert.equal(cors.status, 403);

    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-powered-by'), null);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.match(health.headers.get('content-security-policy') || '', /default-src 'self'/);
    console.log('PASS: SSRF allowlist, webhook fail-closed, protected probe, CORS and security headers');
  } finally {
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
