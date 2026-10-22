import test from 'node:test';
import assert from 'node:assert/strict';
import { previewResponse, installPreviewTransport } from './transport';
import { previewCompetitions, previewFixtures, previewStandings, previewUser } from './data';
const origin = 'https://preview.example';
Object.assign(globalThis, { location: new URL(`${origin}/?designPreview=1`) });
const get = (path: string, init?: RequestInit) => previewResponse(path, init, origin);
test('fail closed for every private or mutating operation, including cross-origin Request objects', () => {
  for (const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS']) assert.equal(get('/api/me',{ method }).status,403);
  for (const path of ['/api/admin/users','/api/auth/telegram','/api/payments','/api/balance','/api/premium','/api/unknown','https://efluz.vercel.app/api/me']) assert.equal(get(path).status,403);
  assert.equal(previewResponse(new Request(`${origin}/api/me`,{ method:'POST' }),{},origin).status,403);
  assert.equal(previewUser.isAdmin,false);
});
test('real catalogue, synthetic populated accounts, fixtures and consistent standings', async () => {
  assert.equal((await get('/api/me').json()).user.id,'design-preview');
  for (const season of ['season-2026-27','season-2025-26']) {
    const comp = previewCompetitions(season)[0];
    assert.equal(previewStandings(comp).length,20);
    assert.equal(previewFixtures(comp).length,190);
    const table = previewStandings(comp);
    assert.equal(table.reduce((n,c) => n+c.goalsFor,0),table.reduce((n,c) => n+c.goalsAgainst,0));
    assert.ok(table.every(c => c.points === 3*c.won+c.drawn && c.played === c.won+c.drawn+c.lost));
    assert.equal(get(`/api/competitions/${comp.id}/standings`).status,200);
  }
});
test('league, club, season and matchday routing', async () => {
  assert.equal((await get('/api/leagues').json()).leagues.length,5);
  assert.equal((await get('/api/clubs/club-arsenal').json()).club.name,'Arsenal');
  const comp=previewCompetitions('season-2026-27')[0];
  const fixtures=(await get(`/api/competitions/${comp.id}/fixtures?matchday=5`).json()).fixtures;
  assert.equal(fixtures.length,10);
  assert.ok(fixtures.every((f:any) => f.matchday===5 && f.status==='SCHEDULED'));
});
test('cup bracket progresses through all rounds with source fixtures and a scheduled final', () => {
  const comp=previewCompetitions('season-2026-27').find(c=>c.type==='KNOCKOUT')!;
  const fixtures=previewFixtures(comp);
  assert.equal(fixtures.length,15);
  const final=fixtures.find(f=>f.roundName==='Final')!;
  assert.equal(final.status,'SCHEDULED');
  assert.ok(fixtures.find(f=>f.id===final.homeSourceFixtureId));
  assert.ok(fixtures.find(f=>f.id===final.awaySourceFixtureId));
});

test('sandbox never falls through to a native transport; missing flag remains anonymous', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalLocation = location;
  const originalBeacon = navigator.sendBeacon;
  try {
    Object.assign(globalThis, { window: {}, location: new URL(origin + '/') });
    installPreviewTransport();
    assert.equal((await window.fetch('/api/me')).status,403);
    Object.assign(globalThis, { location: new URL(origin + '/?designPreview=1') });
    installPreviewTransport();
    assert.equal((await window.fetch('/api/me')).status,200);
    assert.equal((await window.fetch('/api/me',{method:'POST'})).status,403);
    assert.throws(() => new window.XMLHttpRequest());
    assert.throws(() => new window.WebSocket('wss://efluz.vercel.app'));
    assert.equal(navigator.sendBeacon('https://efluz.vercel.app'),false);
    Object.assign(globalThis, { location: new URL('https://efluz.vercel.app/?designPreview=1') });
    installPreviewTransport();
    assert.equal((await window.fetch('/api/me')).status,403);
  } finally {
    if(originalWindow) Object.defineProperty(globalThis,'window',originalWindow);
    else Reflect.deleteProperty(globalThis,'window');
    Object.assign(globalThis, { location: originalLocation });
    navigator.sendBeacon = originalBeacon;
  }
});
