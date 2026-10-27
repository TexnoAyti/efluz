import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
const output=path.resolve(process.argv[2] || 'dist');
const manifest=JSON.parse(readFileSync(path.join(output,'.vite/manifest.json'),'utf8'));
const initial=new Set();
function visit(key) { if(initial.has(key))return;initial.add(key);for(const dependency of manifest[key].imports || [])visit(dependency); }
visit('index.html');
let bytes=0,gzipBytes=0;
for(const key of initial){const data=readFileSync(path.join(output,manifest[key].file));bytes+=data.length;gzipBytes+=gzipSync(data).length;}
// Before this change: 504,427 bytes / 149,825 gzip. Enforce the smaller startup path.
assert.ok(bytes<400000,`Initial JS exceeded budget: ${bytes}`);
assert.ok(gzipBytes<125000,`Initial gzip JS exceeded budget: ${gzipBytes}`);
for(const name of ['MatchdayHomeView','FirstVisitGuide','ResultSubmissionModal']){
 const matches=Object.keys(manifest).filter(key=>key.includes(name));
 assert.ok(matches.length,`${name} must remain independently downloadable`);
 assert.ok(matches.every(key=>!initial.has(key)),`${name} must not block the initial application bundle`);
}
assert.ok(statSync(path.join(output,'app-loading.css')).size<5000,'Critical loading CSS must stay small');
assert.match(readFileSync(path.join(output,'index.html'),'utf8'),/efl-loading--screen/);
console.log(`PASS startup build: ${bytes} bytes / ${gzipBytes} gzip, deferred home/help/result UI, small critical CSS and first-frame loader`);
