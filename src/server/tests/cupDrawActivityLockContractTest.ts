import assert from 'node:assert/strict';
import fs from 'node:fs';

const routes = fs.readFileSync('src/server/routes/adminCupDraw.routes.ts', 'utf8');
const adminUi = fs.readFileSync('src/components/admin/AdminDomesticCupsTab.tsx', 'utf8');

assert(routes.includes("code: 'CUP_DRAW_LOCKED_AFTER_ACTIVITY'"), 'preview must be rejected after cup activity');
assert(routes.includes("code: 'CUP_PAIRINGS_LOCKED_AFTER_ACTIVITY'"), 'all manual pairings must lock after cup activity');
assert(routes.includes('cupState.protectedFixtures.length > 0'), 'pairing lock must inspect the whole cup');
assert(adminUi.includes("details.completedFixtures > 0"), 'redraw UI must disable after confirmed results');
assert(adminUi.includes("details.completedFixtures === 0 && fixture.status === 'SCHEDULED'"), 'pairing edit UI must follow the global cup lock');

console.log('Cup draw activity lock contract: PASS');
