import fs from 'node:fs';
import path from 'node:path';

function read(rel: string) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

const service = read('src/server/services/matchOperationsV4Service.ts');
const meRoutes = read('src/server/routes/me.routes.ts');
const adminRoutes = read('src/server/routes/adminMatchControl.routes.ts');
const player = read('src/components/MatchOperationsV4Panel.tsx');
const admin = read('src/components/admin/AdminMatchOperationsV4Panel.tsx');
const app = read('src/App.tsx');

const checks: Array<[string, boolean]> = [
  ['deadline registry exists', service.includes("DEADLINE_COLLECTION = 'match_deadlines'")],
  ['hourly Redis lock exists', service.includes('ex: 3600') && service.includes('HOURLY_LOCK')],
  ['24h reminder window exists', service.includes('24 * HOUR_MS') && service.includes("'DUE_24H'")],
  ['6h reminder window exists', service.includes('6 * HOUR_MS') && service.includes("'DUE_6H'")],
  ['overdue state exists', service.includes("'OVERDUE'") && service.includes('overdueSentAt')],
  ['smart Telegram reminder is event-driven', service.includes('matchday-open:deadline:') && service.includes('enqueueSmartTelegramNotification')],
  ['Vercel continuation uses waitUntil', service.includes("import { waitUntil } from '@vercel/functions'") && service.includes('waitUntil(work)')],
  ['no-show supports HTTPS evidence', service.includes('EVIDENCE_URL_MUST_BE_HTTPS') && service.includes('evidenceUrl')],
  ['walkover uses official result pipeline', service.includes('editFixtureResult') && service.includes('homeScore: 3, awayScore: 0') && service.includes('homeScore: 0, awayScore: 3')],
  ['postpone requires a new deadline', service.includes('POSTPONE_DEADLINE_REQUIRED') && service.includes("status: 'POSTPONED'")],
  ['player match operations endpoint mounted', meRoutes.includes("meRouter.get('/match-ops'")],
  ['player no-show endpoint mounted', meRoutes.includes("meRouter.post('/match-ops/no-show'")],
  ['admin control endpoint mounted', adminRoutes.includes("adminMatchControlRouter.get('/match-ops/control'")],
  ['admin deadline endpoint mounted', adminRoutes.includes("adminMatchControlRouter.post('/fixtures/:id/deadline'")],
  ['admin dispute V2 endpoint mounted', adminRoutes.includes("adminMatchControlRouter.post('/match-ops/disputes/:disputeId/resolve'")],
  ['player Match Center V4 UI exists', player.includes('Match Center V4') && player.includes('Head-to-Head') && player.includes('Send no-show report')],
  ['player proof links exist', player.includes('fixture.userSubmission') && player.includes('fixture.opponentSubmission') && player.includes('Proof')],
  ['admin Deadline Queue exists', admin.includes('Deadline Queue') && admin.includes('Run sweep')],
  ['admin no-show review exists', admin.includes('No-show Review Queue') && admin.includes('Home 3–0') && admin.includes('Away 0–3')],
  ['admin Dispute Center V2 exists', admin.includes('Dispute Center V2') && admin.includes('Manual score') && admin.includes('Cancel match')],
  ['V4 panels scoped to My Matches and Admin', app.includes("currentTab === 'my-matches' && <div className=\"mb-5\"><MatchOperationsV4Panel") && app.includes("user?.isAdmin ? (") && app.includes("currentTab === 'admin' && <div className=\"mb-5\"><AdminMatchOperationsV4Panel")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
if (failed.length) {
  console.error(`MATCH_OPERATIONS_V4_CONTRACT_FAILED: ${failed.map(([label]) => label).join(', ')}`);
  process.exit(1);
}
console.log('MATCH_OPERATIONS_V4_CONTRACT_PASS');
