import assert from 'node:assert/strict';
import { understandingCases } from './telegramAiUnderstandingCases';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { buildConversationTableReply, getConversationIntent, requestedMatchday, expandConversationReadFollowUp } from '../services/telegramAiConversationCommands';

await initDatabase();
const bridge = await startMockUpstashBridge();
const season = 'season-2026-27', league = 'comp-premier-league-2026';
const signal = new AbortController().signal;
const db = getFirestoreDb(), original = db.collection.bind(db);
let reads = 0;
db.collection = (() => { reads++; throw new Error('NO_FIRESTORE'); }) as any;
try {
  for (const [id, text, expected] of understandingCases) assert.equal(getConversationIntent(text), expected, id + ': ' + text);
  assert.equal(requestedMatchday('11 turdagichi?'), 11);
  assert.equal(requestedMatchday('10 turgacha?'), 10);
  await redisSetRaw(ReadModelKeys.competitions(season), { data: [{ id: league, name: 'Premier League', seasonId: season, type: 'LEAGUE', leagueId: 'league-premier-league', currentMatchday: 11 }] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: [{ id: 'club-everton', name: 'Everton', leagueId: 'league-premier-league' }, { id: 'club-leeds', name: 'Leeds United', leagueId: 'league-premier-league' }, { id: 'club-liverpool', name: 'Liverpool', leagueId: 'league-premier-league' }, { id: 'club-chelsea', name: 'Chelsea', leagueId: 'league-premier-league' }] });
  const game = (id: string, matchday: number, status: string, home = 'club-everton', away = 'club-leeds') => ({ id, competitionId: league, seasonId: season, matchday, status, homeClubId: home, awayClubId: away, homeScore: 2, awayScore: 1 });
  await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: [game('old-pending', 9, 'SCHEDULED'), game('current-pending', 11, 'SCHEDULED', 'club-liverpool', 'club-chelsea'), game('old-result', 9, 'CONFIRMED'), game('new-result', 11, 'CONFIRMED', 'club-liverpool', 'club-chelsea'), game('submitted', 11, 'PENDING_CONFIRMATION')] });
  const through = await buildConversationTableReply('APL 10 turgacha oynalmagan oyinlar', 'fixtures', {}, signal);
  assert.match(through.text, /9-tur: Everton/); assert.ok(!/11-tur:/.test(through.text));
  const results = await buildConversationTableReply('APL 11 tur natijalari', 'fixtures', {}, signal);
  assert.match(results.text, /Liverpool 2:1 Chelsea/); assert.ok(!/Everton|tasdiq kutilmoqda/.test(results.text));
  const earlierResults = await buildConversationTableReply('APL 10 turgacha natijalar', 'fixtures', {}, signal);
  assert.match(earlierResults.text, /Everton 2:1 Leeds/); assert.ok(!/Liverpool/.test(earlierResults.text));
  const scope = { selectedCompetitionIds: [league], previousUserQueries: ['APL 9 tur oynalmagan oyinlar'] };
  const follow = await buildConversationTableReply('11 turdagichi?', 'fixtures', scope, signal);
  assert.match(follow.text, /O‘ynalmagan: 1 ta/); assert.match(follow.text, /11-tur: Liverpool/); assert.ok(!/9-tur:/.test(follow.text));
  const effective = expandConversationReadFollowUp('11 turdagichi?', scope);
  const changed = await buildConversationTableReply('natijalarchi?', 'fixtures', { ...scope, previousUserQueries: [effective] }, signal);
  assert.match(changed.text, /Liverpool 2:1 Chelsea/); assert.ok(!/O‘ynalmagan:/.test(changed.text));
  for (const previous of ['APL qolib ketgan oyinlar', 'APL hali oynalmagan oyinlar', 'APL tugamagan oyinlar']) {
    const changedKind = await buildConversationTableReply('natijalarchi?', 'fixtures', { ...scope, previousUserQueries: [previous] }, signal);
    assert.match(changedKind.text, /Liverpool 2:1 Chelsea/); assert.ok(!/O‘ynalmagan:/.test(changedKind.text));
  }
  const twice = await buildConversationTableReply('9 turdagichi?', 'fixtures', { ...scope, previousUserQueries: [effective] }, signal);
  assert.match(twice.text, /9-tur: Everton/); assert.match(twice.text, /O‘ynalmagan: 1 ta/);
  assert.equal(expandConversationReadFollowUp('11 turdagichi?', { previousUserQueries: ['Heidenheimni boshat'] }), '11 turdagichi?');
  assert.equal(expandConversationReadFollowUp('Arsenalni ochir', scope), 'Arsenalni ochir');
  assert.match((await buildConversationTableReply('11 turdagichi?', 'fixtures', {}, signal)).text, /Qaysi liga/);
  assert.equal(reads, 0);
  console.log(`PASS ${understandingCases.length} curated intent examples; exact/through rounds, confirmed results, repeated short follow-ups, kind changes and unrelated/admin history isolation; zero model/Firestore`);
} finally { db.collection = original; await bridge.close(); }
