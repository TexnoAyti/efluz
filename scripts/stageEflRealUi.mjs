#!/usr/bin/env node
// Copy verified original EFLUZ React candidate into the isolated staging CDN
// directory expected by tgcloud.jsonc. NEVER deploys or touches credentials.
import {cp,mkdir,readFile,rename,rm,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const source=join(root,'dist-efl-serverless-ui');
const dest=join(root,'dist-tgcloud');
const html=await readFile(join(source,'efl-serverless-preview.html'),'utf8');
if(!html.includes('EFLUZ')||!html.includes('noindex,nofollow')||
   !html.includes('id="root"'))throw Error('STAGING_REAL_UI_SOURCE_INVALID');
const entries=await readdir(source);
if(!entries.some(x=>x==='assets')||!entries.includes('efl-serverless-preview.html'))
  throw Error('STAGING_REAL_UI_ASSETS_MISSING');
// Do not remove an existing staging build until the source has been checked.
await rm(dest,{recursive:true,force:true});
await mkdir(dest,{recursive:true});
await cp(source,dest,{recursive:true});
await rename(join(dest,'efl-serverless-preview.html'),join(dest,'index.html'));
console.log('STAGING_REAL_UI_STATIC_READY: dist-tgcloud; NOT DEPLOYED');
