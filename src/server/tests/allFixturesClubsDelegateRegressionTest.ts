import assert from 'node:assert/strict';
import express from 'express';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {requireAdmin} from '../middleware/authMiddleware';
import {canManageAllFixturesAndClubs,canManageFixture,canUseDangerZone} from '../../lib/adminPermissions';

await initDatabase();
const db=getFirestoreDb();
const actor='delegate-all-fixtures-test';
const user={id:actor,telegramId:'999999991',isAdmin:true,isSuspended:false,
  adminPermissions:{scope:'LEAGUES',leagueIds:[],manageAllFixturesAndClubs:true}};
const narrow={...user,id:'scoped-test',telegramId:'999999992',adminPermissions:{scope:'LEAGUES',leagueIds:['league-la-liga']}};
await db.collection('users').doc(actor).set(user);
await db.collection('users').doc(narrow.id).set(narrow);
await db.collection('fixtures').doc('uefa-match').set({id:'uefa-match',seasonId:'season-2026-27',competitionId:'comp-champions-league-2026'});
await db.collection('fixtures').doc('asia-match').set({id:'asia-match',seasonId:'season-2027-28',competitionId:'comp-japan-2027'});
await db.collection('clubs').doc('foreign-club').set({id:'foreign-club',name:'Foreign Club',leagueId:'league-japan'});
assert.equal(canManageAllFixturesAndClubs(user),true);
assert.equal(canUseDangerZone(user),false);
assert.equal(canManageFixture(user,'comp-champions-league-2026'),true);
assert.equal(canManageFixture(user,'comp-japan-2027'),true);
assert.equal(canManageFixture(user,'comp-europa-league-2026'),true);
assert.equal(canManageAllFixturesAndClubs(narrow),false);
assert.equal(canManageFixture(narrow,'comp-japan-2027'),false);

const app=express();app.use(express.json());
app.use((req:any,_res,next)=>{req.user={id:String(req.headers['x-test-user']||actor)};next();});
const paths=[
  ['POST','/api/admin/fixtures/uefa-match/result',200],
  ['POST','/api/admin/fixtures/asia-match/reopen',200],
  ['POST','/api/admin/results/uefa-match/approve',200],
  ['POST','/api/admin/clubs/foreign-club/assign',200],
  ['POST','/api/admin/clubs/foreign-club/release',200],
  ['GET','/api/admin/scoped/overview',200],
  ['GET','/api/admin/fixtures',200],
  ['GET','/api/admin/clubs',200],
  ['POST','/api/admin/users/someone/role',403],
  ['POST','/api/admin/users/someone/suspend',403],
  ['DELETE','/api/admin/fixtures/uefa-match',403],
  ['POST','/api/admin/fixtures/reset',403],
  ['POST','/api/admin/european/qualification/apply',403],
  ['POST','/api/admin/season-ops/rollover',403],
] as const;
for(const [method,path] of paths)(app as any)[method.toLowerCase()](path,requireAdmin,(_req:any,res:any)=>res.json({authorized:true}));
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+((server.address() as any).port);
try {
  for(const [method,path,expected] of paths){
    const response=await fetch(base+path,{method,headers:{'x-test-user':actor,'content-type':'application/json'},body:method==='GET'?undefined:'{}'});
    assert.equal(response.status,expected,method+' '+path);
  }
  for(const path of ['/api/admin/fixtures/uefa-match/result','/api/admin/clubs/foreign-club/assign']){
    const response=await fetch(base+path,{method:'POST',headers:{'x-test-user':narrow.id,'content-type':'application/json'},body:'{}'});
    assert.equal(response.status,403,'Narrow delegate must not get unrestricted operations: '+path);
  }
  assert.equal((await fetch(base+'/api/admin/fixtures/missing/result',{method:'POST',headers:{'x-test-user':actor,'content-type':'application/json'},body:'{}'})).status,404);
  console.log('PASS delegated worldwide matches and clubs, all seasons and cups, explicit owner-only danger boundary');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
}
