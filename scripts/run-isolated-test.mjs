import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const target = process.argv[2];
if (!target || !/^src\/server\/tests\/[A-Za-z0-9]+\.ts$/.test(target)) throw new Error('Expected a server test file');
const directory = mkdtempSync(path.join(tmpdir(), 'efluz-isolated-'));
try {
  const result = spawnSync(process.execPath, ['--require', './scripts/block-external-network.cjs', '--import', 'tsx', target], {
    cwd: process.cwd(), stdio: 'inherit', timeout: 180000,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', FIREBASE_FORCE_LOCAL_FALLBACK: 'true', DATA_DIR: directory, DB_FILE: path.join(directory, 'test.sqlite'), ALLOW_TEST_WRITES: 'false' },
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
