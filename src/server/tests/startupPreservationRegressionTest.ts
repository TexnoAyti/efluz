import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Real process restarts with production flags, isolated files, and no network.
const child = String.raw`
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {ensureDbReady} from './src/server/app.ts';
import {queryRun,queryAll,saveDatabaseSync,resolveBundledDbPath} from './src/server/db/index.ts';
await ensureDbReady();
assert.equal(resolveBundledDbPath(),null);
const tables=['users','club_memberships','fixtures','result_submissions'];
if(process.env.PHASE==='create') {
  for(const table of tables) assert.equal(queryAll('SELECT * FROM '+table).length,0,table+' must start empty');
  const now='2026-01-01';
  queryRun("INSERT INTO users(id,telegram_id,username,first_name,created_at,updated_at) VALUES ('preserved-user','123','manager','Manager',?,?)",[now,now]);
  queryRun("INSERT INTO competitions(id,season_id,name,type,format_config_json,created_at) VALUES ('custom-cup','season-2026-27','Keep me','KNOCKOUT','{}',?)",[now]);
  const club=queryAll('SELECT id FROM clubs LIMIT 1')[0].id;
  queryRun("INSERT INTO club_memberships(id,season_id,club_id,user_id,claimed_at,status) VALUES ('membership','season-2026-27',?,'preserved-user',?,'active')",[club,now]);
  queryRun("INSERT INTO fixtures(id,season_id,competition_id,matchday,home_club_id,away_club_id,scheduled_at,status,home_score,away_score,created_at,updated_at) VALUES ('confirmed-match','season-2026-27','custom-cup',1,?,'inactive-club',?,'CONFIRMED',2,1,?,?)",[club,now,now,now]);
  queryRun("INSERT INTO result_submissions(id,fixture_id,submitted_by_user_id,club_id,home_score,away_score,created_at) VALUES ('submission','confirmed-match','preserved-user',?,2,1,?)",[club,now]);
  // Existing catalog metadata must also survive boot unchanged.
  queryRun("UPDATE competitions SET status='completed',format_config_json='{}' WHERE id='comp-premier-league-2026'");
  saveDatabaseSync();
  writeFileSync(process.env.EXPECTED,JSON.stringify(Object.fromEntries([...tables,'competitions'].map(t=>[t,queryAll('SELECT * FROM '+t+' ORDER BY id')]))));
} else {
 const expected=JSON.parse(readFileSync(process.env.EXPECTED,'utf8'));
 for(const [table,rows] of Object.entries(expected)) assert.deepEqual(queryAll('SELECT * FROM '+table+' ORDER BY id'),rows,table+' survived restart');
}
`;
const bundledBefore = readFileSync('data/efootball.sqlite');
for (const hosted of [{ VERCEL: '1' }, { K_SERVICE: 'efluz' }]) {
  const directory = mkdtempSync(path.join(tmpdir(), 'efluz-startup-proof-'));
  try {
    for (const phase of ['create', 'restart', 'restart']) {
      const result = spawnSync(process.execPath, ['--require', './scripts/block-external-network.cjs', '--import', 'tsx', '--input-type=module', '-'], {
        input: child, encoding: 'utf8', timeout: 30000,
        env: { PATH: process.env.PATH, NODE_ENV: 'production', ...hosted, DATA_DIR: directory, DB_FILE: path.join(directory, 'runtime.sqlite'), EXPECTED: path.join(directory, 'expected.json'), PHASE: phase },
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    console.log(`PASS ${Object.keys(hosted)[0]}: empty hosted state; confirmed result, submission, membership and competition survive two restarts unchanged`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
assert.deepEqual(readFileSync('data/efootball.sqlite'), bundledBefore);
console.log('PASS bundled database unchanged; no bundled users loaded on hosted startup');
