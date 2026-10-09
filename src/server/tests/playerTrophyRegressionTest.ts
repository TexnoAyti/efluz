import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Fixture, StandingsRow } from '../../types';
import { seasonLabel, trophyId, type TrophyRecord } from '../../types/trophies';
import { TrophyCabinetView } from '../../components/PlayerTrophyCabinet';
import { SEED_CLUBS } from '../db/seed';
import { getFirestoreDb } from '../firebase/admin';
import { ReadModelKeys, redisSetRaw, resetMemoryRedisStore, refreshChangedFixtureReadModel, invalidateDataset } from '../readModel/readModelStore';
import { clearMemoryTrophies, getPlayerTrophyCabinet, mergePlayerTrophies, reconcileTrophy, syncCompetitionTrophy } from '../services/playerTrophyService';
import { getSeasonTrophies } from '../services/seasonInsightsService';
import { seasonInsightsRouter } from '../routes/seasonInsights.routes';

async function main() {
  assert.equal(process.env.FIREBASE_FORCE_LOCAL_FALLBACK, 'true');
  resetMemoryRedisStore(); clearMemoryTrophies();
  const seasonId = 'season-2026-27';
  const cupId = 'comp-fa-cup-2026';
  const home = SEED_CLUBS.find(item => item.leagueId === 'league-premier-league')!;
  const away = SEED_CLUBS.filter(item => item.leagueId === 'league-premier-league')[1];
  const fixture: Fixture = { id: 'trophy-test-final', competitionId: cupId, seasonId, roundName: 'Final', matchday: 6,
    homeClubId: home.id, awayClubId: away.id, status: 'CONFIRMED', homeScore: 2, awayScore: 1,
    winnerClubId: home.id, resultConfirmedAt: '2026-10-07T10:00:00.000Z', scheduledAt: '',
    createdAt: '2026-10-07T09:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z' };
  const owners = [{ ...home, ownerUserId: 'winner-a', ownerUsername: 'player_a' }, { ...away, ownerUserId: 'winner-b', ownerUsername: 'player_b' }];
  await redisSetRaw(ReadModelKeys.clubsWithOwners(seasonId), { data: owners });
  const publish = async (item: Fixture) => {
    await redisSetRaw(ReadModelKeys.competitionFixtures(cupId, seasonId), { data: [item] });
    await redisSetRaw(ReadModelKeys.adminFixtures(seasonId), { data: [item] });
    await getFirestoreDb().collection('fixtures').doc(item.id).set(item);
    await refreshChangedFixtureReadModel(item.id);
  };
  await publish(fixture);
  let cabinet = await getPlayerTrophyCabinet('winner-a', seasonId);
  assert.equal(cabinet.trophies.length, 1);
  assert.equal(cabinet.trophies[0].competitionName, 'FA Cup');
  assert.equal((await getPlayerTrophyCabinet('winner-b', seasonId)).trophies.length, 0);
  // The authoritative result -> read-model -> trophy cabinet flow is idempotent.
  await refreshChangedFixtureReadModel(fixture.id);
  assert.equal((await getPlayerTrophyCabinet('winner-a', seasonId)).trophies.length, 1);

  owners[0].ownerUserId = 'new-club-owner';
  await redisSetRaw(ReadModelKeys.clubsWithOwners(seasonId), { data: owners });
  await syncCompetitionTrophy(cupId, seasonId, fixture);
  assert.equal((await getPlayerTrophyCabinet('winner-a', seasonId)).trophies.length, 1, 'Club transfer must not move an earned trophy');
  assert.equal((await getPlayerTrophyCabinet('new-club-owner', seasonId)).trophies.length, 0);

  const reopened = { ...fixture, status: 'SCHEDULED' as const, homeScore: null, awayScore: null, winnerClubId: null,
    updatedAt: '2026-10-07T11:00:00.000Z' };
  await publish(reopened);
  assert.equal((await getPlayerTrophyCabinet('winner-a', seasonId)).trophies.length, 0, 'Reopened final must revoke its trophy');
  const corrected = { ...fixture, homeScore: 0, awayScore: 1, winnerClubId: away.id,
    resultConfirmedAt: '2026-10-07T12:00:00.000Z', updatedAt: '2026-10-07T12:00:00.000Z' };
  await publish(corrected);
  assert.equal((await getPlayerTrophyCabinet('winner-b', seasonId)).trophies.length, 1);
  assert.equal((await getPlayerTrophyCabinet('winner-a', seasonId)).trophies.length, 0);

  const trophy: TrophyRecord = { ...cabinet.trophies[0] };
  const record = reconcileTrophy(null, trophy, fixture.updatedAt)!;
  assert.deepEqual(reconcileTrophy(record, null, '2026-10-07T09:00:00.000Z'), record, 'Older revocation cannot undo a trophy');
  assert.equal(reconcileTrophy(record, { ...trophy, winnerUserId: undefined }, corrected.updatedAt)?.winnerUserId, 'winner-a');
  const changedChampion = reconcileTrophy(record, { ...trophy, clubId: away.id, winnerUserId: 'winner-b' }, corrected.updatedAt)!;
  assert.equal(changedChampion.winnerUserId, 'winner-b');
  const older: TrophyRecord = { ...trophy, seasonId: 'season-2025-26' };
  const history = { records: [record, reconcileTrophy(null, older, fixture.updatedAt)!], archives: [{ seasonId: older.seasonId, trophies: [older] }] };
  const merged = mergePlayerTrophies('winner-a', [trophy, trophy], history, seasonId);
  assert.equal(merged.length, 2, 'One award per competition per season, no duplicates');
  assert.equal(merged[0].seasonId, seasonId);
  const frozenHistory = { records: [], archives: [{ seasonId, trophies: [trophy] }] };
  assert.equal(mergePlayerTrophies('new-club-owner', [{ ...trophy, winnerUserId: 'new-club-owner' }], frozenHistory, seasonId).length, 0);
  assert.equal(mergePlayerTrophies('winner-a', [], frozenHistory, 'season-2027-28').length, 1, 'Archived trophies survive season rollover');
  assert.equal(mergePlayerTrophies('unrelated', [trophy], history, seasonId).length, 0);
  assert.equal(mergePlayerTrophies('winner-a', [trophy], { records: [{ ...record, active: false }], archives: [] }, seasonId).length, 0);
  await getFirestoreDb().collection('season_archives').doc(older.seasonId).set({ seasonId: older.seasonId, trophies: [older] });
  assert.equal((await getPlayerTrophyCabinet('winner-a', 'season-2027-28')).trophies[0]?.seasonId, older.seasonId);
  const endpoint = (seasonInsightsRouter as any).stack.find((layer: any) => layer.route?.path === '/player/:userId/trophies').route.stack[0].handle;
  let status = 200; let response: any; const headers: Record<string, string> = {};
  const res = { status: (code: number) => { status = code; return res; }, json: (data: any) => { response = data; }, setHeader: (key: string, value: string) => { headers[key] = value; } };
  await endpoint({ params: { userId: 'winner-a' }, query: { seasonId: 'season-2027-28' } }, res);
  assert.equal(status, 200); assert.equal(response.trophies.length, 1); assert.equal(headers['Cache-Control'], 'no-store');
  await endpoint({ params: { userId: 'winner-a' }, query: { seasonId: 'not-a-season' } }, res);
  assert.equal(status, 400);

  // Never mistake a sole remaining semi-final or an unknown competition for a title.
  const semi = { ...fixture, roundName: 'Semi-Final' };
  assert.equal((await getSeasonTrophies(seasonId, { fixtures: [semi], competitionId: cupId })).trophies.length, 0);
  const unplayed = { ...fixture, status: 'PENDING_CONFIRMATION' as const };
  assert.equal((await getSeasonTrophies(seasonId, { fixtures: [unplayed], competitionId: cupId })).trophies.length, 0);
  const wrongSeason = { ...fixture, seasonId: 'season-2025-26' };
  assert.equal((await getSeasonTrophies(seasonId, { fixtures: [wrongSeason], competitionId: cupId })).trophies.length, 0);

  // La Liga requires all 190 confirmed pairings and the canonical league ranking.
  const leagueId = 'comp-la-liga-2026';
  const clubs = SEED_CLUBS.filter(item => item.leagueId === 'league-la-liga');
  await redisSetRaw(ReadModelKeys.clubsWithOwners(seasonId), { data: clubs.map((club, index) => ({ ...club, ownerUserId: `liga-player-${index}` })) });
  const leagueFixtures: Fixture[] = [];
  for (let h = 0; h < clubs.length; h++) for (let a = h + 1; a < clubs.length; a++) {
    leagueFixtures.push({ ...fixture, id: `trophy-league-${h}-${a}`, competitionId: leagueId, roundName: undefined,
      homeClubId: clubs[h].id, awayClubId: clubs[a].id, winnerClubId: clubs[h].id, homeScore: 1, awayScore: 0 });
  }
  const standings = clubs.map((club, index) => ({ position: index + 1, clubId: club.id, clubName: club.name,
    played: 19, won: 19-index, drawn: 0, lost: index, points: (19-index)*3, goalsFor: 19-index, goalsAgainst: index,
    goalDifference: 19-index*2, form: [] })) as StandingsRow[];
  await redisSetRaw(ReadModelKeys.standings(leagueId, seasonId), { data: standings });
  assert.equal((await getSeasonTrophies(seasonId, { fixtures: leagueFixtures.slice(1), competitionId: leagueId })).trophies.length, 0);
  const league = await getSeasonTrophies(seasonId, { fixtures: leagueFixtures, competitionId: leagueId });
  assert.equal(league.trophies[0]?.winnerUserId, 'liga-player-0');
  await redisSetRaw(ReadModelKeys.competitionFixtures(leagueId, seasonId), { data: leagueFixtures });
  await redisSetRaw(ReadModelKeys.adminFixtures(seasonId), { data: leagueFixtures });
  await syncCompetitionTrophy(leagueId, seasonId, leagueFixtures[0]);
  assert.equal((await getPlayerTrophyCabinet('liga-player-0', seasonId)).trophies[0]?.competitionName, 'La Liga');
  await invalidateDataset(ReadModelKeys.standings(leagueId, seasonId));
  await syncCompetitionTrophy(leagueId, seasonId, leagueFixtures[0]);
  const unavailableTable = await getPlayerTrophyCabinet('liga-player-0', seasonId);
  assert.equal(unavailableTable.trophies.length, 1, 'Standings outage must preserve an earned trophy');
  assert.equal(unavailableTable.stale, true);
  await redisSetRaw(ReadModelKeys.standings(leagueId, seasonId), { data: standings });
  await invalidateDataset(ReadModelKeys.competitionFixtures(leagueId, seasonId));
  await syncCompetitionTrophy(leagueId, seasonId, { ...leagueFixtures[0], status: 'SCHEDULED' });
  assert.equal((await getPlayerTrophyCabinet('liga-player-0', seasonId)).trophies.length, 1, 'Stale snapshots must not revoke earned trophies');

  const markup = renderToStaticMarkup(createElement(TrophyCabinetView, { trophies: merged, language: 'uz' }));
  assert.ok(markup.includes('Sovrinlar') && markup.includes('2026/27') && markup.includes('2025/26'));
  assert.ok(markup.includes('FA Cup') && markup.includes('Barcha mavsumlar'));
  const laLigaMarkup = renderToStaticMarkup(createElement(TrophyCabinetView, { trophies: [{ ...league.trophies[0], id: trophyId(seasonId, leagueId) }], language: 'uz' }));
  assert.ok(laLigaMarkup.includes('/export-emblems/la-liga.svg'));
  const empty = renderToStaticMarkup(createElement(TrophyCabinetView, { trophies: [], language: 'uz' }));
  assert.ok(empty.includes('Hali sovrin yo‘q'));
  assert.equal(seasonLabel('season-2027-28'), '2027/28');
  console.log('PLAYER_TROPHY_REGRESSION_PASS: result hook, idempotency, owner transfer, revocation/correction, stale guard, archive/rollover, league completion and public UI');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
