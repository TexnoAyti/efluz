import assert from 'node:assert/strict';
import {readAdminScopedOverview,validateScopedAdminQuery}
 from '../../../tgcloud/lib/adminScopedOverview.js';
assert.deepEqual(validateScopedAdminQuery({seasonId:'season-2026-27'}),
 {seasonId:'season-2026-27',cursor:0,limit:100});
assert.throws(()=>validateScopedAdminQuery({seasonId:'season-2026-27',userId:'someone'}),
 /INVALID_ADMIN_SCOPE_REQUEST/);
assert.throws(()=>validateScopedAdminQuery({seasonId:'2026-27'}),/INVALID_ADMIN_SEASON/);
assert.throws(()=>validateScopedAdminQuery({seasonId:'season-2026-27',limit:200}),
 /INVALID_ADMIN_LIMIT/);
let calls=[];
const mkDb=(admin=true)=>({
 async get(sql,params) {
   calls.push({kind:'get',sql,params});
   if(sql.includes('efl_users'))return admin?{id:'u1',isAdmin:1,isBanned:0}:{id:'u1',isAdmin:0,isBanned:0};
   if(sql.includes('efl_seasons'))return {id:'season-2026-27'};
   throw Error('UNEXPECTED_GET');
 },
 async all(sql,params) {
   calls.push({kind:'all',sql,params});
   if(sql.includes('FROM efl_leagues'))return [{id:'league-a',seasonId:'season-2026-27',name:'La Liga'}];
   if(sql.includes('FROM efl_competitions'))return [{id:'comp-a',seasonId:'season-2026-27',status:'ACTIVE'}];
   if(sql.includes('FROM efl_clubs'))return [{id:'club-a',leagueId:'league-a',name:'Club A'}];
   if(sql.includes('FROM efl_fixtures'))return params[':offset']===0?[
     {id:'fixture-a',seasonId:'season-2026-27',competitionId:'comp-a',status:'SCHEDULED',round:1},
     {id:'fixture-b',seasonId:'season-2026-27',competitionId:'comp-a',status:'CONFIRMED',round:2}
   ]:[{id:'fixture-b',seasonId:'season-2026-27',competitionId:'comp-a',status:'CONFIRMED',round:2}];
   throw Error('UNEXPECTED_ALL');
 }
});
assert.rejects(readAdminScopedOverview(mkDb(false),'123',{seasonId:'season-2026-27'}),
 /ADMIN_FORBIDDEN/);
assert.equal(calls.filter(c=>c.kind==='all').length,0,'Unauthorized users never read admin catalogs');
calls=[];
const page=await readAdminScopedOverview(mkDb(),'123',
 {seasonId:'season-2026-27',cursor:0,limit:1});
assert.equal(page.nextCursor,1);
assert.equal(page.fixtures.length,1);
assert.equal(page.fixtures[0].id,'fixture-a');
assert.equal(calls.filter(c=>c.kind==='all').length,4);
assert.ok(calls.filter(c=>c.kind==='all').every(c=>c.params[':season']==='season-2026-27'));
assert.ok(calls.every(c=>!Object.values(c.params||{}).includes('client-chosen-user')),
 'Signed ID is the sole admin identity');
calls=[];
const second=await readAdminScopedOverview(mkDb(),'123',
 {seasonId:'season-2026-27',cursor:1,limit:1});
assert.equal(second.fixtures[0].id,'fixture-b');
assert.equal(second.nextCursor,null);
console.log('PASS_ADMIN_SCOPED_OVERVIEW: signed admin check, isolated season, pagination, no PII');
