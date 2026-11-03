import assert from 'node:assert/strict';
import {initDatabase,queryRun} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {refreshFixtureMatchdayRules} from '../firebase/firestoreStore';
import {redisSetRaw} from '../readModel/readModelStore';
import express from 'express';
import {fixturesRouter} from '../routes/fixtures.routes';

export async function verifyPlayerMatchPermissionFreshness(){
  await initDatabase();const db=getFirestoreDb(),seasonId='season-permission-freshness',competitionId='permission-freshness-league';
  const before={provider:process.env.DATABASE_PROVIDER,namespace:process.env.SUPABASE_DATA_NAMESPACE};
  process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
  const f={id:'permission-freshness-game',seasonId,competitionId,matchday:11,status:'SCHEDULED',homeClubId:'home',awayClubId:'away',isPlayable:false} as any;
  const fresh={id:competitionId,seasonId,type:'LEAGUE',status:'active',currentMatchday:19,resultEntryThroughMatchday:19,adminOverrideStatus:'AUTO',isMatchdayOpen:true,nextMatchdayOpenAt:'2026-01-01T00:00:00Z'};
  const stale={...fresh,currentMatchday:1,resultEntryThroughMatchday:undefined};
  const lockId=`${seasonId}:${competitionId}:11`;
  const oldLock={id:lockId,seasonId,competitionId,matchday:11,overrideStatus:'FORCE_LOCKED',isOpen:false,isLocked:true};
  try{
    await db.collection('competitions').doc(competitionId).set(fresh);
    await redisSetRaw(`matchday-state:${seasonId}:${competitionId}`,{data:{competition:stale,locks:[oldLock]}});
    queryRun('INSERT OR REPLACE INTO matchday_locks (id,season_id,competition_id,matchday,override_status,is_open,is_locked,updated_at) VALUES (?,?,?,?,?,?,?,?)',[lockId,seasonId,competitionId,11,'FORCE_LOCKED',0,1,'2026-01-01T00:00:00Z']);
    const [open]=await refreshFixtureMatchdayRules([f],seasonId);
    assert.equal(open.activeMatchday,19,'An old round snapshot must not replace fresh competition progress');
    assert.equal(open.isPlayable,true,'A stale snapshot/SQLite lock must not close the central match');
    await db.collection('fixtures').doc(f.id).set(f);
    const app=express();app.use('/api/fixtures',fixturesRouter);
    const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    try{
      const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/fixtures/${f.id}`);
      assert.equal(response.status,200);const body=await response.json();
      assert.equal(body.fixture.activeMatchday,19);assert.equal(body.fixture.isPlayable,true,'The opened match detail must agree with the central card');
    }finally{server.close();}
    await db.collection('matchday_locks').doc(lockId).set(oldLock);
    assert.equal((await refreshFixtureMatchdayRules([f],seasonId))[0].isPlayable,false,'A real current admin lock is still enforced');
    await db.collection('matchday_locks').doc(lockId).delete();
    assert.equal((await refreshFixtureMatchdayRules([f],seasonId))[0].isPlayable,true,'Fresh removal is visible without a process restart');
    const collection=db.collection.bind(db);
    (db as any).collection=(name:string)=>{if(name==='matchday_locks')throw Error('PERMISSION_SOURCE_UNAVAILABLE');return collection(name);};
    try{await assert.rejects(refreshFixtureMatchdayRules([f],seasonId),/PERMISSION_SOURCE_UNAVAILABLE/);}finally{(db as any).collection=collection;}
    await db.collection('competitions').doc(competitionId).delete();
    assert.equal((await refreshFixtureMatchdayRules([f],seasonId))[0].isPlayable,false,'A missing authoritative competition never uses a permissive old snapshot');
    console.log('PASS central match permissions: fresh progress beats stale round snapshots and SQLite, live explicit lock/removal, source outage and missing-competition denial');
  }finally{
    for(const [name,value]of Object.entries({DATABASE_PROVIDER:before.provider,SUPABASE_DATA_NAMESPACE:before.namespace}))if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
}
if(process.argv[1]?.endsWith('playerMatchPermissionFreshnessTest.ts'))await verifyPlayerMatchPermissionFreshness();
