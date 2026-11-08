// Real HTTP load runner for an isolated staging Mini App/backend.
// This does not test production, nor claim 1000 real users without 1000 distinct
// staging auth identities. In-memory latency histogram keeps memory bounded.
import {performance} from 'node:perf_hooks';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MAX_MS=30000;
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
export function validateLoadScenario(config){
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('INVALID_LOAD_SCENARIO');
 const {routes,thinkMs=400,requestTimeoutMs=5000}=config;
 if(!Array.isArray(routes)||!routes.length||routes.length>32||
    !integer(thinkMs,0,10000)||!integer(requestTimeoutMs,100,MAX_MS))
  throw Error('INVALID_LOAD_SCENARIO');
 let sum=0;
 const safeRoutes=routes.map(row=>{
  if(!row||row.method!==undefined&&row.method!=='GET'||
     typeof row.path!=='string'||!/^\/[A-Za-z0-9/_-]*$/.test(row.path)||
     row.path.startsWith('//')||!integer(row.weight,1,100))
   throw Error('UNSAFE_LOAD_ROUTE');
  sum+=row.weight;
  return {path:row.path,weight:row.weight};
 });
 if(sum!==100)throw Error('LOAD_WEIGHTS_NOT_100');
 let identityProbe=null;
 if(config.identityProbe!==undefined){
  const probe=config.identityProbe;
  if(!probe||typeof probe!=='object'||Array.isArray(probe)||
     typeof probe.path!=='string'||!/^\\/[A-Za-z0-9/_-]*$/.test(probe.path)||
     probe.path.startsWith('//')||
     !['id','userId','telegramId'].includes(probe.field))
   throw Error('INVALID_AUTH_IDENTITY_PROBE');
  identityProbe={path:probe.path,field:probe.field};
 }
 return {routes:safeRoutes,thinkMs,requestTimeoutMs,identityProbe};
}
export function validateStagingTarget(origin,{stagingOrigin,productionOrigin,allowLocal=false}={}){
 let target;
 try{target=new URL(origin);}catch{throw Error('INVALID_STAGING_ORIGIN');}
 if(target.username||target.password||target.search||target.hash||target.pathname!=='/'||
   target.origin===new URL(productionOrigin||'https://production.invalid').origin)
  throw Error('UNSAFE_STAGING_ORIGIN');
 const local=target.protocol==='http:'&&
  ['localhost','127.0.0.1','[::1]'].includes(target.hostname);
 if(local&&allowLocal)return target.origin;
 if(target.protocol!=='https:'||!stagingOrigin||target.origin!==new URL(stagingOrigin).origin||
    target.hostname==='localhost'||target.hostname==='127.0.0.1')
  throw Error('STAGING_TARGET_NOT_ALLOWLISTED');
 return target.origin;
}
export function validateLoadIdentities(users,identities){
 if(!integer(users,1,1000))throw Error('INVALID_LOAD_USER_COUNT');
 if(!Array.isArray(identities)||identities.length!==users)
  throw Error('DISTINCT_STAGING_IDENTITIES_REQUIRED');
 const seen=new Set(),seenCredentials=new Set();
 return identities.map(row=>{
  if(!row||typeof row.id!=='string'||!row.id||seen.has(row.id)||
   !row.headers||typeof row.headers!=='object'||Array.isArray(row.headers))
   throw Error('INVALID_STAGING_IDENTITY');
  seen.add(row.id);
  const headers={};
  for(const [key,value] of Object.entries(row.headers)){
   if(!['authorization','x-telegram-init-data','cookie'].includes(key.toLowerCase())||
      typeof value!=='string'||!value||/[\r\n]/.test(value))
    throw Error('UNSAFE_STAGING_AUTH_HEADER');
   headers[key]=value;
  }
  if(!Object.keys(headers).length)throw Error('STAGING_AUTH_REQUIRED');
  const signature=JSON.stringify(Object.entries(headers)
   .map(([k,v])=>[k.toLowerCase(),v]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(seenCredentials.has(signature))throw Error('DUPLICATE_STAGING_AUTH_CONTEXT');
  seenCredentials.add(signature);
  return {headers};
 });
}
function percentile(hist,count,fraction){
 if(!count)return null;
 const at=Math.ceil(count*fraction);let cumulative=0;
 for(let i=0;i<hist.length;i++){
  cumulative+=hist[i];
  if(cumulative>=at)return i;
 }
 return MAX_MS;
}
export async function runStagingLoad({
 origin,scenario,users,identities,durationMs,
 fetchImpl=fetch,now=()=>performance.now(),jitter=Math.random
}){
 const source=validateLoadScenario(scenario);
 if(!integer(durationMs,100,3600000))throw Error('INVALID_LOAD_DURATION');
 const auth=validateLoadIdentities(users,identities);
 let verifiedAuthContexts=0,authProbeFailed=0;
 if(source.identityProbe){
  // Verify actual staging responses identify each caller as the expected user.
  // Unique header strings alone do not prove the server authenticated them.
  // Bounded 25-client batches avoid uncontrolled auth-probe bursts.
  for(let offset=0;offset<users;offset+=25){
   const slice=auth.slice(offset,offset+25);
   await Promise.all(slice.map(async(identity,index)=>{
    const expectedId=identities[offset+index].id;
    try{
     const response=await fetchImpl(origin+source.identityProbe.path,{
      method:'GET',headers:identity.headers,redirect:'manual',cache:'no-store',
      signal:AbortSignal.timeout(source.requestTimeoutMs)
     });
     if(response.status<200||response.status>=300){
      authProbeFailed++;
      await response.body?.cancel?.();
      return;
     }
     const contentLength=Number(response.headers?.get?.('content-length')??0);
     if(contentLength>8192){
      authProbeFailed++;
      await response.body?.cancel?.();
      return;
     }
     const raw=await response.text();
     if(raw.length>8192){authProbeFailed++;return;}
     const body=JSON.parse(raw);
     if(body&&String(body[source.identityProbe.field])===expectedId)
      verifiedAuthContexts++;
     else authProbeFailed++;
    }catch{authProbeFailed++;}
   }));
  }
 }
 const hist=new Uint32Array(MAX_MS+1);
 const metrics={virtualUsers:users,requests:0,success:0,http4xx:0,http5xx:0,
  timeouts:0,networkErrors:0,otherHttp:0,maxInflight:0,maxResponseMs:0,
  perRoute:Object.fromEntries(source.routes.map(({path})=>[path,{requests:0,errors:0}]))};
 let inflight=0;
 const start=now(),end=start+durationMs;
 const choose=()=>{
  const x=jitter()*100;let cumulative=0;
  for(const route of source.routes){cumulative+=route.weight;if(x<cumulative)return route;}
  return source.routes.at(-1);
 };
 async function userLoop(index){
  // Each virtual user has a distinct authorization context; no shared auth.
  const headers=auth[index].headers;
  while(now()<end){
   const route=choose(),begin=now();
   inflight++;
   metrics.maxInflight=Math.max(metrics.maxInflight,inflight);
   let failed=false,elapsed=0;
   try{
    const resp=await fetchImpl(origin+route.path,{
     method:'GET',headers,redirect:'manual',cache:'no-store',
     signal:AbortSignal.timeout(source.requestTimeoutMs)
    });
    if(resp.status>=200&&resp.status<300)metrics.success++;
    else{
     failed=true;
     if(resp.status>=500)metrics.http5xx++;
     else if(resp.status>=400)metrics.http4xx++;
     else metrics.otherHttp++;
    }
    // Don't buffer the response. Free the body so fetch can reclaim resources.
    await resp.body?.cancel?.();
   }catch(err){
    failed=true;
    if(err?.name==='TimeoutError'||err?.name==='AbortError')metrics.timeouts++;
    else metrics.networkErrors++;
   }finally{
    elapsed=Math.max(0,Math.min(MAX_MS,Math.ceil(now()-begin)));
    hist[elapsed]++;
    metrics.maxResponseMs=Math.max(metrics.maxResponseMs,elapsed);
    metrics.requests++;
    metrics.perRoute[route.path].requests++;
    if(failed)metrics.perRoute[route.path].errors++;
    inflight--;
   }
   // Independent user pacing; do not serialize virtual users globally.
   if(now()>=end)break;
   const pause=Math.min(end-now(),Math.floor(source.thinkMs*(0.5+jitter())));
   if(pause>0)await wait(pause);
  }
 }
 await Promise.all(Array.from({length:users},(_,i)=>userLoop(i)));
 const elapsedMs=Math.ceil(now()-start);
 const successRate=metrics.requests?metrics.success/metrics.requests:0;
 const p95Ms=percentile(hist,metrics.requests,0.95);
 const p99Ms=percentile(hist,metrics.requests,0.99);
 const threshold=scenario.thresholds??{successRate:0.999,p95Ms:500};
 if(!Number.isFinite(threshold.successRate)||threshold.successRate<0||
    threshold.successRate>1||!integer(threshold.p95Ms,1,MAX_MS))
  throw Error('INVALID_LOAD_THRESHOLDS');
 const loadGatePassed=verifiedAuthContexts===users&&authProbeFailed===0&&
   users===1000&&durationMs>=3600000&&
   metrics.requests>=1000&&successRate>=threshold.successRate&&
   p95Ms<=threshold.p95Ms;
 return {testType:'HTTP_STAGING_AUTHENTICATED_VIRTUAL_USERS',durationMs,
  elapsedMs,...metrics,p95Ms,p99Ms,successRate,
  requestsPerSecond:Number((metrics.requests/(elapsedMs/1000)).toFixed(2)),
  verifiedAuthContexts,authProbeFailed,loadGatePassed,cutoverReady:false,
  note:'1000 server-verified staging identities and 60 minutes are required. Missing identityProbe means the load gate cannot pass. HTTP success alone never authorizes production cutover.'};
}
