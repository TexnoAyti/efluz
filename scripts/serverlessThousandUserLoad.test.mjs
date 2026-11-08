import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {runStagingLoad,validateLoadScenario,validateStagingTarget,
 validateLoadIdentities} from './lib/eflStagingLoad.mjs';

const scenario={routes:[
 {path:'/leagues',weight:40},
 {path:'/standings',weight:30},
 {path:'/fixtures',weight:20},
 {path:'/profile',weight:10}
],thinkMs:5,requestTimeoutMs:1500,thresholds:{successRate:0.99,p95Ms:500}};
const identities=n=>Array.from({length:n},(_,i)=>({
 id:'virtual-'+i,headers:{Authorization:'Bearer stage-'+i}
}));
async function withServer(handler,fn){
 const server=createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();
  return await fn('http://127.0.0.1:'+address.port);
 }finally{
  await new Promise(resolve=>server.close(resolve));
 }
}
test('1000 identities must be distinct and authorized; unknown paths and production origins are rejected',()=>{
 assert.equal(validateLoadIdentities(1000,identities(1000)).length,1000);
 assert.throws(()=>validateLoadIdentities(1000,identities(999)),
  /DISTINCT_STAGING_IDENTITIES_REQUIRED/);
 const bad=identities(2);bad[1].id=bad[0].id;
 assert.throws(()=>validateLoadIdentities(2,bad),/INVALID_STAGING_IDENTITY/);
 const duplicated=identities(2);
 duplicated[1].headers.Authorization=duplicated[0].headers.Authorization;
 assert.throws(()=>validateLoadIdentities(2,duplicated),/DUPLICATE_STAGING_AUTH_CONTEXT/);
 assert.throws(()=>validateLoadIdentities(1,[{id:'x',headers:{Host:'malicious'}}]),
  /UNSAFE_STAGING_AUTH_HEADER/);
 assert.throws(()=>validateLoadScenario({routes:[{path:'//external.example',weight:100}]}),
  /UNSAFE_LOAD_ROUTE/);
 assert.throws(()=>validateLoadScenario({routes:[{path:'/safe?q=secret',weight:100}]}),
  /UNSAFE_LOAD_ROUTE/);
 assert.throws(()=>validateStagingTarget('https://example.org',{
  stagingOrigin:'https://staging.example.org'}),/STAGING_TARGET_NOT_ALLOWLISTED/);
 assert.throws(()=>validateStagingTarget('https://prod.example.org',{
  stagingOrigin:'https://prod.example.org',productionOrigin:'https://prod.example.org'}),
  /UNSAFE_STAGING_ORIGIN/);
 assert.equal(validateStagingTarget('http://127.0.0.1:1234',{allowLocal:true}),
  'http://127.0.0.1:1234');
});
test('real HTTP virtual clients exercise mixed EFL reads concurrently with independent staging credentials',async()=>{
 const observed=new Set();
 await withServer((req,res)=>{
  observed.add(req.headers.authorization);
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end('{"ok":true}');
 },async origin=>{
  const result=await runStagingLoad({
   origin,scenario,users:16,identities:identities(16),durationMs:240
  });
  assert.equal(result.virtualUsers,16);
  assert.equal(observed.size,16);
  assert.ok(result.requests>=16);
  assert.ok(result.maxInflight>1);
  assert.equal(result.success,result.requests);
  assert.equal(result.http5xx,0);
  assert.equal(result.networkErrors,0);
  assert.ok(result.p95Ms<500);
  assert.equal(result.loadGatePassed,false,'a short smoke test is not a 1000-user proof');
  assert.equal(result.cutoverReady,false);
 });
});
test('rate limits and service failures never appear as successful load',async()=>{
 await withServer((req,res)=>{
  res.writeHead(req.url==='/leagues'?429:503);res.end('busy');
 },async origin=>{
  const result=await runStagingLoad({
   origin,scenario,users:8,identities:identities(8),durationMs:130
  });
  assert.ok(result.requests>=8);
  assert.equal(result.success,0);
  assert.equal(result.http4xx+result.http5xx,result.requests);
  assert.equal(result.loadGatePassed,false);
 });
});
test('CLI forbids running on production and keeps source secrets out of all reports',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-load-smoke-'));
 try{
  const script=new URL('./loadEflServerlessStaging.mjs',import.meta.url).pathname;
  const scenarioFile=join(dir,'scenario.json'),authFile=join(dir,'auth.json');
  await writeFile(scenarioFile,JSON.stringify(scenario));
  await writeFile(authFile,JSON.stringify({users:identities(3)}),{mode:0o600});
  const denied=spawnSync(process.execPath,[script,
   '--origin=https://production.example.org',
   '--scenario='+scenarioFile,'--identities='+authFile,
   '--users=3','--duration-sec=1',
   '--confirm-staging=I_AUTHORIZE_STAGING_LOAD'
  ],{encoding:'utf8',env:{...process.env,
   EFL_TGCLOUD_STAGING_ORIGIN:'https://staging.example.org',
   EFL_TGCLOUD_PRODUCTION_ORIGIN:'https://production.example.org'}});
  assert.notEqual(denied.status,0);
  assert.match(denied.stderr,/UNSAFE_STAGING_ORIGIN/);
  assert.doesNotMatch(denied.stderr,/stage-0/);
  await withServer((req,res)=>{res.writeHead(200);res.end('ok');},
   async origin=>{
    const reportFile=join(dir,'report.json');
    // spawn asynchronously: synchronous spawn would block the in-process HTTP server.
    const proc=spawn(process.execPath,[script,'--origin='+origin,
     '--scenario='+scenarioFile,'--identities='+authFile,'--users=3',
     '--duration-sec=1','--local-smoke','--output='+reportFile],{
     env:process.env,stdio:['ignore','pipe','pipe']
    });
    let stderr='';
    proc.stderr.on('data',chunk=>{stderr+=chunk.toString();});
    const exit=await new Promise(resolve=>proc.on('close',resolve));
    assert.equal(exit,0,stderr);
    const report=JSON.parse(await readFile(reportFile,'utf8'));
    assert.equal(report.virtualUsers,3);
    assert.equal(report.loadGatePassed,false);
    assert.equal(report.cutoverReady,false);
    assert.doesNotMatch(JSON.stringify(report)+stderr,/stage-0/);
   });
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('identity probe must verify the server-side identity rather than trusting distinct token strings',async()=>{
 await withServer((req,res)=>{
  const matches=/^Bearer stage-(\\d+)$/.exec(req.headers.authorization??'');
  const id=matches?'virtual-'+matches[1]:'unknown';
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({id}));
 },async origin=>{
  const result=await runStagingLoad({
   origin,scenario:{...scenario,identityProbe:{path:'/whoami',field:'id'}},
   users:16,identities:identities(16),durationMs:180
  });
  assert.equal(result.verifiedAuthContexts,16);
  assert.equal(result.authProbeFailed,0);
  assert.equal(result.cutoverReady,false);
 });
});
test('successful HTTP responses are not counted as authenticated users without matching server identity',async()=>{
 await withServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end('{"id":"a-shared-anonymous-identity"}');
 },async origin=>{
  const result=await runStagingLoad({
   origin,scenario:{...scenario,identityProbe:{path:'/whoami',field:'id'}},
   users:10,identities:identities(10),durationMs:160
  });
  assert.equal(result.verifiedAuthContexts,0);
  assert.equal(result.authProbeFailed,10);
  assert.ok(result.success>0);
  assert.equal(result.loadGatePassed,false);
 });
});
