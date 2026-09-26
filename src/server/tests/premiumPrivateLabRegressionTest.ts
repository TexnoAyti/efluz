import assert from 'node:assert/strict';
import {
  PREMIUM_PRICE_STARS,
  computeCareerStatsFromFixtures,
  isPremiumPublicEnabled,
  makePremiumPayload,
  parsePremiumPayload,
} from '../services/premiumService';

function run() {
  assert.equal(PREMIUM_PRICE_STARS, 89, 'Premium price must remain 89 Telegram Stars');
  assert.equal(isPremiumPublicEnabled(), false, 'Premium must stay private unless explicitly enabled');

  const payload = makePremiumPayload('orderABC123');
  assert.equal(payload, 'eflp:orderABC123');
  assert.equal(parsePremiumPayload(payload), 'orderABC123');
  assert.equal(parsePremiumPayload('other:orderABC123'), null);
  assert.equal(parsePremiumPayload('eflp:bad/order'), null);

  const rows = [
    { id: '1', competition_id: 'comp-premier-league-2026', home_club_id: 'club-a', away_club_id: 'club-b', home_score: 3, away_score: 1 },
    { id: '2', competition_id: 'comp-premier-league-2026', home_club_id: 'club-c', away_club_id: 'club-a', home_score: 1, away_score: 1 },
    { id: '3', competition_id: 'comp-fa-cup-2026', home_club_id: 'club-a', away_club_id: 'club-d', home_score: 2, away_score: 0 },
    { id: '4', competition_id: 'comp-fa-cup-2026', home_club_id: 'club-e', away_club_id: 'club-a', home_score: 4, away_score: 1 },
  ];

  const result = computeCareerStatsFromFixtures(rows, 'club-a');
  assert.deepEqual(result.form, ['W', 'D', 'W', 'L']);
  assert.equal(result.overall.matches, 4);
  assert.equal(result.overall.wins, 2);
  assert.equal(result.overall.draws, 1);
  assert.equal(result.overall.losses, 1);
  assert.equal(result.overall.goalsFor, 7);
  assert.equal(result.overall.goalsAgainst, 6);
  assert.equal(result.overall.goalDifference, 1);
  assert.equal(result.overall.points, 7);
  assert.equal(result.overall.winRate, 50);
  assert.equal(result.overall.cleanSheets, 1);
  assert.equal(result.overall.longestUnbeatenRun, 3);
  assert.equal(result.overall.longestWinStreak, 1);
  assert.equal(result.competitions.length, 2);

  const league = result.competitions.find((item) => item.competitionId === 'comp-premier-league-2026');
  assert.ok(league);
  assert.equal(league!.matches, 2);
  assert.equal(league!.wins, 1);
  assert.equal(league!.draws, 1);
  assert.equal(league!.losses, 0);

  console.log('Premium Private Lab regression: PASS');
}

run();
