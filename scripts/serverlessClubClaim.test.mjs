import test from 'node:test';
import assert from 'node:assert/strict';
import {claimClub,validateClubClaim} from '../tgcloud/lib/clubClaim.js';
const claim={seasonId:'season-2',clubId:'club-a',requestId:'claimreq1234'};
function mock({banned=false,open=true,foreign=false}={}){
 let owner=null,insertions=0;
 return {
   get insertions(){return insertions;},
   async get(sql,params){
    if(sql.startsWith('SELECT id,telegram_id'))return {id:'user-a',telegram_id:'1234',is_banned:banned?1:0};
    if(sql.startsWith('SELECT c.id'))return {
      id:'club-a',leagueId:'league-1',seasonId:'season-2',
      leagueStatus:open?'OPEN':'CLOSED',seasonStatus:'UPCOMING'};
    if(sql.startsWith('SELECT id,club_id'))return owner?{
      id:owner.id,clubId:'club-a',leagueId:'league-1',userId:owner.uid}:null;
    throw Error('UNKNOWN_SQL');
   },
   async run(sql,params){
    assert.match(sql,/ON CONFLICT DO NOTHING/);
    assert.match(sql,/l\.status='OPEN'/);
    assert.match(sql,/u\.is_banned=0/);
    if(foreign&&!owner)owner={uid:'user-b',id:'existing'};
    if(banned||!open||owner)return {rowsAffected:0};
    owner={uid:params[':user'],id:params[':id']};
    insertions++;return {rowsAffected:1};
   }
 };
}
test('strict claim input prohibits impersonation and malformed request identifiers',()=>{
 assert.equal(validateClubClaim(claim).clubId,'club-a');
 assert.throws(()=>validateClubClaim({...claim,userId:'user-admin'}),/UNKNOWN_CLAIM_FIELD/);
 assert.throws(()=>validateClubClaim({...claim,requestId:'x'}),/INVALID_CLAIM_ID/);
});
test('same claim replay is idempotent, never reserves the club twice',async()=>{
 const db=mock();
 assert.equal((await claimClub(db,'user-a',claim)).alreadyClaimed,false);
 assert.equal((await claimClub(db,'user-a',claim)).alreadyClaimed,true);
 assert.equal(db.insertions,1);
});
test('banned user, closed admission and second owner are denied',async()=>{
 for(const [options,code] of [
  [{banned:true},'CLUB_CLAIM_BANNED'],
  [{open:false},'CLUB_CLAIM_CLOSED'],
  [{foreign:true},'CLUB_CLAIM_CONFLICT']
 ]){
  await assert.rejects(claimClub(mock(options),'user-a',claim),new RegExp(code));
 }
});
