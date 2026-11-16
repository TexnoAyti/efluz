import assert from 'node:assert/strict';
import {adminEditResultSchema} from '../routes/admin.routes';
import {assertTopicResultCurrent, type ExpectedTopicFixture} from '../services/topicResultGuard';

const expectedFixture={
  seasonId:'season-2027-28',
  competitionId:'comp-ligue-1-2027',
  homeClubId:'club-toulouse',
  awayClubId:'club-angers',
  status:'SCHEDULED',
  updatedAt:'2026-11-16T14:00:00.000Z',
};
const body={
  homeScore:2,awayScore:1,
  homeExtraTimeScore:null,awayExtraTimeScore:null,
  homePenaltyScore:null,awayPenaltyScore:null,
  status:'CONFIRMED' as const,
  expectedFixture,
};
const parsed=adminEditResultSchema.parse(body);
assert.deepEqual(parsed.expectedFixture,expectedFixture,
 'Telegram group result payload must preserve season proof through validation');
assert.doesNotThrow(()=>assertTopicResultCurrent({...expectedFixture},parsed.expectedFixture! as ExpectedTopicFixture));
assert.throws(()=>assertTopicResultCurrent({...expectedFixture,seasonId:'season-2026-27'},parsed.expectedFixture! as ExpectedTopicFixture),/o‘zgargan/);
assert.equal(adminEditResultSchema.safeParse({...body,expectedFixture:{...expectedFixture,extra:'untrusted'}}).success,false);
assert.equal(adminEditResultSchema.safeParse({...body,homeScore:-1}).success,false);
console.log('PASS Telegram topic result Season 2 schema acceptance, strict proof and season mismatch guard');
