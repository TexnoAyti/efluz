from pathlib import Path
import re, json

rm = Path('src/server/readModel/readModelStore.ts')
text = rm.read_text()
pattern = re.compile(r"/\*\* Refresh one changed fixture with one document read instead of scanning the season\. \*/\nexport async function refreshChangedFixtureReadModel\(fixtureId: string\): Promise<void> \{.*?\n\}\n\nexport async function invalidateFixtureReadModels", re.S)
replacement = r'''/** Refresh one changed fixture with one document read instead of scanning the season. */
export async function refreshChangedFixtureReadModel(fixtureId: string): Promise<void> {
  const document = await getFirestoreDb().collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
  trackFirestoreRead(COLLECTIONS.FIXTURES, document.exists ? 1 : 0, 'refreshChangedFixtureReadModel');
  if (!document.exists) throw new Error('FIXTURE_NOT_FOUND');
  const fixture = normalizeFixtureSnapshot({ ...document.data(), id: document.id } as FirestoreFixtureDoc);

  const patchDataset = async (key: string): Promise<boolean> => {
    const client = getUpstashClient();
    if (client) {
      const result = await client.eval(`
        local raw = redis.call('GET', KEYS[2])
        if not raw then raw = redis.call('GET', KEYS[1]) end
        if not raw then return 0 end
        local snapshot = cjson.decode(raw)
        local changed = cjson.decode(ARGV[1])
        local found = false
        for i, row in ipairs(snapshot.data or {}) do
          if row.id == changed.id then
            if row.updatedAt and changed.updatedAt and row.updatedAt > changed.updatedAt then return 1 end
            snapshot.data[i] = changed
            found = true
            break
          end
        end
        if not found then return 0 end
        snapshot.generatedAt = ARGV[2]
        snapshot.sourceVersion = ARGV[3]
        snapshot.actualCount = #(snapshot.data or {})
        local updated = cjson.encode(snapshot)
        redis.call('SET', KEYS[2], updated)
        local ttl = redis.call('TTL', KEYS[1])
        if ttl and ttl > 0 then redis.call('SET', KEYS[1], updated, 'EX', ttl)
        else redis.call('SET', KEYS[1], updated, 'EX', 86400) end
        redis.call('DEL', KEYS[3])
        return 1
      `, [getFreshKey(key), getLkgKey(key), getDirtyKey(key)], [JSON.stringify(fixture), new Date().toISOString(), `fixture-patch-${fixture.id}-${fixture.updatedAt || Date.now()}`]);
      inProcessMemoryCache.delete(getRawDatasetKey(key));
      inProcessMemoryCache.delete(key);
      memoryRedisStorage.delete(getFreshKey(key));
      memoryRedisStorage.delete(getLkgKey(key));
      return Number(result) === 1;
    }
    const existing = (await redisGetFresh<Fixture[]>(key)) || (await redisGetLkg<Fixture[]>(key));
    if (!existing || !Array.isArray(existing.data)) return false;
    let found = false;
    const data = existing.data.map((row) => row.id === fixture.id ? (found = true, fixture) : row);
    if (!found) return false;
    await redisSetRaw(key, { ...existing, generatedAt: new Date().toISOString(), sourceVersion: `fixture-patch-${fixture.id}-${fixture.updatedAt || Date.now()}`, data }, 86400);
    inProcessMemoryCache.delete(getRawDatasetKey(key));
    inProcessMemoryCache.delete(key);
    return true;
  };

  const adminKey = ReadModelKeys.adminFixtures(fixture.seasonId);
  const competitionKey = ReadModelKeys.competitionFixtures(fixture.competitionId, fixture.seasonId);
  const [adminPatched, competitionPatched] = await Promise.all([patchDataset(adminKey), patchDataset(competitionKey)]);
  if (!adminPatched) await invalidateDataset(adminKey);
  if (!competitionPatched) await invalidateDataset(competitionKey);
  await invalidateDataset(ReadModelKeys.standings(fixture.competitionId, fixture.seasonId));
}

export async function invalidateFixtureReadModels'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'refresh block count={count}')
rm.write_text(text)

route = Path('src/server/routes/admin.routes.ts')
text = route.read_text()
old = '''    await refreshChangedFixtureReadModel(fixtureId).catch(() => {});
    if (result.fixture?.competitionId) {
      await invalidateFixtureReadModels(result.fixture.competitionId, result.fixture.seasonId || 'season-2026-27').catch(() => {});
      await invalidateStandingsReadModels(result.fixture.competitionId, result.fixture.seasonId || 'season-2026-27').catch(() => {});
    }
    res.json(result);'''
new = '''    // Atomically patch Admin + Match Day Fresh/LKG fixture snapshots. Do not
    // invalidate them again after a successful patch or stale LKG can win.
    await refreshChangedFixtureReadModel(fixtureId);
    res.json(result);'''
if text.count(old) != 2:
    raise SystemExit(f'route blocks={text.count(old)}')
route.write_text(text.replace(old, new))

test = Path('src/server/tests/readAfterWriteConsistencyRegressionTest.ts')
test.write_text("""import { strict as assert } from 'node:assert';\nimport { readFileSync } from 'node:fs';\nconst readModel = readFileSync('src/server/readModel/readModelStore.ts', 'utf8');\nconst routes = readFileSync('src/server/routes/admin.routes.ts', 'utf8');\nassert.match(readModel, /const competitionKey = ReadModelKeys\\.competitionFixtures/);\nassert.match(readModel, /redis\\.call\\('SET', KEYS\\[2\\], updated\\)/);\nassert.match(readModel, /redis\\.call\\('DEL', KEYS\\[3\\]\\)/);\nconst section = routes.slice(routes.indexOf(\"adminRouter.post('/fixtures/:id/result'\"), routes.indexOf('// Admin delete fixture', routes.indexOf(\"adminRouter.post('/fixtures/:id/result'\")));\nassert.equal((section.match(/refreshChangedFixtureReadModel\\(fixtureId\\)/g) || []).length, 2);\nassert.equal((section.match(/invalidateFixtureReadModels\\(/g) || []).length, 0);\nassert.equal((section.match(/invalidateStandingsReadModels\\(/g) || []).length, 0);\nconsole.log('read-after-write consistency regression: PASS');\n""")

pkg = Path('package.json')
data = json.loads(pkg.read_text())
data.setdefault('scripts', {})['test:read-after-write'] = 'tsx src/server/tests/readAfterWriteConsistencyRegressionTest.ts'
pkg.write_text(json.dumps(data, indent=2) + '\n')
