import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const tests = readdirSync('src/server/tests').filter(name => /^telegramAi[A-Za-z]+RegressionTest\.ts$/.test(name)).sort();
let failed = 0;
for (const test of tests) {
  const result = spawnSync(process.execPath, ['scripts/run-isolated-test.mjs', `src/server/tests/${test}`], {
    encoding: 'utf8', timeout: 190000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status === 0) console.log(`PASS ${test}`);
  else {
    failed++;
    console.error(`FAIL ${test}\n${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`);
  }
}
console.log(`${tests.length - failed}/${tests.length} Telegram AI regression files passed (isolated, external network blocked).`);
process.exitCode = failed ? 1 : 0;
