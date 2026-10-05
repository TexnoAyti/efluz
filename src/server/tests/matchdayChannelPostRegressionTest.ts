import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { channelMatchdayCaption, channelMatchdayId, MATCHDAY_CHANNEL_LEAGUES } from '../services/matchdayChannelPost';
import { renderTournamentImagePng } from '../services/tournamentImageRenderer';
import { matchdayImageModel } from '../../lib/tournamentImage';
import { tournamentImageBranding } from '../../lib/tournamentImageBranding';
import { SEED_CLUBS } from '../db/seed';
import { sendTelegramPhoto } from '../services/telegramBotService';

const deadline = '2026-10-05T18:59:00.000Z';
for (const [index, leagueId] of Object.keys(MATCHDAY_CHANNEL_LEAGUES).entries()) {
  const caption = channelMatchdayCaption(leagueId, 11, deadline);
  assert.ok(caption.includes(`https://t.me/efleagueuz/${index + 2}`));
  assert.ok(caption.includes('https://t.me/efluz_cards/16'));
  assert.ok(caption.includes('23:59'));
  assert.ok(caption.includes('11 tur'));
  assert.ok(caption.length < 1024);
}
assert.throws(() => channelMatchdayCaption('cup-fa', 1, deadline));
assert.throws(() => channelMatchdayCaption('league-ligue-1', 0, deadline));
assert.equal(channelMatchdayId('league-a', 'season-a', 1), channelMatchdayId('league-a', 'season-a', 1));
assert.notEqual(channelMatchdayId('league-a', 'season-a', 1), channelMatchdayId('league-a', 'season-b', 1));
assert.notEqual(channelMatchdayId('league-a', 'season-a', 1), channelMatchdayId('league-b', 'season-a', 1));

const clubs = SEED_CLUBS.filter(c => c.leagueId === 'league-bundesliga').map((c, i) => ({ ...c, active: true, createdAt: '', claimedByUserId: `owner-${i}`, claimedByUsername: `manager${i}`, isTaken: true }));
const competition: any = { id: 'comp-bundesliga-2026', name: 'Bundesliga', leagueId: 'league-bundesliga', type: 'LEAGUE', seasonId: 'season-2026-27', formatConfig: {} };
const fixtures: any[] = Array.from({ length: 9 }, (_, i) => ({ id: `fixture-${i}`, competitionId: competition.id, seasonId: competition.seasonId, matchday: 12, roundName: 'Matchday 12', homeClubId: clubs[i * 2].id, awayClubId: clubs[i * 2 + 1].id, homeClub: clubs[i * 2], awayClub: clubs[i * 2 + 1], status: 'SCHEDULED' }));
const model = matchdayImageModel(competition.name, competition.seasonId, fixtures, 12, 'uz', clubs);
model.branding = tournamentImageBranding(competition, [], 18);
assert.equal(model.rows[0].ownerUsername, 'manager0');
assert.equal(model.rows[0].awayOwnerUsername, 'manager1');
assert.equal(model.round, '12-tur');
// Local deterministic stand-in for the remote club crests; no live messages/network.
const crest = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="80"><rect width="40" height="80" fill="#56d9a8"/></svg>');
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(crest, { status: 200 });
const png = await renderTournamentImagePng(model);
assert.equal(png.subarray(1, 4).toString(), 'PNG');
assert.equal(png.readUInt32BE(16), 1080);
assert.equal(png.readUInt32BE(20), 234 + 9 * 92 + 88);
assert.ok(png.length > 10000 && png.length < 10_000_000);
if (process.env.MATCHDAY_PREVIEW_PATH) await writeFile(process.env.MATCHDAY_PREVIEW_PATH, png);
process.env.TELEGRAM_BOT_TOKEN = '123:isolated-test-token';
let sends = 0;
globalThis.fetch = async (input: any, init: any) => {
  assert.ok(String(input).endsWith('/sendPhoto'));
  assert.ok(init.body instanceof FormData);
  assert.equal(init.body.get('chat_id'), '@efl_uz');
  assert.equal(init.body.get('caption'), channelMatchdayCaption('league-bundesliga', 12, deadline));
  assert.equal(init.body.get('parse_mode'), 'HTML');
  assert.equal(init.body.get('photo').type, 'image/png');
  sends++;
  return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }));
};
assert.equal((await sendTelegramPhoto('@efl_uz', png, channelMatchdayCaption('league-bundesliga', 12, deadline))).ok, true);
globalThis.fetch = async () => { throw Error('Unknown timeout'); };
assert.equal((await sendTelegramPhoto('@efl_uz', png, 'Test')).error_code, undefined);
assert.equal(sends, 1);
globalThis.fetch = originalFetch;
console.log('PASS all five channel templates, verified links, Tashkent deadline, stable event IDs, owners, real PNG renderer and multipart photo transport; no production messages.');
