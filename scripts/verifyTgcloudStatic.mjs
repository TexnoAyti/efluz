#!/usr/bin/env node
// Fail closed if a server bundle, private file, or source map leaks into
// the CDN directory. This is a local audit, not a production deployment.
import {readdir,readFile,stat} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../dist-tgcloud/',import.meta.url)));
const assets=[];
async function scan(dir){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const full=resolve(dir,entry.name);
  const rel=relative(root,full).replaceAll(sep,'/');
  if(entry.isDirectory())await scan(full);
  else if(entry.isFile())assets.push(rel);
 }
}
await scan(root);
if(!assets.includes('index.html'))throw Error('STATIC_ENTRY_MISSING');
const prohibited=assets.filter(file=>
  file==='server.cjs'||file.startsWith('api/')||
  file.endsWith('.map')||file.endsWith('.sql')||
  file.endsWith('.sqlite')||file.endsWith('.db')||
  file.startsWith('.tgcloud/')||file.startsWith('tgcloud/')||
  file.startsWith('src/server/')||file.startsWith('.env'));
if(prohibited.length)throw Error('SERVER_OR_PRIVATE_STATIC_ASSET:'+prohibited.join(','));
const html=await readFile(resolve(root,'index.html'),'utf8');
if(!html.includes('id="root"')||!html.includes('Serverless sinov muhiti'))
  throw Error('ISOLATED_STAGING_ENTRY_MISSING');
const scripts=assets.filter(file=>file.endsWith('.js'));
if(!scripts.length)throw Error('STAGING_SCRIPT_MISSING');
for(const file of scripts){
  const js=await readFile(resolve(root,file),'utf8');
  if(/\/api\/|\/api\b|vercel\.app/i.test(js))
    throw Error('LEGACY_API_IN_STAGING_BUNDLE');
}
console.log(JSON.stringify({ok:true,files:assets.length,isolatedStaging:true,onlyFrontend:true}));
