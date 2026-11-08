import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {convertEflSeasonEntitlements} from './lib/convertEflSeasonEntitlements.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const at='2026-01-02T00:00:00Z';
const doc=(document_id,data)=>({document_id,data});
function source(){
 return {
  users:[doc('u1',{telegramId:'123'})],
  seasons:[doc('s1',{name:'First'}),doc('s2',{name:'Second'})],
  leagues:[doc('l1',{name:'League'})],
  clubs:[doc('c1',{leagueId:'l1',name:'Club'})],
  season2_retention_decisions:[doc('ret1',{
   userId:'u1',seasonId:'s2',sourceSeasonId:'s1',
   clubId:'c1',choice:'KEEP',at
  })],
  premium_entitlements:[
   doc('premium1',{userId:'u1',seasonId:'s2',status:'ACTIVE',
    source:'ADMIN',note:'Synthetic premium',paymentChargeId:null,
    activatedAt:at,revokedAt:null,revokedBy:null,updatedAt:at,updatedBy:'admin'}),
   doc('premium2',{userId:'u1',seasonId:'s1',status:'REVOKED',
    source:'ADMIN',note:'Synthetic revoked',paymentChargeId:null,
    activatedAt:at,revokedAt:'2026-01-03T00:00:00Z',
    revokedBy:'admin',updatedAt:'2026-01-03T00:00:00Z',updatedBy:'admin'})
  ]
 };
}
test('keeps 2nd-season decision and premium activation/revocation exactly as stored',()=>{
 const data=source(),original=JSON.stringify(data);
 const out=convertEflSeasonEntitlements(data);
 assert.equal(JSON.stringify(data),original);
 assert.equal(out.rows.retentionDecisions[0].choice,'KEEP');
 assert.equal(out.rows.retentionDecisions[0].club_id,'s2:s1:c1');
 assert.equal(out.rows.premiumEntitlements[0].status,'ACTIVE');
 assert.equal(out.rows.premiumEntitlements[1].status,'REVOKED');
 assert.equal(out.rows.premiumEntitlements[1].revoked_at,Date.parse('2026-01-03T00:00:00Z'));
 assert.equal(out.report.clubSelectionsReplayed,false);
 assert.equal(out.report.premiumAccessGranted,false);
 for(const [table,rows] of Object.entries(out.rows))
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows}));
});
test('orphan, wrong season, invalid choice, and premium state contradiction fail closed',()=>{
 const mutations=[
  d=>{d.season2_retention_decisions[0].data.userId='missing';},
  d=>{d.season2_retention_decisions[0].data.sourceSeasonId='missing';},
  d=>{d.season2_retention_decisions[0].data.clubId='missing';},
  d=>{d.season2_retention_decisions[0].data.choice='TRANSFER';},
  d=>{d.premium_entitlements[0].data.status='GRANTED';},
  d=>{d.premium_entitlements[0].data.revokedAt=at;},
  d=>{d.premium_entitlements[1].data.revokedAt=null;},
  d=>{d.premium_entitlements[0].data.userId='missing';},
  d=>{d.premium_entitlements[0].data.updatedAt='invalid';}
 ];
 for(const change of mutations){const d=source();change(d);
  assert.throws(()=>convertEflSeasonEntitlements(d));}
});
test('main offline converter retains both collections without changing the Web App',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-historical-rights-'));
 try{
  const data=source();data.users[0].data={telegramId:'123',firstName:'A',createdAt:at};
  data.seasons[0].data={name:'First',status:'active',createdAt:at};
  data.seasons[1].data={name:'Second',status:'registration',createdAt:at};
  data.leagues[0].data={name:'League',country:'GB',createdAt:at};
  data.clubs[0].data={leagueId:'l1',name:'Club',createdAt:at};
  const file=join(dir,'source.jsonl'),out=join(dir,'normalized.json');
  const lines=Object.entries(data).flatMap(([collection_path,docs])=>
   docs.map(({document_id,data})=>JSON.stringify({
    space:'production',collection_path,document_id,encoded:{},data})));
  await writeFile(file,lines.join('\n')+'\n');
  const cli=new URL('./convertEflCoreSnapshot.mjs',import.meta.url).pathname;
  const r=spawnSync(process.execPath,[cli,file,out],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const normalized=JSON.parse(await readFile(out,'utf8'));
  assert.equal(normalized.retentionDecisions.length,1);
  assert.equal(normalized.premiumEntitlements.length,2);
  assert.equal(normalized.premiumEntitlements[1].status,'REVOKED');
 }finally{await rm(dir,{recursive:true,force:true});}
});
