#!/usr/bin/env node
// Run only with an explicit staging allowlist; never targets production.
// Example: node scripts/loadEflServerlessStaging.mjs \\
//  --origin=https://YOUR_STAGING_HOST --scenario=private-scenario.json \\
//  --identities=private-staging-auth.json --users=1000 --duration-sec=3600 \\
//  --confirm-staging=I_AUTHORIZE_STAGING_LOAD --output=private-load-report.json
// EFL_TGCLOUD_STAGING_ORIGIN must equal the exact requested origin.
// EFL_TGCLOUD_PRODUCTION_ORIGIN, if known, is prohibited.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateStagingTarget,runStagingLoad} from './lib/eflStagingLoad.mjs';
const options=new Map();
const allowed=new Set(['origin','scenario','identities','users','duration-sec','confirm-staging','output','local-smoke']);
for(const token of process.argv.slice(2)){
 const m=/^--([a-z-]+)(?:=(.*))?$/.exec(token);
 if(!m||!allowed.has(m[1])||options.has(m[1]))throw Error('INVALID_LOAD_ARGUMENT');
 options.set(m[1],m[2]??true);
}
const local=options.get('local-smoke')===true;
if(options.get('local-smoke')!==undefined&&!local)throw Error('INVALID_LOAD_ARGUMENT');
if(!local&&options.get('confirm-staging')!=='I_AUTHORIZE_STAGING_LOAD')
 throw Error('STAGING_LOAD_CONFIRMATION_REQUIRED');
const origin=validateStagingTarget(options.get('origin'),{
 stagingOrigin:process.env.EFL_TGCLOUD_STAGING_ORIGIN,
 productionOrigin:process.env.EFL_TGCLOUD_PRODUCTION_ORIGIN,allowLocal:local
});
const users=Number(options.get('users'));
const durationSec=Number(options.get('duration-sec'));
if(!Number.isSafeInteger(durationSec)||durationSec<1||durationSec>3600)
 throw Error('INVALID_LOAD_DURATION');
if(!options.get('scenario')||!options.get('identities'))
 throw Error('PRIVATE_STAGING_FIXTURES_REQUIRED');
const [scenario,identityFile]=await Promise.all([
 readFile(resolve(options.get('scenario')),'utf8').then(JSON.parse),
 readFile(resolve(options.get('identities')),'utf8').then(JSON.parse)
]);
if(!identityFile||!Array.isArray(identityFile.users))
 throw Error('INVALID_IDENTITY_FIXTURE');
const report=await runStagingLoad({
 origin,scenario,users,identities:identityFile.users,durationMs:durationSec*1000
});
// Do not output origins, paths with query strings, auth headers or user IDs.
const result=JSON.stringify(report,null,2)+'\n';
if(options.has('output'))await writeFile(resolve(options.get('output')),result,{flag:'wx',mode:0o600});
else process.stdout.write(result);
if(!local&&!report.loadGatePassed)process.exitCode=1;
