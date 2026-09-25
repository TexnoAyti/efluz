import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
const readModel = readFileSync('src/server/readModel/readModelStore.ts', 'utf8');
const routes = readFileSync('src/server/routes/admin.routes.ts', 'utf8');
assert.match(readModel, /const competitionKey = ReadModelKeys\.competitionFixtures/);
assert.match(readModel, /redis\.call\('SET', KEYS\[2\], updated\)/);
assert.match(readModel, /redis\.call\('DEL', KEYS\[3\]\)/);
const editStart = routes.indexOf("adminRouter.post('/fixtures/:id/result'");
const deleteStart = routes.indexOf("adminRouter.post('/fixtures/:id/delete-result'");
const deleteEnd = routes.indexOf('// Admin delete fixture\n', deleteStart);
assert.ok(editStart >= 0 && deleteStart > editStart && deleteEnd > deleteStart);
const editSection = routes.slice(editStart, deleteStart);
const deleteSection = routes.slice(deleteStart, deleteEnd);
for (const section of [editSection, deleteSection]) {
  assert.equal((section.match(/refreshChangedFixtureReadModel\(fixtureId\)/g) || []).length, 1);
  assert.equal((section.match(/invalidateFixtureReadModels\(/g) || []).length, 0);
  assert.equal((section.match(/invalidateStandingsReadModels\(/g) || []).length, 0);
}
console.log('read-after-write consistency regression: PASS');
