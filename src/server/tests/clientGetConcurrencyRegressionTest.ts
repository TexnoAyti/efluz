import assert from 'node:assert/strict';
import { api, invalidateClientCache, setSessionToken, setTelegramInitData } from '../../lib/api';

const originalFetch = globalThis.fetch;
let active = 0;
let peak = 0;
let total = 0;
const pending: Array<() => void> = [];
try {
  setSessionToken(null);
  setTelegramInitData(null);
  invalidateClientCache();
  globalThis.fetch = (async () => {
    active++;
    total++;
    peak = Math.max(peak, active);
    await new Promise<void>(resolve => pending.push(resolve));
    active--;
    return new Response(JSON.stringify({clubs:[]}), {status:200,headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  const readRequests = Array.from({length:10}, (_,i) => api.getLeagueClubs('test-league-'+i, 'season-2026-27', true));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(total, 4, 'Dashboard launch starts at most four GETs');
  assert.equal(peak, 4);
  while (pending.length || total < 10) {
    const next = pending.shift();
    if (next) next();
    await new Promise(resolve => setTimeout(resolve, 3));
  }
  await Promise.all(readRequests);
  assert.equal(total, 10, 'All requests eventually execute; none are discarded');
  assert.ok(peak <= 4, 'Concurrent GET budget is enforced');
  console.log('PASS dashboard read concurrency: 10 requests complete with <=4 active fetches');
} finally {
  while (pending.length) pending.shift()?.();
  globalThis.fetch = originalFetch;
  setSessionToken(null); setTelegramInitData(null); invalidateClientCache();
}
