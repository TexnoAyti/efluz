#!/usr/bin/env node
// Offline structural preflight: Telegram's V8 isolate can load only SDK and
// relative .js modules inside tgcloud/. Does not deploy or access secrets.
import {readdir,readFile,stat} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../tgcloud/',import.meta.url)));
const paths=[];
async function visit(dir){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const full=resolve(dir,entry.name);
  if(entry.isDirectory())await visit(full);
  else if(entry.isFile()&&entry.name.endsWith('.js'))paths.push(full);
 }
}
await visit(root);
let errors=[];
for(const full of paths){
 const source=await readFile(full,'utf8');
 const file=relative(root,full);
 // Project modules use static imports only. Dynamic imports are not
 // supported in the isolate and must not be used for feature routing.
 if(/\bimport\s*\(/.test(source))errors.push(file+':dynamic_import');
 const rx=/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?['"]([^'"]+)['"]/g;
 for(const match of source.matchAll(rx)){
  const spec=match[1];
  if(spec==='sdk'||spec==='sdk/db'||spec==='sdk/api'||spec==='sdk/fetch')continue;
  if(!spec.startsWith('.')||!spec.endsWith('.js')){
   errors.push(file+':unsupported_import:'+spec);continue;
  }
  const target=resolve(dirname(full),spec);
  if(target!==root&&!target.startsWith(root+sep)){
   errors.push(file+':outside_project:'+spec);continue;
  }
  try {if(!(await stat(target)).isFile())errors.push(file+':missing_import:'+spec);}
  catch{errors.push(file+':missing_import:'+spec);}
 }
 if((file.startsWith('endpoints/')||file.startsWith('handlers/')) &&
    !/export\s+default\s+/.test(source))errors.push(file+':missing_default_export');
}
if(!paths.some(x=>relative(root,x).replaceAll(sep,'/')==='schema.js'))errors.push('schema_missing');
if(errors.length){console.error(JSON.stringify({ok:false,files:paths.length,errors},null,2));process.exitCode=1;}
else console.log(JSON.stringify({ok:true,files:paths.length,deploy:false}));
