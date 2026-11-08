#!/usr/bin/env node
// Read-only frontend API dependency inventory for the EFLUZ Serverless migration.
// No credentials, no network requests, no deployments and no production writes.
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(fileURLToPath(new URL('../src/',import.meta.url)));
const files=[];
async function walk(dir){
  for(const item of await readdir(dir,{withFileTypes:true})){
    const full=join(dir,item.name);
    if(item.isDirectory()) await walk(full);
    else if(/\.(ts|tsx|js|jsx)$/.test(item.name)) files.push(full);
  }
}
await walk(root);
const sources=await Promise.all(files.map(async file=>({
  file:relative(root,file).replaceAll('\\','/'),
  content:await readFile(file,'utf8')
})));
const api=sources.find(f=>f.file==='lib/api.ts');
if(!api)throw Error('FRONTEND_API_FILE_MISSING');
const matches=[...api.content.matchAll(/\brequest(?:<[^;\n]*?>)?\s*\(\s*([`'"])([\s\S]*?)\1\s*,?/g)];
const endpointSet=new Set();
let dynamic=0;
for(const match of matches){
  const value=match[2];
  const base=value.split('?')[0].replace(/\$\{[^}]+\}/g,'{param}');
  if(!base.startsWith('/api/'))continue;
  endpointSet.add(base);
  if(value.includes('${'))dynamic++;
}
const requestSites=sources.map(({file,content})=>({
 file,
 calls:(content.match(/\bfetch\s*\(/g)||[]).length,
 apiStrings:(content.match(/\/api\//g)||[]).length,
 xhr:(content.match(/\bXMLHttpRequest\b/g)||[]).length,
 sockets:(content.match(/\b(?:WebSocket|EventSource)\s*\(/g)||[]).length,
})).filter(row=>row.calls||row.apiStrings||row.xhr||row.sockets);
const directFetchOutsideApi=requestSites.filter(x=>x.file!=='lib/api.ts'&&x.calls);
const routeList=[...endpointSet].sort();
const report={
  status:'FRONTEND_MIGRATION_INCOMPLETE',
  productionCutoverReady:false,
  legacyApiTransportUsed:true,
  analyzedFiles:files.length,
  knownLegacyRequestCallsites:matches.length,
  distinctStaticRouteShapes:routeList.length,
  templatedApiRequests:dynamic,
  directFetchFilesOutsideApi:directFetchOutsideApi.length,
  directFetchCallsitesOutsideApi:directFetchOutsideApi.reduce((n,x)=>n+x.calls,0),
  xhrFiles:requestSites.filter(x=>x.xhr).map(x=>x.file),
  socketFiles:requestSites.filter(x=>x.sockets).map(x=>x.file),
  // These route shapes are literal code metadata only, never live user data.
  legacyRouteShapes:routeList,
  next:'Port authenticated read and mutation contracts to Serverless; verify UI parity before changing tgcloud static root.'
};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--strict'))process.exitCode=1;
