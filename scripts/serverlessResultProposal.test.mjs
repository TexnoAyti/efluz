import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResultProposal,proposeFixtureResult} from '../tgcloud/lib/resultProposal.js';
function fixtureDB({locked=false,banned=false,club=true}={}){
 let record=null,inserts=0;
 return {
  get inserts(){return inserts;},
  async get(sql,args){
   if(sql.startsWith('SELECT id,telegram_id,is_banned'))return {id:'u1',telegram_id:'123',is_banned:banned?1:0};
   if(sql.includes('FROM efl_fixtures f JOIN efl_competitions c'))
    return {id:'f1',season_id:'season-1',round:3,status:'SCHEDULED',
      home_club_id:'c1',away_club_id:'c2',competition_id:'comp1',
      current_matchday:3,is_matchday_open:!locked};
   if(sql.includes('SELECT club_id FROM efl_club_occupancies'))
     return club?{club_id:'c1'}:null;
   if(sql.includes('FROM efl_result_submissions WHERE id=:id'))return record;
   throw Error('UNEXPECTED_QUERY');
  },
  async run(sql,args){
   assert.match(sql,/c\.is_matchday_open=1/);
   assert.match(sql,/u\.is_banned=0/);
   assert.match(sql,/o\.status='ACTIVE'/);
   assert.match(sql,/ON CONFLICT DO NOTHING/);
   if(locked||!club||banned)return {rowsAffected:0};
   if(record)return {rowsAffected:0};
   record={id:args[':id'],fixture_id:args[':fixture'],
    submitted_by_user_id:args[':user'],club_id:args[':club'],
    home_score:args[':homeScore'],away_score:args[':awayScore']};
   inserts++;return {rowsAffected:1};
  }
 };
}
test('input accepts a normal score and rejects unknown fields',()=>{
 assert.deepEqual(validateResultProposal({fixtureId:'f1',homeScore:2,awayScore:1}),
   {fixtureId:'f1',homeScore:2,awayScore:1});
 assert.throws(()=>validateResultProposal({fixtureId:'f1',homeScore:2.5,awayScore:0}),/INVALID_SCORE/);
 assert.throws(()=>validateResultProposal({fixtureId:'f1',homeScore:-1,awayScore:0}),/INVALID_SCORE/);
 assert.throws(()=>validateResultProposal({fixtureId:'f1',homeScore:1,awayScore:0,userId:'admin'}),/UNKNOWN_PROPOSAL_FIELD/);
});
test('same result is idempotent, changed replay rejected',async()=>{
 const db=fixtureDB(),input={fixtureId:'f1',homeScore:2,awayScore:1};
 const first=await proposeFixtureResult(db,'u1',input);
 assert.equal(first.pendingConfirmation,true);assert.equal(first.alreadySubmitted,false);
 assert.equal((await proposeFixtureResult(db,'u1',input)).alreadySubmitted,true);
 assert.equal(db.inserts,1);
 await assert.rejects(proposeFixtureResult(db,'u1',{...input,homeScore:8}),/PROPOSAL_CONFLICT/);
});
test('banned, unrelated and locked users cannot propose',async()=>{
 const p={fixtureId:'f1',homeScore:1,awayScore:1};
 for(const [opts,code] of [[{banned:true},'USER_BANNED_OR_MISSING'],
   [{club:false},'FIXTURE_FORBIDDEN'],[{locked:true},'MATCHDAY_LOCKED']]){
   await assert.rejects(proposeFixtureResult(fixtureDB(opts),'u1',p),new RegExp(code));
 }
});
