#!/usr/bin/env node
// Read-only audit for the isolated original React Serverless UI candidate.
// This is NOT a production readiness gate: auth, writes, and data import remain pending.
import {readdir,readFile} from 'node:fs/promises';
import {join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../dist-efl-serverless-ui/',import.meta.url)));
const files=[];
async function walk(dir){
  for(const ent of await readdir(dir,{withFileTypes:true})){
    const full=join(dir,ent.name);
    if(ent.isDirectory())await walk(full);
    else if(ent.isFile())files.push(relative(root,full).replaceAll(sep,'/'));
  }
}
await walk(root);
const htmlName='efl-serverless-preview.html';
if(!files.includes(htmlName))throw Error('ORIGINAL_UI_ENTRY_MISSING');
const html=await readFile(join(root,htmlName),'utf8');
if(!html.includes('EFLUZ')||!html.includes('noindex,nofollow'))throw Error('ORIGINAL_UI_PREVIEW_MARKER_MISSING');
const forbidden=files.filter(x=>x.startsWith('api/')||x.startsWith('src/server/')||
 x.startsWith('.env')||x.endsWith('.map')||x.endsWith('.db')||
 x.endsWith('.sqlite')||x.endsWith('.sql')||x.endsWith('server.cjs'));
if(forbidden.length)throw Error('NON_BROWSER_ASSETS:'+forbidden.join(','));
const scripts=files.filter(x=>x.endsWith('.js'));
if(!scripts.length)throw Error('ORIGINAL_UI_SCRIPTS_MISSING');
const bundled=(await Promise.all(scripts.map(x=>readFile(join(root,x),'utf8')))).join('\n');
for(const marker of ['SERVERLESS_ROUTE_NOT_MIGRATED','SERVERLESS_WRITE_NOT_MIGRATED',
 'SERVERLESS_VERCEL_FALLBACK_FORBIDDEN','SERVERLESS_RESPONSE_CONTRACT_MISMATCH']){
  if(!bundled.includes(marker))throw Error('SERVERLESS_GATEWAY_NOT_BUNDLED:'+marker);
}
console.log(JSON.stringify({ok:true,originalReactUi:true,readOnlyGateway:true,
 files:files.length,deployed:false,authReady:false,writesReady:false,productionCutoverReady:false}));
