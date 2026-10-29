import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { ReadModelKeys, redisSetRaw, getFreshKey, getLkgKey } from '../readModel/readModelStore';
import { planTopicResult } from '../services/telegramTopicResults';
import { createAiTournamentReader } from '../services/telegramAiDataService';
import { detectAiCupStage, type AiCupStage } from '../services/telegramAiCupStage';
import { isShorthandAiResultRequest } from '../services/telegramAiAdminLanguage';

await initDatabase();
const bridge = await startMockUpstashBridge();
const season = 'season-2026-27', cup = 'comp-dfb-pokal-2026';
const signal = new AbortController().signal;
const clubs = [
  { id: 'club-wolfsburg', name: 'VfL Wolfsburg', ownerUserId: 'user-1001', leagueId: 'league-bundesliga' },
  { id: 'club-union-berlin', name: '1. FC Union Berlin', ownerUserId: 'user-1002', leagueId: 'league-bundesliga' },
  ...['SC Freiburg', '1. FC Heidenheim', 'Holstein Kiel', 'FC Bayern München', 'SV Werder Bremen', 'Bayer 04 Leverkusen'].map((name, i) => ({
    id: ['club-freiburg', 'club-heidenheim', 'club-holstein-kiel', 'club-bayern', 'club-werder-bremen', 'club-leverkusen'][i],
    name, ownerUserId: 'user-' + (2001 + i), leagueId: 'league-bundesliga',
  })),
];
const stages: Array<[AiCupStage, string, string]> = [
  ['preliminary', 'Preliminary Round', 'saralash bosqichi'],
  ['round16', 'Round of 16', 'nimchorak final'],
  ['quarter', 'Quarter-Finals', 'chorak final'],
  ['semi', 'Semi-Finals', 'yarim final'],
  ['final', 'Final', 'final'],
];
const fixtures = stages.map(([stage, roundName], index) => ({
  id: 'german-' + stage, competitionId: cup, seasonId: season, matchday: index + 1,
  roundName, homeClubId: clubs[0].id, awayClubId: clubs[1].id,
  status: 'SCHEDULED', updatedAt: 'v1',
}));
try {
  await redisSetRaw(ReadModelKeys.competitions(season), { data: [
    { id: 'comp-fa-cup-2026', name: 'FA Cup', type: 'KNOCKOUT', seasonId: season, leagueId: 'league-premier-league' },
    { id: cup, name: 'DFB-Pokal', type: 'KNOCKOUT', seasonId: season, leagueId: 'league-bundesliga' },
    { id: 'comp-bundesliga-2026', name: 'Bundesliga', type: 'LEAGUE', seasonId: season, leagueId: 'league-bundesliga' },
  ] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: clubs });
  await redisSetRaw(ReadModelKeys.competitionFixtures(cup, season), { data: fixtures });
  await redisSetRaw(`efluz:v1:season:${season}:fixture-tombstones`, { data: [] });
  // Reproduce the screenshot's data failure: another country's cup has only
  // an old fallback, while DFB-Pokal itself is complete and fresh.
  const unrelatedKey = ReadModelKeys.competitionFixtures('comp-fa-cup-2026', season);
  await redisSetRaw(unrelatedKey, { data: [] });
  bridge.store.delete(getFreshKey(unrelatedKey));
  assert.equal((await createAiTournamentReader(signal).read({ dataset: 'fixtures', competition: 'comp-fa-cup-2026' }) as any).stale, true);
  for (const [stage, , phrase] of stages) {
    assert.equal(detectAiCupStage(stage), stage);
    assert.equal(detectAiCupStage(phrase), stage);
    const result: any = await createAiTournamentReader(signal).read({ dataset: 'fixtures', competition: cup, stage });
    assert.equal(result.error, undefined);
    assert.equal(result.complete, true);
    assert.deepEqual(result.data.map((f: any) => f.id), ['german-' + stage]);
    for (const [text, sender] of [
      [`VfL Wolfsburg 3-2 1. FC Union Berlin Germaniya kubogi ${phrase}`, 1001],
      [`1. FC Union Berlin 2-3 VfL Wolfsburg Germaniya kubogi ${phrase}`, 1002],
    ] as const) {
      assert.equal(isShorthandAiResultRequest(text), true, text);
      const plan = await planTopicResult(text, sender, 8, signal);
      assert.equal(plan?.plan.targetId, 'german-' + stage, text);
      assert.equal(plan?.plan.body.homeScore, 3);
      assert.equal(plan?.plan.body.awayScore, 2);
    }
  }
  await assert.rejects(planTopicResult('Wolfsburg 3-2 Union Berlin Germaniya kubogi yarim final', 9999, 8, signal), /klub biriktirilganligi/);
  await assert.rejects(planTopicResult('Wolfsburg 3-2 Union Berlin Germaniya kubogi yarim final', 1001, 5, signal), /boshqa turnir/);
  await assert.rejects(planTopicResult('Wolfsburg 1-1 Union Berlin Germaniya kubogi yarim final', 1001, 8, signal), /penalti/);
  const reports = [
    ['SC Freiburg 0:5 FC Heidenheim', 2001, 0, 5],
    ['Holstein Kiel 1:0 FC Bayern München', 2003, 1, 0],
    ['Werder 3:0 Leverkusen', 2005, 3, 0],
  ] as const;
  const screenshotGames = reports.map((_, i) => ({
    ...fixtures[0], id: 'screenshot-' + i,
    homeClubId: clubs[2 + i * 2].id, awayClubId: clubs[3 + i * 2].id,
  }));
  await redisSetRaw(ReadModelKeys.competitionFixtures(cup, season), { data: [...fixtures, ...screenshotGames] });
  for (const [i, [text, sender, homeScore, awayScore]] of reports.entries()) {
    const planned = await planTopicResult(text, sender, 8, signal);
    assert.equal(planned?.plan.targetId, 'screenshot-' + i, text);
    assert.equal(planned?.plan.body.homeScore, homeScore);
    assert.equal(planned?.plan.body.awayScore, awayScore);
  }
  assert.equal((await planTopicResult('0:5', 2001, 8, signal))?.plan.targetId, 'screenshot-0');
  // Missing the relevant cup must still fail closed, even with unrelated data.
  const germanKey = ReadModelKeys.competitionFixtures(cup, season);
  bridge.store.delete(getFreshKey(germanKey));
  await assert.rejects(planTopicResult(reports[0][0], 2001, 8, signal), /O‘yinlar ma’lumoti hozir to‘liq tasdiqlanmadi/);
  bridge.store.delete(getLkgKey(germanKey));
  await assert.rejects(planTopicResult(reports[0][0], 2001, 8, signal), /O‘yinlar ma’lumoti hozir to‘liq tasdiqlanmadi/);
  for (const text of ['12:30', '1-1', '2026-10-29', '1. FC Union Berlin 2-3 Wolfsburg bo‘lsa nima bo‘ladi?', '1. FC Union Berlin 2-3 Wolfsburg kiritma']) {
    assert.equal(isShorthandAiResultRequest(text), false, text);
  }
  console.log('PASS DFB-Pokal score planning through real snapshot and fixture readers: numbered club names on either side, every canonical stage, away-owner orientation, wrong-topic and ownership guards; no result writes or Telegram messages');
} finally {
  await bridge.close();
}
