import assert from 'node:assert/strict';
import {once} from 'node:events';
import express from 'express';
import {requestMaintenance} from '../middleware/requestMaintenance';
const app=express();let tags=0,recovery=0;
app.use((req,_res,next)=>{if(req.get('x-test-actor')==='signed')req.user={id:'isolated-user'} as any;next();});
app.use('/api',requestMaintenance({tags:()=>{tags++;},recover:()=>{recovery++;}}));
app.all('/api/*',(req,res)=>res.status(Number(req.query.status||200)).json({ok:true}));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const request=async(path:string,method='GET',signed=true)=>{
 const r=await fetch(base+path,{method,headers:signed?{'x-test-actor':'signed'}:{}});await r.arrayBuffer();return r;
};
try {
 await Promise.all(Array.from({length:30},(_,i)=>request(['/api/seasons','/api/me/bootstrap','/api/competitions','/api/me/matches','/api/health'][i%5])));
 await request('/api/me/bootstrap','HEAD');await request('/api/health','OPTIONS');
 assert.deepEqual([tags,recovery],[0,0],'Opening and public reads cannot trigger unrelated database/Telegram workers');
 await request('/api/me/notifications?skipCache=1');assert.deepEqual([tags,recovery],[0,1]);
 await request('/api/me/notifications/', 'GET',false);assert.deepEqual([tags,recovery],[0,1],'Anonymous polls cannot trigger recovery');
 for(const method of ['POST','PUT','PATCH','DELETE'])await request('/api/change',method);
 assert.deepEqual([tags,recovery],[4,5],'Successful authenticated changes retain recovery and tag updates');
 await request('/api/auth/telegram','POST',false);assert.deepEqual([tags,recovery],[5,5],'Successful login can refresh tags without claiming an authenticated recovery actor');
 for(const status of [400,401,403,500,503])await request('/api/change?status='+status,'POST');
 await request('/api/me/notifications?status=503');assert.deepEqual([tags,recovery],[5,5],'Failed requests must not multiply background work');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
console.log('PASS HTTP maintenance boundaries: 30 opening reads/HEAD/OPTIONS start no workers; authenticated notification polls and successful mutations recover work; anonymous/error requests do not fan out');
