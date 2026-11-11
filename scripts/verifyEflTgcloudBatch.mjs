#!/usr/bin/env node
/**
 * Telegram Serverless bulk terminal preflight.
 * Single command, offline-only: checks every Serverless unit suite, SDK import
 * graph and browser packaging. It NEVER calls tgcloud push/migrate/webhook,
 * imports live production data, or reads credentials.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDir = join(root, 'scripts');
const arg = process.argv.slice(2);
if (arg.some(x => !['--list', '--skip-build'].includes(x))) {
  console.error('Usage: node scripts/verifyEflTgcloudBatch.mjs [--list] [--skip-build]');
  process.exit(2);
}
const suites = readdirSync(scriptsDir)
  .filter(name => /^serverless[A-Za-z0-9-]*\.test\.mjs$/.test(name))
  .sort()
  .map(name => join('scripts', name));
if (suites.length < 40) throw Error('SERVERLESS_SUITE_INVENTORY_INCOMPLETE');
if (arg.includes('--list')) {
  console.log(JSON.stringify({mode:'offline',readOnly:true,deploy:false,suiteCount:suites.length,suites},null,2));
  process.exit(0);
}
const env = { ...process.env, NODE_ENV:'test', DISABLE_BACKGROUND_WORKERS:'true' };
delete env.TGCLOUD_TOKEN;
delete env.EFL_SOURCE_DATABASE_URL;
delete env.SUPABASE_SERVICE_ROLE_KEY;
const results=[];
function step(name, command, args, timeout=180000) {
  console.log('[TGCLOUD_BATCH] '+name);
  const t=Date.now();
  const run=spawnSync(command,args,{
    cwd:root,env,encoding:'utf8',timeout,maxBuffer:3*1024*1024,
    shell:false,windowsHide:true,
  });
  const result={step:name,ok:run.status===0&&!run.error,durationMs:Date.now()-t,
    status:run.status,signal:run.signal||null};
  results.push(result);
  if (run.stdout) process.stdout.write(run.stdout.slice(-16000));
  if (run.stderr) process.stderr.write(run.stderr.slice(-16000));
  if (!result.ok) {
    console.error('[TGCLOUD_BATCH] FAIL '+name+
      (run.error?' '+run.error.code:'')+'; no deployment or import attempted.');
    return false;
  }
  return true;
}
// Verify all local imports before executing any tests. No third-party runtime
// SDK or actual staging session is required for this offline check.
const checks=[
  ['isolated-runtime-modules',process.execPath,['scripts/checkTgcloudModules.mjs']],
  ['native-bot-modules-syntax',process.execPath,['scripts/checkTgcloudModules.mjs']],
  ['all-serverless-unit-suites',process.execPath,
    ['--test','--test-concurrency=2',...suites]],
];
let ok=true;
for (const [name,cmd,args] of checks) {
  if (name==='native-bot-modules-syntax') continue; // checked individually below
  if (!step(name,cmd,args,name==='all-serverless-unit-suites'?540000:30000)) {ok=false;break;}
}
if (ok) {
  const files=[];
  function walk(dir){
    for (const d of readdirSync(dir,{withFileTypes:true})){
      const p=join(dir,d.name);
      if (d.isDirectory())walk(p);
      else if(d.isFile()&&d.name.endsWith('.js'))files.push(relative(root,p));
    }
  }
  walk(join(root,'tgcloud'));
  if (files.length<35) throw Error('TGCLOUD_MODULE_INVENTORY_INCOMPLETE');
  if (!step('all-tgcloud-javascript-syntax',process.execPath,
    ['--check','tgcloud/schema.js'])) ok=false;
  for (const file of files) {
    if (!ok) break;
    // Most modules are ECMAScript modules and Node --check parses them offline.
    const r=spawnSync(process.execPath,['--check',file],{
      cwd:root,env,encoding:'utf8',timeout:10000,windowsHide:true
    });
    if (r.status!==0 || r.error) {
      console.error('SYNTAX_FAILURE: '+file+'\n'+String(r.stderr||r.error));
      results.push({step:'syntax:'+file,ok:false,status:r.status});
      ok=false;
    }
  }
  if(ok)results.push({step:'all-runtime-module-syntax',ok:true,files:files.length});
}
if (ok&&!arg.includes('--skip-build')) {
  if (!step('build-isolated-telegram-miniapp','bun',['run','build:tgcloud'],180000))ok=false;
  if (ok&&!step('verify-isolated-static-output',process.execPath,['scripts/verifyTgcloudStatic.mjs']))ok=false;
  if (ok&&!step('build-full-react-shadow-ui','bun',['run','build:tgcloud:real-ui'],180000))ok=false;
  if (ok&&!step('verify-full-react-shadow-ui','bun',['run','verify:tgcloud:real-ui'],90000))ok=false;
}
console.log(JSON.stringify({ok,mode:'offline',deploy:false,import:false,webhookUnchanged:true,
  suites:suites.length,results},null,2));
if (!ok) process.exitCode=1;
