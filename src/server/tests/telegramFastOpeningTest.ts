import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import app from '../app';
import { getFirestoreDb } from '../firebase/admin';
import { queryAll } from '../db';
import { SEED_CLUBS } from '../db/seed';
import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { api, invalidateClientCache, setSessionToken, setTelegramInitData, getTelegramInitData } from '../../lib/api';

assert.equal((process.report.getReport() as {sharedObjects:string[]}).sharedObjects.some(name=>name.includes('canvas')),false,'Opening the API must not initialize the native image renderer');
const db=getFirestoreDb();
process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.TELEGRAM_BOT_TOKEN='isolated-opening-test-token';
const user={id:'user-12345',telegramId:'12345',username:'opening',firstName:'Opening',lastName:'',photoUrl:'',isAdmin:false,isSuspended:false,createdAt:'2026-01-01',updatedAt:'2026-01-01'};
await db.collection('users').doc(user.id).set(user);
await redisSetRaw(ReadModelKeys.clubsWithOwners(),{data:SEED_CLUBS.map(c=>({...c,ownerUserId:c.id==='club-arsenal'?user.id:null}))});
assert.throws(()=>queryAll('select 1'),'SQLite must remain uninitialized');
const originalCollection=db.collection.bind(db);
let fixtureReads=0;
db.collection=((name:string)=>{
 if(['fixtures','standings'].includes(name)){fixtureReads++;throw Error('Statistics must not run during login');}
 return originalCollection(name);
}) as any;
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:12345,username:'opening',first_name:'Opening'})});
const data=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
const secret=createHmac('sha256','WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
params.set('hash',createHmac('sha256',secret).update(data).digest('hex'));
try {
 const response=await fetch(base+'/api/auth/telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:params.toString()})});
 assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.user.id,user.id);assert.equal(result.currentClub.id,'club-arsenal');assert.ok(result.token);
 assert.equal(result.stats,undefined);assert.equal(fixtureReads,0);
 assert.match(response.headers.get('server-timing')||'',/bootstrap;dur=.*identity;dur=.*ownership;dur=/);
 assert.throws(()=>queryAll('select 1'),'Verified PostgreSQL login must not initialize SQLite');
 const bad=await fetch(base+'/api/auth/telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:'hash=invalid'})});assert.equal(bad.status,401);
 // Hold every ownership snapshot read: verified login must still finish.
 let releaseOwnership!:()=>void;
 const slowOwnership = new Promise<void>(resolve => { releaseOwnership=resolve; });
 const delayQuery = (query:any):any => new Proxy(query, { get(target,key) {
   if(key==='get') return async()=>{await slowOwnership;return target.get();};
   const value=Reflect.get(target,key);
   return typeof value==='function' ? (...args:any[])=>{
     const result=value.apply(target,args);
     return ['where','limit','orderBy','startAfter'].includes(String(key)) ? delayQuery(result) : result;
   } : value;
 }});
 db.collection=((name:string)=>name==='durable_read_snapshots'?delayQuery(originalCollection(name)):originalCollection(name)) as any;
 try {
   const started=performance.now();
   const slowLogin=await fetch(base+'/api/auth/telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:params.toString()})});
   assert.equal(slowLogin.status,200);
   const deferred=await slowLogin.json();
   assert.equal(deferred.user.id,user.id);assert.ok(deferred.token);
   assert.equal(deferred.currentClubStatus,'unavailable','Slow ownership is not reported as a verified no-club result');
   assert.ok(performance.now()-started<4000,'Ownership cannot hold login until the database timeout');
 } finally {db.collection=originalCollection;releaseOwnership();}
 const clubResponse=await fetch(base+'/api/me/club',{headers:{authorization:'Bearer '+result.token}});
 assert.equal(clubResponse.status,200);assert.equal((await clubResponse.json()).currentClub.id,'club-arsenal');
 const sessionResponse=await fetch(base+'/api/me/bootstrap',{headers:{authorization:'Bearer '+result.token}});
 assert.equal(sessionResponse.status,200);const sessionBody=await sessionResponse.json();
 assert.equal(sessionBody.user.id,user.id);assert.equal(sessionBody.stats,undefined);
 assert.equal((await fetch(base+'/api/me/club')).status,401);
 assert.equal((await fetch(base+'/api/me/bootstrap')).status,401);
 assert.equal(fixtureReads,0,'Ownership hydration and session opening never load statistics');
 assert.throws(()=>queryAll('select 1'),'Lightweight PostgreSQL session and club hydration must not initialize SQLite');
 db.collection=((name:string)=>{
  if(['fixtures','standings'].includes(name)){fixtureReads++;throw Error('Statistics must not run during login');}
  return originalCollection(name);
 }) as any;
 const originalFetch=globalThis.fetch;let posts=0,release:()=>void;
 const delay=new Promise<void>(resolve=>release=resolve);
 globalThis.fetch=(async()=>{posts++;await delay;return new Response(JSON.stringify(result),{status:200});}) as typeof fetch;
 try {
  setSessionToken(null);invalidateClientCache();
  const a=api.authenticateTelegram('same-signed-input'),b=api.authenticateTelegram('same-signed-input');
  await Promise.resolve();assert.equal(posts,1);release!();await Promise.all([a,b]);
  await api.authenticateTelegram('same-signed-input');assert.equal(posts,2,'Only concurrent login is deduplicated; subsequent login revalidates');
 } finally {globalThis.fetch=originalFetch;}
 db.collection=((name:string)=>{if(name==='users')throw Error('IDENTITY_DATABASE_UNAVAILABLE');return originalCollection(name);}) as any;
 const unavailable=await fetch(base+'/api/auth/telegram',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:params.toString()})});
 assert.equal(unavailable.status,500);assert.throws(()=>queryAll('select 1'),'Database outage must not synthesize a SQLite identity');
 const oldWindow=(globalThis as any).window, oldStorage=(globalThis as any).sessionStorage;
 let cleaned='';
 setTelegramInitData(null);
 (globalThis as any).sessionStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 (globalThis as any).window={location:{pathname:'/',search:'',hash:'#tgWebAppData='+encodeURIComponent('signed-launch')+'&tgWebAppPlatform=android'},history:{state:null,replaceState:(_:any,__:any,url:string)=>{cleaned=url;}}};
 try {
  assert.equal(getTelegramInitData(),'signed-launch');assert.equal(cleaned,'','Late SDK must still see its launch credentials');
  (globalThis as any).window.Telegram={WebApp:{initData:'signed-launch'}};
  assert.equal(getTelegramInitData(),'signed-launch');assert.equal(cleaned,'/#tgWebAppPlatform=android');
 } finally {
  (globalThis as any).window=oldWindow;(globalThis as any).sessionStorage=oldStorage;setTelegramInitData(null);
 }
 let earlyReady=0,earlyExpand=0;
 const sdkListeners:Record<string,()=>void>={};
 const browserWindow:any={location:{hash:'#tgWebAppData=untouched'}};
 const earlyScript=readFileSync('public/telegram-ready.js','utf8');
 const scriptDocument={getElementById:()=>({addEventListener:(event:string,handler:()=>void)=>{sdkListeners[event]=handler;}})};
 runInNewContext(earlyScript,{window:browserWindow,document:scriptDocument});
 assert.equal(earlyReady,0);
 browserWindow.Telegram={WebApp:{ready:()=>earlyReady++,expand:()=>earlyExpand++}};
 sdkListeners.load();assert.equal(earlyReady,1);assert.equal(earlyExpand,1);
 assert.equal(browserWindow.location.hash,'#tgWebAppData=untouched','Early ready never consumes signed launch data');
 runInNewContext(earlyScript,{window:browserWindow,document:scriptDocument});
 assert.equal(earlyReady,2,'Already-loaded SDK is also readied before React');
 assert.match(readFileSync('index.html','utf8'),/defer src="\/telegram-ready.js"/);
 assert.match(readFileSync('index.html','utf8'),/id="telegram-web-app-sdk" async/);
 assert.match(readFileSync('src/context/AuthContext.tsx','utf8'),/addEventListener\('load', onSdkReady\)/);
 console.log('PASS bounded signed PostgreSQL login and session bootstrap without SQLite/statistics, deferred ownership recovery, early native ready, authoritative club and token, invalid signature rejected, server timings, concurrent login dedupe and async SDK ready handshake');
} finally {db.collection=originalCollection;server.close();}
