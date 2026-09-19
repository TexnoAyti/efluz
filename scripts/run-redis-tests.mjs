import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
const serverBin = process.env.REDIS_SERVER_BIN || 'redis-server';
const cliBin = process.env.REDIS_CLI_BIN || (serverBin.includes('/') ? path.join(path.dirname(serverBin),'redis-cli') : 'redis-cli');
const directory = mkdtempSync(path.join(tmpdir(), 'efluz-redis-'));
const socket = path.join(directory,'redis.sock');
const reservation = net.createServer();
await new Promise(resolve => reservation.listen(0,'127.0.0.1',resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const server = spawn(serverBin, ['--port',String(port),'--bind','127.0.0.1','--save','','--appendonly','no','--dir',directory], { stdio: 'ignore' });
let startError;
server.on('error', error => { startError = error; });
try {
  let ready = false;
  for (let i=0; i<100 && !ready && !startError; i++) {
    ready = spawnSync(cliBin,['-h','127.0.0.1','-p',String(port),'PING'],{encoding:'utf8'}).stdout?.trim() === 'PONG';
    if (!ready) await new Promise(r=>setTimeout(r,50));
  }
  if (!ready) throw startError || new Error('Local Redis did not start; set REDIS_SERVER_BIN');
  const result = spawnSync(process.execPath, ['--require','./scripts/block-external-network.cjs','--import','tsx','src/server/tests/redisDurabilityRegressionTest.ts'], {
    stdio:'inherit', timeout:120000,
    env:{ PATH:process.env.PATH, NODE_ENV:'test', FIREBASE_FORCE_LOCAL_FALLBACK:'true', DATA_DIR:directory, REDIS_TEST_PORT:String(port), REDIS_TEST_CLI:cliBin },
  });
  if (result.error) console.error(result.error.message);
  process.exitCode=result.status ?? 1;
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit',resolve));
  rmSync(directory,{recursive:true,force:true});
}
