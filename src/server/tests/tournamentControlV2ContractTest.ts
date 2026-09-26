import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (path: string) => fs.readFileSync(path, 'utf8');

const insights = read('src/server/services/seasonInsightsService.ts');
assert(insights.includes("id: 'MOST_WINS'"), 'season awards must include most wins');
assert(insights.includes("id: 'MOST_GOALS'"), 'season awards must include most goals');
assert(insights.includes("id: 'BEST_DEFENCE'"), 'season awards must include best defence');
assert(insights.includes("id: 'LONGEST_UNBEATEN'"), 'season awards must include unbeaten streak');
assert(insights.includes("id: 'LONGEST_WIN_STREAK'"), 'season awards must include win streak');
assert(insights.includes('getSeasonTrophies'), 'trophy cabinet derivation missing');
assert(insights.includes('getPlayerSeasonInsights'), 'player season profile derivation missing');
assert(insights.includes('redisGetFresh'), 'insights must prefer durable read models');
assert(insights.includes("source: 'sqlite'"), 'insights must preserve SQLite fallback');

const profile = read('src/components/PlayerSeasonProfile.tsx');
for (const marker of ['Public Season Profile', 'Recent Form', 'Trophy Cabinet', 'Season Awards', 'Competition Breakdown']) {
  assert(profile.includes(marker), `player profile missing ${marker}`);
}

const matchControl = read('src/components/admin/AdminMatchModals.tsx');
for (const marker of ['Match Control Center', 'Submission Evidence', 'Fixture Audit Trail', 'Send Player Reminder', 'Danger Zone']) {
  assert(matchControl.includes(marker), `match control center missing ${marker}`);
}
assert(matchControl.includes('/remind`'), 'match control center must call per-fixture reminder route');

const reminderRoute = read('src/server/routes/adminMatchControl.routes.ts');
assert(reminderRoute.includes('requireAdmin'), 'per-fixture reminder must be admin protected');
assert(reminderRoute.includes("'/fixtures/:id/remind'"), 'per-fixture reminder route missing');
assert(reminderRoute.includes("fixture.status === 'CONFIRMED'"), 'confirmed matches must not receive result reminders');

const telegram = read('src/server/services/smartNotificationService.ts');
for (const marker of ['buildMatchCardBody', 'Asia/Tashkent', 'EFL UZ ilovasini ochish', 'Natijani yuborish']) {
  assert(telegram.includes(marker), `Telegram Match Card V2 missing ${marker}`);
}
assert(telegram.includes("status === 'PENDING_CONFIRMATION'"), 'result verification lifecycle missing');
assert(telegram.includes("status === 'CONFIRMED'"), 'confirmed lifecycle missing');
assert(telegram.includes("status === 'DISPUTED'"), 'dispute lifecycle missing');

const cup = read('src/components/admin/AdminDomesticCupsTab.tsx');
for (const marker of ['Redraw Preview', 'Confirm Draw', 'Apply Exact Draw', 'Bracket Health', 'Repair Safe Mismatches', 'Open Next Round']) {
  assert(cup.includes(marker), `Cup Management V2 missing ${marker}`);
}
assert(cup.includes("setRound(round.roundNumber, 'OPEN')"), 'cup round open control missing');
assert(cup.includes("setRound(round.roundNumber, 'LOCK')"), 'cup round lock control missing');

const app = read('src/server/app.ts');
assert(app.includes("app.use('/api/insights', seasonInsightsRouter)"), 'season insights router not mounted');
assert(app.includes("app.use('/api/admin', adminMatchControlRouter)"), 'admin match control router not mounted');

console.log('TOURNAMENT_CONTROL_V2_CONTRACT_PASS');
