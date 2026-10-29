import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { planTopicResult } from '../services/telegramTopicResults';
import { createAiTournamentReader } from '../services/telegramAiDataService';
import { detectAiCupStage, type AiCupStage } from '../services/telegramAiCupStage';
import { isShorthandAiResultRequest } from '../services/telegramAiAdminLanguage';

await initDatabase();
const bridge = await startMockUpstashBridge();
const season = 'season-2026-27', cup = 'comp-dfb-pokal-2026';
const signal = new AbortController().signal;
const clubs = [
  { id: 'club-wolfsburg', name: 'VfL Wolfsburg', ownerUserId: 'user-1001' },
  { id: 'club-union-berlin', name: '1. FC Union Berlin', ownerUserId: 'user-1002' },
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
    { id: cup, name: 'DFB-Pokal', type: 'KNOCKOUT', seasonId: season, leagueId: 'league-bundesliga' },
    { id: 'comp-bundesliga-2026', name: 'Bundesliga', type: 'LEAGUE', seasonId: season, leagueId: 'league-bundesliga' },
  ] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: clubs });
  await redisSetRaw(ReadModelKeys.competitionFixtures(cup, season), { data: fixtures });
  await redisSetRaw(`efluz:v1:season:${season}:fixture-tombstones`, { data: [] });
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
  for (const text of ['12:30', '1-1', '2026-10-29', '1. FC Union Berlin 2-3 Wolfsburg bo‘lsa nima bo‘ladi?', '1. FC Union Berlin 2-3 Wolfsburg kiritma']) {
    assert.equal(isShorthandAiResultRequest(text), false, text);
  }
  console.log('PASS DFB-Pokal score planning through real snapshot and fixture readers: numbered club names on either side, every canonical stage, away-owner orientation, wrong-topic and ownership guards; no result writes or Telegram messages');
} finally {
  await bridge.close();
}
