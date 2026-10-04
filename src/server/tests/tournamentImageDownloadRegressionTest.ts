import assert from 'node:assert/strict';
import express from 'express';
import { deflateSync } from 'node:zlib';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { createTournamentImageDownloadService, type StoredImageExport } from '../services/tournamentImageDownload';
import { createTournamentImageDownloadRouters } from '../routes/tournamentImageDownload.routes';
import { startTournamentImageDownload } from '../../lib/tournamentImageDownload';

await initDatabase();const db=getFirestoreDb();
for(const [id,isAdmin,permissions] of [['league-admin',true,{scope:'LEAGUES',leagueIds:['league-la-liga']}],['player',false,{scope:'ALL',leagueIds:[]}]] as const)await db.collection('users').doc(id).set({id,telegramId:id,isAdmin,isSuspended:false,adminPermissions:permissions});
// Build a complete PNG using standard chunks, including a large harmless text chunk.
function crc32(buffer:Buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const payload=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(payload));return Buffer.concat([size,payload,crc]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(100,4);ihdr[8]=8;ihdr[9]=2;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('tEXt',Buffer.from('Comment\0'+'x'.repeat(210000))),chunk('IDAT',deflateSync(Buffer.alloc((1080*3+1)*100))),chunk('IEND',Buffer.alloc(0))]);
const values=new Map<string,StoredImageExport>();let now=Date.now(),writtenTtl=0;
const service=createTournamentImageDownloadService({async set(key,value,ttl){values.set(key,value);writtenTtl=ttl;},async get(key){return values.get(key)||null;}},()=>now);
const {admin,download}=createTournamentImageDownloadRouters(service);
const app=express();app.use('/api/admin/image-exports',express.json({limit:'1mb'}));app.use(express.json({limit:'256kb'}));
app.use('/api/image-exports',download);
app.use((req:any,_res,next)=>{if(req.headers['x-test-user'])req.user={id:String(req.headers['x-test-user']),isAdmin:true,adminPermissions:{scope:'ALL',leagueIds:[]}};next();});app.use('/api/admin/image-exports',admin);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}`;
const filename='efluz-comp-serie-a-2026-matchday-10.png';const post=(actor?:string,payload:any={pngBase64:png.toString('base64'),filename})=>fetch(base+'/api/admin/image-exports',{method:'POST',headers:{'content-type':'application/json',...(actor?{'x-test-user':actor}:{})},body:JSON.stringify(payload)});
try{
  assert.equal((await post()).status,401);assert.equal((await post('player')).status,403);
  const response=await post('league-admin');assert.equal(response.status,200,await response.clone().text());assert.equal(writtenTtl,300);
  const result=await response.json();assert.match(result.downloadPath,/^\/api\/image-exports\/[a-f0-9]{48}\.png$/);
  const file=await fetch(base+result.downloadPath);assert.equal(file.status,200);
  assert.equal(file.headers.get('content-type'),'image/png');assert.equal(file.headers.get('content-disposition'),`attachment; filename="${filename}"`);
  assert.equal(file.headers.get('access-control-allow-origin'),'https://web.telegram.org');assert.match(file.headers.get('cache-control')!,/no-store/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),png,'Downloaded bytes are exactly the generated PNG, without auth or rendering');
  const head=await fetch(base+result.downloadPath,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),png.length);
  assert.equal((await post('league-admin',{pngBase64:'PHN2Zz4=',filename})).status,400);
  assert.equal((await post('league-admin',{pngBase64:png.toString('base64'),filename:'evil\r\n.svg'})).status,400);
  now+=301000;assert.equal((await fetch(base+result.downloadPath)).status,404);
  const failing=createTournamentImageDownloadService({async set(){throw new Error('Redis unavailable');},async get(){throw new Error('Redis unavailable');}});
  await assert.rejects(()=>failing.create(png.toString('base64'),filename));
  const calls:any[]=[];const url='https://efluz.vercel.app/api/image-exports/test.png';
  assert.equal(startTournamentImageDownload(url,filename,{isVersionAtLeast:v=>v==='8.0',downloadFile:args=>calls.push(args)},()=>calls.push('browser')),'telegram');
  assert.deepEqual(calls[0],{url,file_name:filename});
  assert.equal(startTournamentImageDownload(url,filename,{isVersionAtLeast:()=>false,downloadFile:()=>assert.fail('unsupported'),openLink:u=>calls.push(u)},()=>assert.fail('browser')),'external');
  assert.equal(startTournamentImageDownload(url,filename,{isVersionAtLeast:()=>true,downloadFile:()=>{throw new Error('unsupported');},openLink:u=>calls.push(u)},()=>assert.fail('browser')),'external');
  assert.equal(startTournamentImageDownload(url,filename,undefined,()=>calls.push('browser')),'browser');
  assert.throws(()=>startTournamentImageDownload('blob:test',filename,undefined,()=>{}),/HTTPS/);
  console.log('PASS large PNG uploads, authoritative all-admin permission, real HTTP download bytes/headers/HEAD, expiry, invalid PNG rejection, storage failure and Telegram/browser download routing');
}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}

if(process.env.REDIS_TEST_PORT){
  const {getUpstashClient}=await import('../readModel/readModelStore');const client=getUpstashClient()!;assert.ok(client);
  const actual=createTournamentImageDownloadService();const saved=await actual.create(png.toString('base64'),filename);
  const token=saved.downloadPath.split('/').pop()!.replace('.png','');const key=`efluz:image-export:${token}`;
  const ttl=await client.ttl(key);assert.ok(ttl>0&&ttl<=300);
  assert.deepEqual((await createTournamentImageDownloadService().get(token))!.png,png,'A different service instance reads the same real Redis PNG');
  await client.del(key);assert.equal(await actual.get(token),null);
  const originalSet=client.set;(client as any).set=async()=>{throw new Error('Simulated durable storage failure');};
  try{await assert.rejects(()=>actual.create(png.toString('base64'),filename));}finally{client.set=originalSet;}
  console.log('PASS actual Redis image bytes, TTL, cross-instance download, deletion and fail-closed upload');
}
