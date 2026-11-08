#!/usr/bin/env node
// Isolated original React preview validation. Never deploy this directory.
import {readdir,readFile} from 'node:fs/promises';
import {resolve,relative,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../dist-efl-original-preview/',import.meta.url)));
const files=[];
async function walk(dir){
 for(const item of await readdir(dir,{withFileTypes:true})){
  const full=join(dir,item.name);
  if(item.isDirectory())await walk(full);
  else if(item.isFile())files.push(relative(root,full).replaceAll(sep,'/'));
 }
}
await walk(root);
if(!files.includes('efl-original-preview.html'))throw Error('ORIGINAL_PREVIEW_ENTRY_MISSING');
const html=await readFile(join(root,'efl-original-preview.html'),'utf8');
if(!html.includes('EFLUZ')||!html.includes('noindex,nofollow'))
 throw Error('ORIGINAL_PREVIEW_MARKER_MISSING');
const forbidden=files.filter(name=>name.startsWith('api/')||name.startsWith('tgcloud/')||
 name.endsWith('.map')||name.endsWith('.db')||name.endsWith('.sqlite')||
 name.endsWith('.sql')||name.endsWith('server.cjs')||name.startsWith('.env'));
if(forbidden.length)throw Error('PRIVATE_OR_BACKEND_ASSETS_FOUND');
const scripts=files.filter(name=>name.endsWith('.js'));
if(!scripts.length)throw Error('ORIGINAL_PREVIEW_JS_MISSING');
const allJs=(await Promise.all(scripts.map(name=>readFile(join(root,name),'utf8')))).join('\n');
if(!allJs.includes('EFL_ORIGINAL_PREVIEW_NETWORK_DISABLED')||
 !allJs.includes('EFL_ORIGINAL_PREVIEW_XHR_DISABLED')||
 !allJs.includes('ORIGINAL UI PREVIEW'))
 throw Error('NETWORK_ISOLATION_MARKER_MISSING');
console.log(JSON.stringify({ok:true,originalReactPreview:true,isolatedFromBackend:true,
 files:files.length,deployed:false,cutoverReady:false}));
