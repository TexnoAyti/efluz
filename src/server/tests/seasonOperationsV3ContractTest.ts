import fs from 'node:fs';
import path from 'node:path';

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8');
}

function expectContains(source: string, value: string, label: string) {
  if (!source.includes(value)) throw new Error(`SEASON_OPERATIONS_V3_CONTRACT_FAIL: ${label}`);
}

const service = read('src/server/services/seasonOperationsService.ts');
const routes = read('src/server/routes/seasonOperations.routes.ts');
const app = read('src/server/app.ts');
const hub = read('src/components/SeasonHubView.tsx');
const nav = read('src/components/Navigation.tsx');
const profile = read('src/components/ProfileView.tsx');

const phaseOrder = [
  "id: 'LEAGUE_MD_1_9'",
  "id: 'DOMESTIC_CUPS'",
  "id: 'LEAGUE_MD_10_19'",
  "id: 'EUROPE_LEAGUE_PHASE'",
  "id: 'LEAGUE_MD_20_PLUS'",
];
let previous = -1;
for (const phase of phaseOrder) {
  const index = service.indexOf(phase);
  if (index < 0 || index <= previous) throw new Error(`SEASON_OPERATIONS_V3_CONTRACT_FAIL: phase order ${phase}`);
  previous = index;
}

expectContains(routes, "seasonOperationsRouter.post('/no-show', requireAuth", 'authenticated no-show reporting');
expectContains(routes, "adminSeasonOperationsRouter.post('/no-show/:reportId/resolve'", 'admin no-show resolution');
expectContains(routes, "WALKOVER_HOME", 'home walkover option');
expectContains(routes, "WALKOVER_AWAY", 'away walkover option');
expectContains(routes, "POSTPONE", 'postpone option');
expectContains(routes, "getPremiumEntitlement", 'premium entitlement gate');
expectContains(routes, "priceStars: PREMIUM_PRICE_STARS", '89 Stars product metadata');
expectContains(routes, "confirmation: z.literal('CREATE_NEXT_SEASON_SHELL')", 'explicit rollover confirmation');
expectContains(routes, "rolloverMode: 'SHELL_ONLY_NON_DESTRUCTIVE'", 'non destructive rollover shell');
expectContains(routes, "SEASON_ROLLOVER_BLOCKED", 'rollover safety blocker');

expectContains(app, "app.use('/api/season-ops', seasonOperationsRouter)", 'public season operations mount');
expectContains(app, "app.use('/api/admin/season-ops', adminSeasonOperationsRouter)", 'admin season operations mount');
expectContains(app, "rateLimit('season-no-show'", 'no-show rate limit');

for (const marker of ['Competition Calendar', 'Deadlines & No-show', 'Head-to-Head', 'Live Season Records', 'Qualification Tracker', 'EFL Career', 'Season Control Center', 'Season Rollover']) {
  expectContains(hub, marker, `Season Hub ${marker}`);
}
expectContains(nav, "'season-hub'", 'Season Hub navigation type');
expectContains(profile, "onNavigateTab('season-hub')", 'mobile Profile Season Hub entry');

console.log('SEASON_OPERATIONS_V3_CONTRACT_PASS');
