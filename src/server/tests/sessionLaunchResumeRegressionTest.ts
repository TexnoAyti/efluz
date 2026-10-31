import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import app from '../app';
import {getFirestoreDb} from '../firebase/admin';
import {createSessionToken} from '../auth/sessionToken';
import {queryAll} from '../db';
import {api,setSessionToken,setTelegramInitData,invalidateClientCache} from '../../lib/api';
import {loadLoginBootstrap} from '../../lib/loginBootstrap';
import {sessionRefreshDue} from '../../lib/sessionRefresh';
const now=1_800_000_000_000;
const schedulingToken=(iat:number,exp:number)=>'header.'+Buffer.from(JSON.stringify({iat,exp})).toString('base64url')+'.signature';
assert.equal(sessionRefreshDue(schedulingToken(now/1000,now/1000+900),now,now),false);
assert.equal(sessionRefreshDue(schedulingToken(now/1000-600,now/1000+300),now,now),true,'Resumed old session must refresh despite a recent component mount');
assert.equal(sessionRefreshDue(schedulingToken(now/1000,now/1000+60),now,now),true);
assert.equal(sessionRefreshDue('malformed',now,now),false);
assert.equal(sessionRefreshDue('malformed',now-600_000,now),true);
process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.TELEGRAM_BOT_TOKEN='isolated-session-launch-test-token';
const user={id:'user-12345',telegramId:'12345',username:'session',firstName:'Session',isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''};
const token=createSessionToken(user),db=getFirestoreDb(),originalCollection=db.collection.bind(db),originalTransaction=db.runTransaction.bind(db);
let userReads=0,writes=0,maintenanceReads=0;
(db as any).collection=(name:string)=>{
 if(name==='users'){userReads++;throw Error('IDENTITY_DATABASE_UNAVAILABLE');}
 if(['result_refresh_jobs','matchday_notification_jobs'].includes(name))maintenanceReads++;
 const query:any={where:()=>query,limit:()=>query,get:()=>name==='durable_read_snapshots'?new Promise(()=>{}):Promise.resolve({docs:[],size:0,empty:true})};
 return query;
};
(db as any).runTransaction=()=>{writes++;throw Error('Identity resume must not write');};
const launch=(id:number,date=Math.floor(Date.now()/1000))=>{
 const params=new URLSearchParams({auth_date:String(date),user:JSON.stringify({id,first_name:'Launch'})});
 const check=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
 params.set('hash',createHmac('sha256',secret).update(check).digest('hex'));return params.toString();
};
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const host=`http://127.0.0.1:${(server.address() as any).port}`, originalFetch=globalThis.fetch;
const request=(initData:string,session=token)=>originalFetch(host+'/api/me/bootstrap?seasonId=season-2026-27',{headers:{authorization:'Bearer '+session,'x-telegram-launch-data':initData}});
try {
 assert.throws(()=>queryAll('select 1'));
 const matching=await request(launch(12345));assert.equal(matching.status,200);const identity:any=await matching.json();
 assert.equal(identity.user.id,user.id);assert.equal(identity.currentClubStatus,'unavailable','Unknown ownership must not be fabricated as resolved/no club');
 assert.equal(identity.stats,undefined);assert.equal(userReads,0);assert.equal(writes,0);
 for(const data of [launch(99999),'hash=invalid',launch(12345,Math.floor(Date.now()/1000)-86401),launch(12345,Math.floor(Date.now()/1000)+120)]){
  const response=await request(data);assert.equal(response.status,401);assert.equal((await response.json()).user,undefined,'Mismatched/invalid launch cannot expose an old session identity');
 }
 assert.equal((await request(launch(12345),'invalid-session')).status,401);
 assert.equal((await request(launch(12345),createSessionToken(user,-1))).status,401);
 assert.equal(userReads,0,'Rejected resumes cannot fall through to a database-backed initData lookup');
 const paths:string[]=[];
 globalThis.fetch=(async(input:any,options:any)=>{const path=String(input);paths.push(path);return originalFetch(path.startsWith('/api/')?host+path:input,options);}) as typeof fetch;
 setSessionToken(token);setTelegramInitData(null);invalidateClientCache();
 const result=await loadLoginBootstrap(api,launch(12345),'unused',()=>{},true);
 assert.equal(result.mode,'session');assert.equal(result.identity?.user.id,user.id);
 assert.ok(!paths.some(path=>path.startsWith('/api/auth/')),'Real client startup must not call database login or dev discovery');
 assert.equal(writes,0);assert.equal(userReads,0);assert.equal(maintenanceReads,0,'Resuming/opening must not start background job scans');
 // Same old token with two fresh launches must not share one in-flight response.
 const pending=new Map<string,(r:Response)=>void>(),headers:string[]=[];
 globalThis.fetch=(async(_input:any,options:any)=>{
  const data=new Headers(options.headers).get('x-telegram-launch-data')!;headers.push(data);
  return new Promise<Response>(resolve=>pending.set(data,resolve));
 }) as typeof fetch;
 const a=api.getSessionBootstrap('season-2026-27','launch-a'),b=api.getSessionBootstrap('season-2026-27','launch-b'),sameA=api.getSessionBootstrap('season-2026-27','launch-a');
 await Promise.resolve();assert.deepEqual(headers,['launch-a','launch-b']);
 pending.get('launch-a')!(Response.json({...identity,user:{...user,id:'a'}}));pending.get('launch-b')!(Response.json({...identity,user:{...user,id:'b'}}));
 const [ra,rb,repeat]=await Promise.all([a,b,sameA]);assert.equal(ra.user.id,'a');assert.equal(rb.user.id,'b');assert.equal(repeat.user.id,'a');
 assert.throws(()=>queryAll('select 1'),'Resume never initializes the unused SQLite fallback');
}finally{globalThis.fetch=originalFetch;setSessionToken(null);setTelegramInitData(null);(db as any).collection=originalCollection;(db as any).runTransaction=originalTransaction;await new Promise<void>(resolve=>server.close(()=>resolve()));}
console.log('PASS signed session+launch binding: real client/HTTP startup with identity database offline and ownership held, no writes/SQLite/dev discovery, changed user/invalid/expired/future rejection and in-flight account isolation');
