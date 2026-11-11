import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve('src/server');
const all=[];
function walk(dir){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,e.name);
  if(e.isDirectory())walk(p);
  else if(/\.(ts|tsx)$/.test(e.name))all.push(p);
 }
}
walk(root);
const patterns={
 sqliteDirect: /(?:from\s*['"][^'"]*\/db(?:\/index)?['"]|require\(['"][^'"]*\/db['"]\)|(?:\bqueryGet|\bqueryAll|\bqueryRun|\binitDatabase|\bgetDbFilePath)\s*\()/g,
 firestoreSdk: /(?:from\s*['"]firebase-admin\/(?:firestore|app)['"]|\bgetFirestoreDb\s*\()/g,
 redis: /\b(?:getUpstashClient|getBoundedRedisClient|redisGetRaw|redisSetRaw)\s*\(/g,
 tmpPersistence: /(?:\/tmp\/data|efootball\.sqlite|\bDB_FILE\b)/g,
};
const scan=all.filter(p=>!/(?:\/tests\/|\/migration\/|\/db\/|\/scripts\/)/.test(p.replaceAll('\\','/'))).map(p=>{
 const source=fs.readFileSync(p,'utf8'),rel=path.relative(process.cwd(),p).replaceAll('\\','/');
 const counts=Object.fromEntries(Object.entries(patterns).map(([k,re])=>{re.lastIndex=0;return[k,[...source.matchAll(re)].length]}));
 return {file:rel,...counts};
}).filter(r=>Object.keys(patterns).some(k=>r[k]>0));
const totals=Object.fromEntries(Object.keys(patterns).map(k=>[k,scan.reduce((n,r)=>n+r[k],0)]));
const top=scan.filter(r=>r.sqliteDirect||r.tmpPersistence).sort((a,b)=>(b.sqliteDirect+b.tmpPersistence)-(a.sqliteDirect+a.tmpPersistence)).slice(0,35);
console.log(JSON.stringify({audit:'serverless-legacy-direct-dependency-inventory',generatedAt:new Date().toISOString(),sourceFiles:all.length,filesWithMatches:scan.length,totals,top},null,2));
if(!fs.readFileSync('src/server/routes/health.routes.ts','utf8').includes("workerLaneEnabled('reconciliation')"))throw Error('Admin sync must be protected by recovery lane');
